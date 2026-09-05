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
      consecutiveDeliveryFailures: 0,
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
      consecutiveDeliveryFailures: 0,
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
