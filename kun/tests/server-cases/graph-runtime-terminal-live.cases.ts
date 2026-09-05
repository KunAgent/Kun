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
})
