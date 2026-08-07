import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryArtifactStore } from '../artifacts/artifact-store.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphNodeAttemptV1Schema,
  type GraphRunV1
} from '../contracts/graph.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import {
  testAssignmentSnapshot,
  testGraphConfig,
  testGraphPlan
} from '../graph/graph-test-fixtures.test-support.js'
import { GraphRuntimeComposition } from './graph-runtime-factory.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
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

function testAuthority(workspace: string) {
  return {
    workspaceRoot: workspace,
    model: 'test-model',
    providerId: 'default',
    allowedModelProviderIds: ['default'],
    allowedModels: ['test-model'],
    allowedProviderIds: [],
    reasoningEffort: 'off' as const,
    approvalPolicy: 'never' as const,
    sandboxMode: 'read-only' as const,
    allowedTools: [] as string[],
    blockedTools: [] as string[],
    allowedSkills: [] as string[],
    blockedSkills: [] as string[],
    allowedMcpServers: [] as string[],
    blockedMcpServers: [] as string[],
    readScopes: ['.'],
    writeScopes: [] as string[],
    networkAllowed: false
  }
}

async function startOwnedRuntime(
  runtime: GraphRuntimeComposition,
  workspace: string
): Promise<void> {
  await runtime.start({
    delegation: () => undefined,
    leadTurn: async () => undefined,
    authorityForRun: () => testAuthority(workspace)
  })
}

async function settleSourceTurn(
  threadStore: InMemoryThreadStore,
  threadId: string,
  sourceTurnId: string,
  status: 'failed' | 'aborted'
): Promise<void> {
  const thread = await threadStore.get(threadId)
  if (!thread) throw new Error(`missing thread ${threadId}`)
  await threadStore.upsert({
    ...thread,
    turns: thread.turns.map((turn) =>
      turn.id === sourceTurnId ? { ...turn, status } : turn)
  })
}

function spyResumeRun(runtime: GraphRuntimeComposition) {
  const original = runtime.scheduler.resumeRun.bind(runtime.scheduler)
  return vi.spyOn(runtime.scheduler, 'resumeRun').mockImplementation(async (runId) =>
    original(runId))
}

async function expectNoCancelledTransition(
  runtime: GraphRuntimeComposition,
  runId: string
): Promise<void> {
  expect(
    (await runtime.store.events(runId, 0)).some((envelope) =>
      envelope.event.type === 'run_status_changed' &&
      envelope.event.payload.to === 'cancelled')
  ).toBe(false)
}

describe('GraphRuntimeComposition source-turn terminal semantics (#1071)', () => {
  it('converges a completing run to completed after incidental aborted when scheduler is started', async () => {
    // start() first so the initial scheduler tick is empty; then construct the
    // completing run. That way completed can only come from preserve→resumeRun.
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('completing_live')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_completing_live',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_completing_live',
      idempotencyKey: 'create_completing_live'
    })
    let run = await runtime.control.get('run_completing_live')
    run = await transitionRun(runtime, run, 'running', 'to_running_completing_live')
    run = await acceptAllNodes(runtime, run, 'completing_live')
    run = await transitionRun(runtime, run, 'completing', 'to_completing_live')
    expect(run.status).toBe('completing')
    expect(run.summary).toBeUndefined()

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'aborted')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'aborted')

    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith(run.id)
    const after = await runtime.control.get(run.id)
    expect(after.status).toBe('completed')
    expect(after.summary).toBeDefined()
    expect(after.summary!.finalAnswer.length).toBeGreaterThan(0)
    await expectNoCancelledTransition(runtime, run.id)
    await runtime.stop()
  })

  it('converges gates-passed running work to completed after incidental failure when scheduler is started', async () => {
    // Remaining race beyond v0.2.35: gates passed, no summary/completing yet.
    // start() first → empty tick; then install the running gates-passed snapshot.
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('gates_live')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_gates_live',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_gates_live',
      idempotencyKey: 'create_gates_live'
    })
    let run = await runtime.control.get('run_gates_live')
    run = await transitionRun(runtime, run, 'running', 'to_running_gates_live')
    run = await acceptAllNodes(runtime, run, 'gates_live')
    expect(run.status).toBe('running')
    expect(run.summary).toBeUndefined()
    expect(Object.values(run.nodes).every((node) => node.status === 'accepted')).toBe(true)

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'failed')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')

    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith(run.id)
    const after = await runtime.control.get(run.id)
    expect(after.status).toBe('completed')
    expect(after.summary).toBeDefined()
    expect(after.summary!.finalAnswer.length).toBeGreaterThan(0)
    expect(after.finishedAt).toBeTruthy()
    await expectNoCancelledTransition(runtime, run.id)
    await runtime.stop()
  })

  it('preserves accepted+summary awaiting_supervision and finishes when finalization is safe', async () => {
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('accepted_summary_live')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_accepted_summary_live',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_accepted_summary_live',
      idempotencyKey: 'create_accepted_summary_live'
    })
    let run = await runtime.control.get('run_accepted_summary_live')
    run = await transitionRun(runtime, run, 'running', 'to_running_accepted_live')
    run = await acceptAllNodes(runtime, run, 'accepted_summary_live')
    run = await recordFinalSummary(
      runtime,
      run,
      'summary_accepted_live',
      'All nodes accepted and the final report is complete.'
    )
    run = await transitionRun(runtime, run, 'awaiting_supervision', 'hold_after_summary_live')
    expect(run.status).toBe('awaiting_supervision')
    expect(run.summary?.finalAnswer).toContain('final report is complete')

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'failed')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')

    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledWith(run.id)
    const after = await runtime.control.get(run.id)
    expect(after.status).toBe('completed')
    expect(after.summary?.finalAnswer).toContain('final report is complete')
    await expectNoCancelledTransition(runtime, run.id)
    await runtime.stop()
  })

  it('does not auto-finish gates-passed work with an unresolved blocking mailbox message', async () => {
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('mailbox_block')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_mailbox_block',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_mailbox_block',
      idempotencyKey: 'create_mailbox_block'
    })
    let run = await runtime.control.get('run_mailbox_block')
    run = await transitionRun(runtime, run, 'running', 'to_running_mailbox')
    run = await acceptAllNodes(runtime, run, 'mailbox_block')
    await runtime.mailbox.send({
      id: 'message_blocking_1',
      runId: run.id,
      sender: { kind: 'system' },
      recipients: [{ kind: 'worker', nodeId: 'finish' }],
      type: 'system',
      priority: 'blocking',
      summary: 'Confirm the handoff before finalization.',
      artifactRefs: [],
      replyRequired: true
    }, { commandId: 'send_block_1', idempotencyKey: 'send_block_1' })
    run = (await runtime.store.get(run.id))!
    expect(runtime.mailbox.unresolvedBlockers(run).length).toBeGreaterThan(0)
    expect(run.status).toBe('running')

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'failed')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')

    // Semantic complete forbids cancel; finalization unsafe forbids resumeRun.
    expect(resume).not.toHaveBeenCalled()
    const after = await runtime.control.get(run.id)
    expect(after.status).not.toBe('cancelled')
    expect(after.status).not.toBe('completed')
    expect(runtime.mailbox.unresolvedBlockers(after).length).toBeGreaterThan(0)
    await runtime.stop()
  })

  it('keeps awaiting_human with needs_attention after incidental settlement', async () => {
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('human_hold')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_human_hold',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_human_hold',
      idempotencyKey: 'create_human_hold'
    })
    let run = await runtime.control.get('run_human_hold')
    run = await transitionRun(runtime, run, 'running', 'to_running_human')
    run = await acceptAllNodes(runtime, run, 'human_hold')
    run = await recordFinalSummary(runtime, run, 'summary_human', 'Semantic work finished.')
    const obligation = {
      version: GRAPH_CONTRACT_VERSION,
      id: 'graph_obligation_human_hold',
      kind: 'help' as const,
      reason: 'help' as const,
      graphRevision: run.currentRevision,
      nodeIds: [] as string[],
      attemptIds: [] as string[],
      digest: 'Human attention required before finalization.',
      state: 'needs_attention' as const,
      deliveryAttempts: 1,
      noProgressCount: 3,
      lastProgressSeq: run.lastEventSeq,
      attentionReason: 'Source Lead made no progress; human review required.',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }
    run = (await runtime.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'open_human_hold',
      idempotencyKey: 'open_human_hold',
      event: {
        type: 'supervision_obligation_updated',
        payload: { obligation }
      }
    })).state
    run = await transitionRun(runtime, run, 'awaiting_human', 'to_awaiting_human')
    expect(run.status).toBe('awaiting_human')

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'failed')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')

    expect(resume).not.toHaveBeenCalled()
    const after = await runtime.control.get(run.id)
    expect(after.status).toBe('awaiting_human')
    expect(after.status).not.toBe('completed')
    expect(after.status).not.toBe('cancelled')
    expect(after.supervisionObligations.some((entry) =>
      entry.id === obligation.id && entry.state === 'needs_attention')).toBe(true)
    expect(after.summary?.finalAnswer).toContain('Semantic work finished')
    await runtime.stop()
  })

  it('does not auto-complete awaiting_supervision with an unresolved scheduler_error obligation', async () => {
    const { runtime, threadId, sourceTurnId, workspace, threadStore } =
      await createOwnedGraphRuntime('sched_err')
    await startOwnedRuntime(runtime, workspace)
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_sched_err',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_sched_err',
      idempotencyKey: 'create_sched_err'
    })
    let run = await runtime.control.get('run_sched_err')
    run = await transitionRun(runtime, run, 'running', 'to_running_sched_err')
    run = await acceptAllNodes(runtime, run, 'sched_err')
    run = await recordFinalSummary(runtime, run, 'summary_sched_err', 'Gates passed.')
    const obligation = {
      version: GRAPH_CONTRACT_VERSION,
      id: 'graph_obligation_sched_err',
      kind: 'scheduler_error' as const,
      reason: 'scheduler_error' as const,
      graphRevision: run.currentRevision,
      nodeIds: [] as string[],
      attemptIds: [] as string[],
      digest: 'Scheduler failed while finalizing.',
      state: 'pending' as const,
      deliveryAttempts: 0,
      noProgressCount: 0,
      lastProgressSeq: run.lastEventSeq,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z'
    }
    run = (await runtime.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: 'open_sched_err',
      idempotencyKey: 'open_sched_err',
      event: {
        type: 'supervision_obligation_opened',
        payload: { obligation }
      }
    })).state
    run = await transitionRun(runtime, run, 'awaiting_supervision', 'to_awaiting_sched_err')
    expect(run.status).toBe('awaiting_supervision')

    await settleSourceTurn(threadStore, threadId, sourceTurnId, 'failed')
    const resume = spyResumeRun(runtime)
    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')

    expect(resume).not.toHaveBeenCalled()
    const after = await runtime.control.get(run.id)
    expect(after.status).not.toBe('completed')
    expect(after.status).not.toBe('cancelled')
    expect(after.status).toBe('awaiting_supervision')
    expect(after.supervisionObligations.some((entry) =>
      entry.id === obligation.id && entry.state !== 'resolved')).toBe(true)
    await runtime.stop()
  })

  it('leaves gates-passed work uncancelled without finishing when scheduler is not started (cold-start)', async () => {
    // Cold composition before runtime.start: incidental settlement must not
    // cancel, but cannot finish without a scheduler. Explicit cold-start semantics.
    const { runtime, threadId, sourceTurnId, workspace } = await createOwnedGraphRuntime('cold_start')
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_cold_start',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_cold_start',
      idempotencyKey: 'create_cold_start'
    })
    let run = await runtime.control.get('run_cold_start')
    run = await transitionRun(runtime, run, 'running', 'to_running_cold')
    run = await acceptAllNodes(runtime, run, 'cold_start')

    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'failed')
    const after = await runtime.control.get(run.id)
    expect(after.status).not.toBe('cancelled')
    expect(['running', 'completing']).toContain(after.status)
    expect(after.summary).toBeUndefined()
    await runtime.stop()
  })

  it('force-cancels even a completing run for explicit user Stop', async () => {
    const { runtime, threadId, sourceTurnId, workspace } = await createOwnedGraphRuntime('force_stop')
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_force_stop',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_force_stop',
      idempotencyKey: 'create_force_stop'
    })
    let run = await runtime.control.get('run_force_stop')
    run = await transitionRun(runtime, run, 'running', 'to_running_force')
    run = await acceptAllNodes(runtime, run, 'force_stop')
    run = await recordFinalSummary(runtime, run, 'summary_force_stop', 'Semantic work finished.')
    run = await transitionRun(runtime, run, 'completing', 'to_completing_force')
    // Do not start the scheduler first: a tick would finish completing before
    // Stop. Explicit cancel must work against a durable completing snapshot.

    await runtime.cancelSourceTurnRunsExplicitly(threadId, sourceTurnId)
    await expect(runtime.control.get(run.id)).resolves.toMatchObject({
      status: 'cancelled'
    })
    expect(
      (await runtime.store.events(run.id, 0)).some((envelope) =>
        envelope.event.type === 'run_status_changed' &&
        envelope.event.payload.to === 'cancelled' &&
        envelope.event.payload.reason === 'user interrupted the owning source turn')
    ).toBe(true)
    await runtime.stop()
  })

  it('still cancels unfinished owned runs on incidental settlement', async () => {
    const { runtime, threadId, sourceTurnId, workspace } = await createOwnedGraphRuntime('unfinished')
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_unfinished',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_unfinished',
      idempotencyKey: 'create_unfinished'
    })
    let run = await runtime.control.get('run_unfinished')
    run = await transitionRun(runtime, run, 'running', 'to_running_unfinished')
    expect(run.nodes.research?.status).not.toBe('accepted')
    await startOwnedRuntime(runtime, workspace)

    await runtime.handleSourceTurnTerminal(threadId, sourceTurnId, 'aborted')
    await expect(runtime.control.get(run.id)).resolves.toMatchObject({
      status: 'cancelled'
    })
    await runtime.stop()
  })

  it('treats concurrent completion as a successful terminal fence for cancel races', async () => {
    const { runtime, threadId, sourceTurnId, workspace } = await createOwnedGraphRuntime('race')
    const identity = await runtime.registry.identify(workspace)
    await runtime.control.create({
      runId: 'run_race',
      threadId,
      projectId: identity.projectId,
      sourceTurnId,
      plan: testGraphPlan({ workspaceRoot: workspace }),
      commandId: 'create_race',
      idempotencyKey: 'create_race'
    })
    let run = await runtime.control.get('run_race')
    run = await transitionRun(runtime, run, 'running', 'to_running_race')
    run = await transitionRun(runtime, run, 'completing', 'to_completing_race')

    const originalList = runtime.store.list.bind(runtime.store)
    vi.spyOn(runtime.store, 'list').mockImplementation(async (query) => {
      const listed = await originalList(query)
      for (const item of listed) {
        if (item.id !== run.id || item.status === 'completed') continue
        const latest = (await runtime.store.get(item.id))!
        if (latest.status === 'completed') continue
        await runtime.store.append(latest.id, {
          expectedSeq: latest.lastEventSeq,
          graphRevision: latest.currentRevision,
          commandId: 'complete_race_win',
          idempotencyKey: 'complete_race_win',
          event: {
            type: 'run_status_changed',
            payload: { from: latest.status, to: 'completed' }
          }
        })
      }
      return listed
    })

    await expect(
      runtime.cancelSourceTurnRunsExplicitly(threadId, sourceTurnId)
    ).resolves.toBeUndefined()
    await expect(runtime.control.get(run.id)).resolves.toMatchObject({
      status: 'completed'
    })
    await runtime.stop()
  })
})
