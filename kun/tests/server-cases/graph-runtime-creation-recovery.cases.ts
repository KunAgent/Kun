import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { InMemoryArtifactStore } from '../../src/artifacts/artifact-store.js'
import type { GraphRuntimeConfig } from '../../src/config/kun-config.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphNodeAttemptV1Schema,
  type GraphRunV1
} from '../../src/contracts/graph.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { createTurnRecord } from '../../src/domain/turn.js'
import { GraphRunConflictError } from '../../src/graph/graph-run-store.js'
import {
  testAssignmentSnapshot,
  testGraphConfig,
  testGraphPlan
} from '../../src/graph/graph-test-fixtures.test-support.js'
import { GraphRuntimeComposition } from '../../src/server/graph-runtime-factory.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

async function transitionRun(
  runtime: GraphRuntimeComposition,
  run: GraphRunV1,
  to: GraphRunV1['status'],
  commandId: string
): Promise<GraphRunV1> {
  return (await runtime.store.append(run.id, {
    expectedSeq: run.lastEventSeq,
    graphRevision: run.currentRevision,
    commandId,
    idempotencyKey: commandId,
    event: {
      type: 'run_status_changed',
      payload: { from: run.status, to }
    }
  })).state
}

async function recordFinalSummary(
  runtime: GraphRuntimeComposition,
  run: GraphRunV1,
  commandId: string,
  finalAnswer = 'A stale Graph report was persisted before later work.'
): Promise<GraphRunV1> {
  return (await runtime.store.append(run.id, {
    expectedSeq: run.lastEventSeq,
    graphRevision: run.currentRevision,
    commandId,
    idempotencyKey: commandId,
    event: {
      type: 'run_summary_recorded',
      payload: {
        summary: {
          version: GRAPH_CONTRACT_VERSION,
          finalAnswer,
          evidenceRefs: [],
          unresolvedRisks: [],
          changedFiles: [],
          validationResults: [],
          totalTokens: 0,
          totalElapsedMs: 0,
          completedAt: '2026-07-26T00:00:00.000Z'
        }
      }
    }
  })).state
}

/** Force every plan node into accepted so completion gates pass. */
async function acceptAllNodes(
  runtime: GraphRuntimeComposition,
  run: GraphRunV1,
  label: string
): Promise<GraphRunV1> {
  let current = run
  for (const node of Object.values(current.nodes)) {
    if (node.status === 'accepted' || node.status === 'superseded') continue
    const nodeId = node.node.id
    if (current.nodes[nodeId]!.status === 'pending') {
      current = (await runtime.store.append(current.id, {
        expectedSeq: current.lastEventSeq,
        graphRevision: current.currentRevision,
        commandId: `${label}_${nodeId}_ready`,
        idempotencyKey: `${label}_${nodeId}_ready`,
        event: {
          type: 'node_status_changed',
          payload: {
            nodeId,
            from: 'pending',
            to: 'ready',
            reason: 'test fixture: semantic work complete'
          }
        }
      })).state
    }
    const attemptId = `attempt_${label}_${nodeId}`
    const attempt = GraphNodeAttemptV1Schema.parse({
      version: GRAPH_CONTRACT_VERSION,
      id: attemptId,
      runId: current.id,
      nodeId,
      revision: current.currentRevision,
      attemptNumber: 1,
      iteration: 0,
      commandId: `${label}_${nodeId}_attempt`,
      idempotencyKey: `${label}_${nodeId}_attempt`,
      status: 'queued',
      assignment: testAssignmentSnapshot(),
      queuedAt: '2026-07-26T00:00:00.000Z',
      tokenUsage: 0,
      elapsedMs: 0
    })
    // attempt_created admits on ready and moves the node to queued.
    const events = [
      { type: 'attempt_created' as const, payload: { attempt } },
      {
        type: 'attempt_status_changed' as const,
        payload: {
          nodeId,
          attemptId,
          from: 'queued' as const,
          to: 'running' as const
        }
      },
      {
        type: 'node_status_changed' as const,
        payload: {
          nodeId,
          from: 'queued' as const,
          to: 'running' as const,
          reason: 'test fixture: semantic work complete'
        }
      },
      {
        type: 'attempt_status_changed' as const,
        payload: {
          nodeId,
          attemptId,
          from: 'running' as const,
          to: 'submitted' as const
        }
      },
      {
        type: 'node_status_changed' as const,
        payload: {
          nodeId,
          from: 'running' as const,
          to: 'submitted' as const,
          reason: 'test fixture: semantic work complete'
        }
      },
      {
        type: 'attempt_status_changed' as const,
        payload: {
          nodeId,
          attemptId,
          from: 'submitted' as const,
          to: 'accepted' as const
        }
      },
      {
        type: 'node_status_changed' as const,
        payload: {
          nodeId,
          from: 'submitted' as const,
          to: 'accepted' as const,
          reason: 'test fixture: semantic work complete'
        }
      }
    ]
    for (const [index, event] of events.entries()) {
      current = (await runtime.store.append(current.id, {
        expectedSeq: current.lastEventSeq,
        graphRevision: current.currentRevision,
        commandId: `${label}_${nodeId}_accept_${index}`,
        idempotencyKey: `${label}_${nodeId}_accept_${index}`,
        event
      })).state
    }
  }
  return current
}

async function createOwnedGraphRuntime(label: string): Promise<{
  runtime: GraphRuntimeComposition
  threadId: string
  sourceTurnId: string
  workspace: string
  root: string
  threadStore: InMemoryThreadStore
}> {
  const root = await mkdtemp(join(tmpdir(), `kun-graph-runtime-${label}-`))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  roots.push(root)
  let id = 0
  const threadStore = new InMemoryThreadStore()
  const threadId = `thread_${label}`
  const sourceTurnId = `turn_${label}`
  const thread = createThreadRecord({
    id: threadId,
    title: `Graph ${label}`,
    workspace,
    model: 'test-model'
  })
  await threadStore.upsert({
    ...thread,
    turns: [
      createTurnRecord({
        id: sourceTurnId,
        threadId,
        prompt: 'Build a graph.',
        orchestration: 'graph',
        status: 'running'
      })
    ]
  })
  const runtime = new GraphRuntimeComposition({
    dataDir: root,
    config: () => testGraphConfig(),
    artifactStore: new InMemoryArtifactStore(),
    runtimeEvents: { record: vi.fn(async (event) => event as never) },
    threadStore,
    ids: { next: (prefix) => `${prefix}_${++id}` },
    nowIso: () => '2026-07-26T00:00:00.000Z'
  })
  return { runtime, threadId, sourceTurnId, workspace, root, threadStore }
}

describe('GraphRuntimeComposition creation authority', () => {
  it('starts a committed ready run left by a crash between draft commit and start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-ready-recovery-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    roots.push(root)
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_ready_recovery',
      title: 'Ready Graph recovery',
      workspace,
      model: 'test-model'
    })
    await threadStore.upsert({
      ...thread,
      turns: [
        createTurnRecord({
          id: 'turn_ready_recovery',
          threadId: thread.id,
          prompt: 'Build a graph.',
          orchestration: 'graph',
          status: 'running'
        }),
        createTurnRecord({
          id: 'turn_cancelled_recovery',
          threadId: thread.id,
          prompt: 'Cancel this graph.',
          orchestration: 'graph',
          status: 'running'
        }),
        createTurnRecord({
          id: 'turn_missing_recovery',
          threadId: thread.id,
          prompt: 'Recover a missing graph.',
          orchestration: 'graph',
          status: 'running'
        })
      ]
    })
    const runtime = new GraphRuntimeComposition({
      dataDir: root,
      config: () => testGraphConfig(),
      artifactStore: new InMemoryArtifactStore(),
      runtimeEvents: { record: vi.fn(async (event) => event as never) },
      threadStore,
      ids: { next: (prefix) => `${prefix}_${++id}` },
      nowIso: () => '2026-07-29T00:10:00.000Z'
    })
    const identity = await runtime.registry.identify(workspace)
    const draft = await runtime.drafts.create({
      id: 'draft_ready_recovery',
      reservedRunId: 'run_ready_recovery',
      threadId: thread.id,
      sourceTurnId: 'turn_ready_recovery',
      projectId: identity.projectId,
      goal: 'Build a graph.'
    })
    const plan = testGraphPlan({ workspaceRoot: workspace, autoStart: true })
    const ready = (await runtime.control.create({
      runId: draft.reservedRunId,
      threadId: thread.id,
      projectId: identity.projectId,
      sourceTurnId: 'turn_ready_recovery',
      plan,
      commandId: 'create_ready_recovery',
      idempotencyKey: 'create_ready_recovery',
      start: false
    })).run
    expect(ready.status).toBe('ready')
    await runtime.drafts.update(draft.id, {
      expectedRevision: draft.revision,
      status: 'committed',
      committedRunId: ready.id
    })
    const cancelledDraft = await runtime.drafts.create({
      id: 'draft_cancelled_recovery',
      reservedRunId: 'run_cancelled_recovery',
      threadId: thread.id,
      sourceTurnId: 'turn_cancelled_recovery',
      projectId: identity.projectId,
      goal: 'Cancel this graph.'
    })
    const cancelledReady = (await runtime.control.create({
      runId: cancelledDraft.reservedRunId,
      threadId: thread.id,
      projectId: identity.projectId,
      sourceTurnId: 'turn_cancelled_recovery',
      plan,
      commandId: 'create_cancelled_recovery',
      idempotencyKey: 'create_cancelled_recovery',
      start: false
    })).run
    await runtime.drafts.update(cancelledDraft.id, {
      expectedRevision: cancelledDraft.revision,
      status: 'cancelled'
    })
    const missingDraft = await runtime.drafts.create({
      id: 'draft_missing_recovery',
      reservedRunId: 'run_missing_recovery',
      threadId: thread.id,
      sourceTurnId: 'turn_missing_recovery',
      projectId: identity.projectId,
      goal: 'Recover a missing graph.'
    })
    await runtime.drafts.update(missingDraft.id, {
      expectedRevision: missingDraft.revision,
      status: 'committed',
      committedRunId: missingDraft.reservedRunId
    })

    await runtime.start({
      delegation: () => undefined,
      leadTurn: async () => undefined,
      authorityForRun: () => ({
        workspaceRoot: workspace,
        model: 'test-model',
        providerId: 'default',
        allowedModelProviderIds: ['default'],
        allowedModels: ['test-model'],
        allowedProviderIds: [],
        reasoningEffort: 'off',
        approvalPolicy: 'never',
        sandboxMode: 'read-only',
        allowedTools: [],
        blockedTools: [],
        allowedSkills: [],
        blockedSkills: [],
        allowedMcpServers: [],
        blockedMcpServers: [],
        readScopes: ['.'],
        writeScopes: [],
        networkAllowed: false
      })
    })

    await expect(runtime.control.get(ready.id)).resolves.not.toMatchObject({
      status: 'ready'
    })
    await expect(runtime.control.get(cancelledReady.id)).resolves.toMatchObject({
      status: 'cancelled'
    })
    await expect(runtime.drafts.require(missingDraft.id)).resolves.toMatchObject({
      status: 'host_error',
      issues: [expect.objectContaining({ code: 'graph_committed_run_missing' })]
    })
    await runtime.stop()
  })

  it('wakes a parked Lead once when durable planning is committed but turn metadata is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-planning-lifecycle-recovery-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    roots.push(root)
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_stale_planning',
      title: 'Stale planning lifecycle recovery',
      workspace,
      model: 'test-model'
    })
    const sourceTurn = {
      ...createTurnRecord({
        id: 'turn_stale_planning',
        threadId: thread.id,
        prompt: 'Build a graph.',
        orchestration: 'graph',
        status: 'running'
      }),
      graphPlanningLifecycle: {
        version: 1 as const,
        draftId: 'draft_stale_planning',
        reservedRunId: 'run_stale_planning',
        state: 'planning' as const,
        draftRevision: 1
      }
    }
    await threadStore.upsert({ ...thread, turns: [sourceTurn] })
    const config = testGraphConfig({
      supervision: { coalesceWindowMs: 0 }
    })
    const runtime = new GraphRuntimeComposition({
      dataDir: root,
      config: () => config,
      artifactStore: new InMemoryArtifactStore(),
      runtimeEvents: { record: vi.fn(async (event) => event as never) },
      threadStore,
      ids: { next: (prefix) => `${prefix}_${++id}` },
      nowIso: () => '2026-07-30T00:00:00.000Z'
    })
    const identity = await runtime.registry.identify(workspace)
    const draft = await runtime.drafts.create({
      id: 'draft_stale_planning',
      reservedRunId: 'run_stale_planning',
      threadId: thread.id,
      sourceTurnId: sourceTurn.id,
      projectId: identity.projectId,
      goal: 'Build a graph.'
    })
    await runtime.control.create({
      runId: draft.reservedRunId,
      threadId: thread.id,
      projectId: identity.projectId,
      sourceTurnId: sourceTurn.id,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'command_create_stale_planning',
      idempotencyKey: 'create_stale_planning'
    })
    await runtime.drafts.update(draft.id, {
      expectedRevision: draft.revision,
      status: 'committed',
      committedRunId: draft.reservedRunId
    })
    const leadTurn = vi.fn(async () => undefined)

    await runtime.start({
      delegation: () => undefined,
      leadTurn,
      authorityForRun: () => ({
        workspaceRoot: workspace,
        model: 'test-model',
        providerId: 'default',
        allowedModelProviderIds: ['default'],
        allowedModels: ['test-model'],
        allowedProviderIds: [],
        reasoningEffort: 'off',
        approvalPolicy: 'never',
        sandboxMode: 'read-only',
        allowedTools: [],
        blockedTools: [],
        allowedSkills: [],
        blockedSkills: [],
        allowedMcpServers: [],
        blockedMcpServers: [],
        readScopes: ['.'],
        writeScopes: [],
        networkAllowed: false
      })
    })

    await vi.waitFor(() => {
      expect(leadTurn).toHaveBeenCalledWith(expect.objectContaining({
        run: expect.objectContaining({ id: 'run_stale_planning' }),
        reasons: ['recovery'],
        digest: expect.stringContaining('Recovered stale Graph planning lifecycle')
      }))
    })
    await runtime.stop()
  })
})
