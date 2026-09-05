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
  it('binds HTTP/tool creation inputs to the canonical parent thread and source turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-runtime-authority-'))
    const workspace = join(root, 'workspace')
    const otherWorkspace = join(root, 'other')
    await Promise.all([mkdir(workspace), mkdir(otherWorkspace)])
    roots.push(root)
    let config: GraphRuntimeConfig = testGraphConfig()
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_1',
      title: 'Graph authority',
      workspace,
      model: 'test-model'
    })
    await threadStore.upsert({
      ...thread,
      turns: [
        createTurnRecord({
          id: 'turn_1',
	          threadId: thread.id,
	          prompt: 'Build a graph.',
	          orchestration: 'graph',
	          status: 'running'
        }),
        createTurnRecord({
          id: 'turn_direct',
          threadId: thread.id,
          prompt: 'Run directly.'
        })
      ]
    })
    const runtime = new GraphRuntimeComposition({
      dataDir: root,
      config: () => config,
      artifactStore: new InMemoryArtifactStore(),
      runtimeEvents: { record: vi.fn(async (event) => event as never) },
      threadStore,
      ids: { next: (prefix) => `${prefix}_${++id}` },
      nowIso: () => '2026-07-26T00:00:00.000Z'
    })
    const identity = await runtime.registry.identify(workspace)
    const base = {
      threadId: thread.id,
      projectId: identity.projectId,
      sourceTurnId: 'turn_1',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'command_create',
      idempotencyKey: 'create'
    }

    await expect(runtime.control.create({
      ...base,
      runId: 'run_bad_turn',
      sourceTurnId: 'turn_missing'
    })).rejects.toBeInstanceOf(GraphRunConflictError)
    await expect(runtime.control.create({
      ...base,
      runId: 'run_direct_turn',
      sourceTurnId: 'turn_direct'
    })).rejects.toThrow(/not authorized/)
    await expect(runtime.control.create({
      ...base,
      runId: 'run_bad_workspace',
      plan: testGraphPlan({ workspaceRoot: otherWorkspace })
    })).rejects.toThrow(/workspace must match/)
    await expect(runtime.control.create({
      ...base,
      runId: 'run_bad_project',
      projectId: 'project_forged'
    })).rejects.toThrow(/project id/)

    await expect(runtime.control.create({
      ...base,
      runId: 'run_valid'
    })).resolves.toMatchObject({ run: { status: 'ready' } })

    let completing = await runtime.control.get('run_valid')
    completing = await transitionRun(runtime, completing, 'running', 'start_run_valid')
    completing = await transitionRun(runtime, completing, 'completing', 'complete_run_valid')
    await runtime.handleSourceTurnTerminal(thread.id, 'turn_1', 'aborted')
    await expect(runtime.control.get('run_valid')).resolves.toMatchObject({
      status: 'completing'
    })

    // A stale summary must not fence later unfinished Graph work from a
    // passive source-turn cancellation.
    await runtime.control.create({
      ...base,
      runId: 'run_summarized',
      commandId: 'command_create_summarized',
      idempotencyKey: 'create_summarized'
    })
    let summarized = await runtime.control.get('run_summarized')
    summarized = await transitionRun(runtime, summarized, 'running', 'start_run_summarized')
    summarized = await transitionRun(runtime, summarized, 'completing', 'complete_run_summarized')
    summarized = await recordFinalSummary(runtime, summarized, 'summarize_run_summarized')
    summarized = await transitionRun(
      runtime,
      summarized,
      'awaiting_supervision',
      'hold_summarized_run_for_recovery'
    )
    await runtime.handleSourceTurnTerminal(thread.id, 'turn_1', 'failed')
    await expect(runtime.control.get('run_summarized')).resolves.toMatchObject({
      status: 'cancelled',
      summary: { finalAnswer: 'A stale Graph report was persisted before later work.' }
    })

    await runtime.control.create({
      ...base,
      runId: 'run_active',
      commandId: 'command_create_active',
      idempotencyKey: 'create_active'
    })
    let active = await runtime.control.get('run_active')
    active = await transitionRun(runtime, active, 'running', 'start_run_active')
    await runtime.handleSourceTurnTerminal(thread.id, 'turn_1', 'aborted')
    await expect(runtime.control.get(active.id)).resolves.toMatchObject({
      status: 'cancelled'
    })

    await runtime.handleSourceTurnTerminal(thread.id, 'turn_1', 'aborted', {
      forceCancel: true
    })
    await expect(runtime.control.get('run_valid')).resolves.toMatchObject({
      status: 'cancelled'
    })

    await runtime.control.create({
      ...base,
      runId: 'run_archived',
      commandId: 'command_create_archived',
      idempotencyKey: 'create_archived'
    })
    await runtime.handleThreadStatus(thread.id, 'archived')
    const archived = await runtime.control.get('run_archived')
    expect(archived.status).toBe('paused')
    await runtime.control.resume('run_archived', {
      commandId: 'command_resume',
      idempotencyKey: 'resume_after_archive',
      expectedSeq: archived.lastEventSeq
    })

    config = testGraphConfig({ enabled: false })
    await runtime.reconfigureBackgroundServices()
    await expect(runtime.control.get('run_archived')).resolves.toMatchObject({
      status: 'paused'
    })
    await runtime.stop()
  })

  it('cancels a legacy nonterminal run owned by an already-terminal source turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-runtime-recovery-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    roots.push(root)
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_legacy',
      title: 'Legacy Graph recovery',
      workspace,
      model: 'test-model'
    })
    await threadStore.upsert({
      ...thread,
      turns: [createTurnRecord({
        id: 'turn_legacy',
        threadId: thread.id,
	        prompt: 'Build a graph.',
	        orchestration: 'graph',
	        status: 'running'
      })]
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
    const identity = await runtime.registry.identify(workspace)
	    await runtime.control.create({
      runId: 'run_legacy',
      threadId: thread.id,
      projectId: identity.projectId,
      sourceTurnId: 'turn_legacy',
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'command_create_legacy',
	      idempotencyKey: 'create_legacy'
	    })
	    const createdThread = (await threadStore.get(thread.id))!
	    await threadStore.upsert({
	      ...createdThread,
	      turns: createdThread.turns.map((turn) =>
	        turn.id === 'turn_legacy'
	          ? { ...turn, status: 'completed' as const }
	          : turn)
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

    await expect(runtime.control.get('run_legacy')).resolves.toMatchObject({
      status: 'cancelled'
    })
    expect(leadTurn).not.toHaveBeenCalled()
    expect(await threadStore.get(thread.id)).toMatchObject({
      turns: [expect.objectContaining({
        id: 'turn_legacy',
        status: 'completed'
      })]
    })
    await runtime.stop()
  })

  it('finishes an interrupted committing draft once with its reserved run id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-planning-recovery-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    roots.push(root)
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_planning',
      title: 'Planning recovery',
      workspace,
      model: 'test-model'
    })
    await threadStore.upsert({
      ...thread,
      turns: [createTurnRecord({
        id: 'turn_planning',
        threadId: thread.id,
        prompt: 'Build a graph.',
        orchestration: 'graph',
        status: 'running'
      })]
    })
    const runtime = new GraphRuntimeComposition({
      dataDir: root,
      config: () => testGraphConfig(),
      artifactStore: new InMemoryArtifactStore(),
      runtimeEvents: { record: vi.fn(async (event) => event as never) },
      threadStore,
      ids: { next: (prefix) => `${prefix}_${++id}` },
      nowIso: () => '2026-07-29T00:00:00.000Z'
    })
    const identity = await runtime.registry.identify(workspace)
    const draft = await runtime.drafts.create({
      id: 'draft_recovery',
      reservedRunId: 'run_reserved',
      threadId: thread.id,
      sourceTurnId: 'turn_planning',
      projectId: identity.projectId,
      goal: 'Build a graph.'
    })
    await runtime.drafts.writeCommitPlan(
      draft.id,
      testGraphPlan({ workspaceRoot: workspace, autoStart: true })
    )
    await runtime.drafts.update(draft.id, {
      expectedRevision: draft.revision,
      status: 'committing'
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

    await expect(runtime.control.get('run_reserved')).resolves.toMatchObject({
      id: 'run_reserved'
    })
    await expect(runtime.drafts.require('draft_recovery')).resolves.toMatchObject({
      status: 'committed',
      committedRunId: 'run_reserved'
    })
    expect((await runtime.control.list({ threadId: thread.id }))
      .filter((run) => run.sourceTurnId === 'turn_planning')).toHaveLength(1)
    await runtime.stop()
  })

  it('retries a Stop cancellation when planning advances the draft revision concurrently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-draft-cancel-cas-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    roots.push(root)
    let id = 0
    const threadStore = new InMemoryThreadStore()
    const thread = createThreadRecord({
      id: 'thread_draft_cancel_cas',
      title: 'Draft cancel CAS',
      workspace,
      model: 'test-model'
    })
    await threadStore.upsert({
      ...thread,
      turns: [createTurnRecord({
        id: 'turn_draft_cancel_cas',
        threadId: thread.id,
        prompt: 'Build a graph.',
        orchestration: 'graph',
        status: 'running'
      })]
    })
    const runtime = new GraphRuntimeComposition({
      dataDir: root,
      config: () => testGraphConfig(),
      artifactStore: new InMemoryArtifactStore(),
      runtimeEvents: {
        record: vi.fn(async () => {
          throw new Error('planning projection unavailable')
        })
      },
      threadStore,
      ids: { next: (prefix) => `${prefix}_${++id}` },
      nowIso: () => '2026-07-30T16:00:00.000Z'
    })
    const draft = await runtime.createPlanningDraft({
      threadId: thread.id,
      sourceTurnId: 'turn_draft_cancel_cas',
      goal: 'Build a graph.',
      workspace
    })
    expect(await runtime.drafts.list({ threadId: thread.id })).toHaveLength(1)
    const update = runtime.drafts.update.bind(runtime.drafts)
    let collided = false
    vi.spyOn(runtime.drafts, 'update').mockImplementation(async (draftId, input) => {
      if (!collided && input.status === 'cancelled') {
        collided = true
        const current = await runtime.drafts.require(draftId)
        await update(draftId, {
          expectedRevision: current.revision,
          status: 'validating',
          issues: []
        })
      }
      return update(draftId, input)
    })

    await expect(runtime.transitionPlanningDraft({
      threadId: thread.id,
      sourceTurnId: 'turn_draft_cancel_cas',
      action: 'cancel'
    })).resolves.toMatchObject({
      draftId: draft.draftId,
      state: 'cancelled',
      draftRevision: 3
    })
    expect(collided).toBe(true)
    expect(await runtime.control.list({ threadId: thread.id })).toEqual([])
  })
})
