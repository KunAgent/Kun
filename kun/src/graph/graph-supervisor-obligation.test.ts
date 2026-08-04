import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GRAPH_CONTRACT_VERSION,
  GraphNodeAttemptV1Schema,
  type GraphDomainEventV1,
  type GraphRunV1,
  type GraphSupervisionObligationV1
} from '../contracts/graph.js'
import { FileGraphRunStore } from './graph-run-store.js'
import { GraphSupervisor } from './graph-supervisor.js'
import { GraphSupervisionObligationManager } from './graph-supervision-obligation-manager.js'
import {
  graphSupervisionObligationForSignal,
  graphSupervisionObligationIsActionable
} from './graph-supervision-obligation.js'
import {
  testAssignmentSnapshot,
  testGraphConfig,
  testGraphPlan
} from './graph-test-fixtures.test-support.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})

type PersistentHarness = Awaited<ReturnType<typeof persistentHarness>>

async function persistentHarness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-graph-supervision-obligation-'))
  roots.push(root)
  const config = testGraphConfig({
    supervision: { coalesceWindowMs: 60_000 }
  })
  let nowMs = Date.parse('2026-07-31T00:00:00.000Z')
  let next = 0
  const nextId = (prefix: string) => `${prefix}_${++next}`
  const nowIso = () => new Date(nowMs).toISOString()
  const storeOptions = {
    rootDir: join(root, 'graphs'),
    config: () => config,
    nowIso,
    nextId
  }
  const store = new FileGraphRunStore(storeOptions)
  await store.create({
    runId: 'run_obligation',
    threadId: 'thread_obligation',
    projectId: 'project_obligation',
    sourceTurnId: 'turn_obligation',
    plan: testGraphPlan(),
    commandId: 'command_create_obligation',
    idempotencyKey: 'create-obligation'
  })
  return {
    config,
    nextId,
    nowIso,
    nowMs: () => nowMs,
    advance: (delayMs: number) => { nowMs += delayMs },
    store,
    storeOptions
  }
}

function supervisorFor(
  harness: PersistentHarness,
  options: {
    leadTurn?: ConstructorParameters<typeof GraphSupervisor>[0]['leadTurn']
    isLeadTurnActive?: (run: GraphRunV1) => boolean
    store?: FileGraphRunStore
  } = {}
): GraphSupervisor {
  return new GraphSupervisor({
    store: options.store ?? harness.store,
    config: () => harness.config,
    delegation: () => undefined,
    leadTurn: options.leadTurn,
    isLeadTurnActive: options.isLeadTurnActive,
    nowIso: harness.nowIso,
    nowMs: harness.nowMs,
    nextId: harness.nextId
  })
}

async function appendEvent(
  harness: PersistentHarness,
  event: GraphDomainEventV1,
  label: string,
  store = harness.store
): Promise<GraphRunV1> {
  const run = await store.get('run_obligation')
  if (!run) throw new Error('missing test GraphRun')
  return (await store.append(run.id, {
    expectedSeq: run.lastEventSeq,
    graphRevision: run.currentRevision,
    commandId: `command_${label}`,
    idempotencyKey: `obligation-test:${label}`,
    timestamp: harness.nowIso(),
    event
  })).state
}

async function transitionRunToRunning(harness: PersistentHarness): Promise<GraphRunV1> {
  let run = (await harness.store.get('run_obligation'))!
  for (const [index, transition] of [
    { from: 'draft' as const, to: 'validating' as const },
    { from: 'validating' as const, to: 'ready' as const },
    { from: 'ready' as const, to: 'running' as const }
  ].entries()) {
    run = await appendEvent(harness, {
      type: 'run_status_changed',
      payload: transition
    }, `run-running-${index}`)
  }
  return run
}

async function submitReviewableAttempt(harness: PersistentHarness): Promise<GraphRunV1> {
  let run = await transitionRunToRunning(harness)
  run = await appendEvent(harness, {
    type: 'node_status_changed',
    payload: {
      nodeId: 'research',
      from: 'pending',
      to: 'ready',
      reason: 'test fixture'
    }
  }, 'node-ready')
  const attempt = GraphNodeAttemptV1Schema.parse({
    version: GRAPH_CONTRACT_VERSION,
    id: 'attempt_reviewable',
    runId: run.id,
    nodeId: 'research',
    revision: run.currentRevision,
    attemptNumber: 1,
    iteration: 0,
    commandId: 'command_attempt_reviewable',
    idempotencyKey: 'attempt-reviewable',
    status: 'queued',
    assignment: testAssignmentSnapshot(),
    queuedAt: harness.nowIso(),
    tokenUsage: 0,
    elapsedMs: 0
  })
  const events: Array<[string, GraphDomainEventV1]> = [
    ['attempt-created', { type: 'attempt_created', payload: { attempt } }],
    ['attempt-running', {
      type: 'attempt_status_changed',
      payload: {
        nodeId: 'research',
        attemptId: attempt.id,
        from: 'queued',
        to: 'running'
      }
    }],
    ['node-running', {
      type: 'node_status_changed',
      payload: {
        nodeId: 'research',
        from: 'queued',
        to: 'running',
        reason: 'test fixture'
      }
    }],
    ['result-submitted', {
      type: 'result_submitted',
      payload: {
        nodeId: 'research',
        attemptId: attempt.id,
        result: {
          version: GRAPH_CONTRACT_VERSION,
          summary: 'Review this durable result.',
          artifactRefs: [],
          changedFiles: [],
          checks: [],
          evidence: ['durable evidence'],
          risks: [],
          suggestedMessages: []
        },
        validation: {
          version: GRAPH_CONTRACT_VERSION,
          valid: true,
          issues: [],
          normalizedNodeCount: 1,
          normalizedEdgeCount: 0
        },
        tokenUsage: 1,
        elapsedMs: 1
      }
    }],
    ['attempt-submitted', {
      type: 'attempt_status_changed',
      payload: {
        nodeId: 'research',
        attemptId: attempt.id,
        from: 'running',
        to: 'submitted'
      }
    }],
    ['node-submitted', {
      type: 'node_status_changed',
      payload: {
        nodeId: 'research',
        from: 'running',
        to: 'submitted',
        reason: 'await source Lead review'
      }
    }]
  ]
  for (const [label, event] of events) run = await appendEvent(harness, event, label)
  return run
}

function onlyObligation(run: GraphRunV1): GraphSupervisionObligationV1 {
  expect(run.supervisionObligations).toHaveLength(1)
  return run.supervisionObligations[0]!
}

async function durableEventTypes(store: FileGraphRunStore): Promise<string[]> {
  return (await store.events('run_obligation', 0)).map((event) => event.event.type)
}

function expectDurableLiveness(run: GraphRunV1, nowMs: number): void {
  for (const obligation of run.supervisionObligations) {
    if (!graphSupervisionObligationIsActionable(run, obligation)) continue
    if (run.status === 'awaiting_human') continue
    if (obligation.state === 'pending') continue
    if (obligation.state === 'delivering') {
      expect(Date.parse(obligation.leaseUntil ?? '')).toBeGreaterThan(nowMs)
      continue
    }
    if (obligation.state === 'awaiting_action' || obligation.state === 'retry_scheduled') {
      expect(Number.isFinite(Date.parse(obligation.nextWakeAt ?? ''))).toBe(true)
      continue
    }
    expect.fail(`actionable obligation ${obligation.id} has no durable continuation`)
  }
}

const HELP_SIGNAL = {
  runId: 'run_obligation',
  reason: 'help' as const,
  nodeIds: [] as string[],
  digest: 'Source Lead action remains required.'
}

describe('GraphSupervisor durable supervision obligations', () => {
  it('records delivery as awaiting_action without acknowledging semantic completion', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    let promptSnapshotSeq = -1
    const supervisor = supervisorFor(harness, {
      leadTurn: async ({ run }) => {
        promptSnapshotSeq = run.lastEventSeq
        return {
          status: 'delivered',
          sourceTurnId: run.sourceTurnId,
          deliveredSeq: run.lastEventSeq,
          executionActive: true
        }
      },
      isLeadTurnActive: () => true
    })

    await supervisor.signal(HELP_SIGNAL)
    await supervisor.flush(HELP_SIGNAL.runId)

    const run = (await harness.store.get(HELP_SIGNAL.runId))!
    const obligation = onlyObligation(run)
    expect(obligation).toMatchObject({
      state: 'awaiting_action',
      deliveryAttempts: 1,
      lastDeliveredSeq: promptSnapshotSeq,
      noProgressCount: 0
    })
    expect(obligation.resolvedAt).toBeUndefined()
    expect(promptSnapshotSeq).toBeLessThan(run.lastEventSeq)
    expect(Date.parse(obligation.nextWakeAt!) - harness.nowMs()).toBe(2_000)
    expectDurableLiveness(run, harness.nowMs())
    expect(await durableEventTypes(harness.store)).toEqual(expect.arrayContaining([
      'supervision_obligation_opened',
      'supervision_delivery_started'
    ]))
    await supervisor.stop()
  })

  it('persists bounded 2/5/15/60 second retries after Lead delivery I/O failures', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const leadTurn = vi.fn(async () => {
      throw new Error('EIO while resuming the source Lead')
    })
    const supervisor = supervisorFor(harness, { leadTurn })
    const expectedDelays = [2_000, 5_000, 15_000, 60_000]

    await supervisor.signal(HELP_SIGNAL)
    for (const [index, expectedDelay] of expectedDelays.entries()) {
      if (index > 0) await supervisor.sweepObligations()
      await supervisor.flush(HELP_SIGNAL.runId)
      const run = (await harness.store.get(HELP_SIGNAL.runId))!
      const obligation = onlyObligation(run)
      expect(obligation).toMatchObject({
        state: 'retry_scheduled',
        deliveryAttempts: index + 1,
        lastError: 'EIO while resuming the source Lead'
      })
      expect(obligation.lastDeliveredSeq).toBeUndefined()
      expect(Date.parse(obligation.nextWakeAt!) - harness.nowMs()).toBe(expectedDelay)
      expectDurableLiveness(run, harness.nowMs())
      const reopened = new FileGraphRunStore(harness.storeOptions)
      expect(onlyObligation((await reopened.get(run.id))!).nextWakeAt)
        .toBe(obligation.nextWakeAt)
      harness.advance(expectedDelay)
    }
    expect(leadTurn).toHaveBeenCalledTimes(4)
    const eventTypes = await durableEventTypes(harness.store)
    expect(eventTypes.filter((type) => type === 'supervision_obligation_opened')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'supervision_delivery_started')).toHaveLength(4)
    expect(eventTypes.filter((type) => type === 'supervision_retry_scheduled')).toHaveLength(4)
    await supervisor.stop()
  })

  it('keeps a deferred delivery durable without advancing the prompt snapshot cursor', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const supervisor = supervisorFor(harness, {
      leadTurn: async () => ({
        status: 'deferred',
        reason: 'Source Lead execution capacity is temporarily unavailable.',
        retryAfterMs: 10_000
      })
    })
    await supervisor.signal(HELP_SIGNAL)
    await supervisor.flush(HELP_SIGNAL.runId)

    const run = (await harness.store.get(HELP_SIGNAL.runId))!
    const obligation = onlyObligation(run)
    expect(obligation).toMatchObject({
      state: 'retry_scheduled',
      deliveryAttempts: 1,
      lastError: 'Source Lead execution capacity is temporarily unavailable.'
    })
    expect(obligation.lastDeliveredSeq).toBeUndefined()
    expect(obligation.lastDeliveredAt).toBeUndefined()
    expect(Date.parse(obligation.nextWakeAt!) - harness.nowMs()).toBe(2_000)
    expectDurableLiveness(run, harness.nowMs())
    await supervisor.stop()
  })

  it('redelivers one durable obligation when the same signal arrives after restart', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const firstLead = vi.fn(async ({ run }: { run: GraphRunV1 }) => ({
      status: 'delivered' as const,
      sourceTurnId: run.sourceTurnId,
      deliveredSeq: run.lastEventSeq,
      executionActive: true
    }))
    const first = supervisorFor(harness, { leadTurn: firstLead, isLeadTurnActive: () => true })
    await first.signal(HELP_SIGNAL)
    await first.flush(HELP_SIGNAL.runId)
    const obligationId = onlyObligation((await harness.store.get(HELP_SIGNAL.runId))!).id
    await first.stop()

    harness.advance(2_000)
    const reopenedStore = new FileGraphRunStore(harness.storeOptions)
    const secondLead = vi.fn(async ({ run }: { run: GraphRunV1 }) => ({
      status: 'delivered' as const,
      sourceTurnId: run.sourceTurnId,
      deliveredSeq: run.lastEventSeq,
      executionActive: true
    }))
    const second = supervisorFor(harness, {
      store: reopenedStore,
      leadTurn: secondLead,
      isLeadTurnActive: () => false
    })
    await second.signal(HELP_SIGNAL)
    await second.flush(HELP_SIGNAL.runId)

    const run = (await reopenedStore.get(HELP_SIGNAL.runId))!
    expect(run.supervisionObligations).toHaveLength(1)
    expect(onlyObligation(run)).toMatchObject({
      id: obligationId,
      state: 'awaiting_action',
      deliveryAttempts: 2
    })
    expect(firstLead).toHaveBeenCalledOnce()
    expect(secondLead).toHaveBeenCalledOnce()
    await second.stop()
  })

  it('recovers an abandoned 30 second delivery lease from a reopened store', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const neverReturns = new Promise<never>(() => {})
    const abandoned = supervisorFor(harness, {
      leadTurn: async () => {
        markStarted()
        return neverReturns
      }
    })
    await abandoned.signal(HELP_SIGNAL)
    void abandoned.flush(HELP_SIGNAL.runId)
    await started

    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    let obligation = onlyObligation(run)
    expect(obligation.state).toBe('delivering')
    expect(Date.parse(obligation.leaseUntil!) - harness.nowMs()).toBe(30_000)
    expectDurableLiveness(run, harness.nowMs())

    const reopenedStore = new FileGraphRunStore(harness.storeOptions)
    const resumedLead = vi.fn(async ({ run: current }: { run: GraphRunV1 }) => ({
      status: 'delivered' as const,
      sourceTurnId: current.sourceTurnId,
      deliveredSeq: current.lastEventSeq,
      executionActive: true
    }))
    const resumed = supervisorFor(harness, {
      store: reopenedStore,
      leadTurn: resumedLead,
      isLeadTurnActive: () => true
    })
    harness.advance(30_000)
    await resumed.sweepObligations()
    run = (await reopenedStore.get(HELP_SIGNAL.runId))!
    obligation = onlyObligation(run)
    expect(obligation.state).toBe('retry_scheduled')
    expect(Date.parse(obligation.nextWakeAt!) - harness.nowMs()).toBe(2_000)

    harness.advance(2_000)
    await resumed.sweepObligations()
    await resumed.flush(HELP_SIGNAL.runId)
    run = (await reopenedStore.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run)).toMatchObject({
      state: 'awaiting_action',
      deliveryAttempts: 2
    })
    expect(resumedLead).toHaveBeenCalledOnce()
    expectDurableLiveness(run, harness.nowMs())
    await resumed.stop()
  })

  it('moves an orphaned source owner to durable human attention', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const supervisor = supervisorFor(harness, {
      leadTurn: async () => ({
        status: 'orphaned',
        reason: 'The durable source turn no longer exists.'
      })
    })
    await supervisor.signal(HELP_SIGNAL)
    await supervisor.flush(HELP_SIGNAL.runId)

    const run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(run.status).toBe('awaiting_human')
    expect(onlyObligation(run)).toMatchObject({
      state: 'needs_attention',
      attentionReason: 'The durable source turn no longer exists.'
    })
    expectDurableLiveness(run, harness.nowMs())
    expect(await durableEventTypes(harness.store)).toContain('supervision_attention_required')
    await supervisor.stop()
  })

  it('escalates after three delivered episodes without semantic progress', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const leadTurn = vi.fn(async ({ run }: { run: GraphRunV1 }) => ({
      status: 'delivered' as const,
      sourceTurnId: run.sourceTurnId,
      deliveredSeq: run.lastEventSeq,
      executionActive: false,
      parkedWithPendingSupervision: true
    }))
    const supervisor = supervisorFor(harness, { leadTurn, isLeadTurnActive: () => false })
    await supervisor.signal(HELP_SIGNAL)

    for (let episode = 1; episode <= 3; episode += 1) {
      if (episode > 1) await supervisor.sweepObligations()
      await supervisor.flush(HELP_SIGNAL.runId)
      const run = (await harness.store.get(HELP_SIGNAL.runId))!
      const obligation = onlyObligation(run)
      expect(obligation.noProgressCount).toBe(episode)
      if (episode < 3) {
        expect(obligation.state).toBe('retry_scheduled')
        expectDurableLiveness(run, harness.nowMs())
        harness.advance(episode === 1 ? 2_000 : 5_000)
      }
    }

    const run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(run.status).toBe('awaiting_human')
    expect(onlyObligation(run).state).toBe('needs_attention')
    expect(leadTurn).toHaveBeenCalledTimes(3)
    await supervisor.stop()
  })

  it('resets the consecutive no-progress count after a durable semantic event', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const leadTurn = vi.fn(async ({ run }: { run: GraphRunV1 }) => ({
      status: 'delivered' as const,
      sourceTurnId: run.sourceTurnId,
      deliveredSeq: run.lastEventSeq,
      executionActive: false,
      parkedWithPendingSupervision: true
    }))
    const supervisor = supervisorFor(harness, { leadTurn, isLeadTurnActive: () => false })
    await supervisor.signal(HELP_SIGNAL)
    await supervisor.flush(HELP_SIGNAL.runId)
    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run).noProgressCount).toBe(1)

    harness.advance(2_000)
    run = await appendEvent(harness, {
      type: 'steering_recorded',
      payload: {
        steering: {
          version: GRAPH_CONTRACT_VERSION,
          steeringId: 'steering_semantic_progress',
          runId: run.id,
          target: { kind: 'lead' },
          text: 'Inspect the new durable evidence before reviewing.',
          status: 'persisted',
          createdAt: harness.nowIso()
        }
      }
    }, 'semantic-steering')
    const semanticProgressSeq = run.lastEventSeq
    await supervisor.sweepObligations()
    await supervisor.flush(HELP_SIGNAL.runId)

    run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run)).toMatchObject({
      state: 'retry_scheduled',
      noProgressCount: 0,
      lastProgressSeq: semanticProgressSeq
    })
    expect(run.status).toBe('running')
    expectDurableLiveness(run, harness.nowMs())
    await supervisor.stop()
  })

  it('resolves a review obligation when its durable review predicate disappears', async () => {
    const harness = await persistentHarness()
    let run = await submitReviewableAttempt(harness)
    const supervisor = supervisorFor(harness, {
      leadTurn: async () => {
        throw new Error('review predicate should resolve before delivery')
      }
    })
    await supervisor.signal({
      runId: run.id,
      reason: 'submitted',
      nodeIds: ['research'],
      digest: 'Source Lead review is required.'
    })
    const attempt = run.nodes.research!.attempts.at(-1)!
    run = await appendEvent(harness, {
      type: 'review_recorded',
      payload: {
        review: {
          version: GRAPH_CONTRACT_VERSION,
          reviewId: 'review_lead_predicate_resolved',
          nodeId: 'research',
          attemptId: attempt.id,
          reviewerKind: 'lead',
          outcome: 'pass',
          summary: 'The source Lead accepted the durable result.',
          evidence: ['reviewed durable evidence'],
          artifactRefs: [],
          createdAt: harness.nowIso()
        }
      }
    }, 'lead-review')

    expect(graphSupervisionObligationIsActionable(run, onlyObligation(run))).toBe(false)
    await supervisor.sweepObligations()
    run = (await harness.store.get(run.id))!
    expect(onlyObligation(run)).toMatchObject({
      state: 'resolved',
      resolvedAt: harness.nowIso()
    })
    expect(await durableEventTypes(harness.store)).toContain('supervision_obligation_resolved')
    await supervisor.stop()
  })

  it('repairs a persisted attention obligation whose run transition was interrupted', async () => {
    const harness = await persistentHarness()
    let run = await transitionRunToRunning(harness)
    const candidate = graphSupervisionObligationForSignal(
      run,
      HELP_SIGNAL,
      harness.nowIso()
    )
    run = await appendEvent(harness, {
      type: 'supervision_obligation_updated',
      payload: {
        obligation: {
          ...candidate,
          state: 'needs_attention',
          attentionReason: 'Persisted source-owner failure requires attention.'
        }
      }
    }, 'partial-attention')
    expect(run.status).toBe('running')

    const reopenedStore = new FileGraphRunStore(harness.storeOptions)
    const supervisor = supervisorFor(harness, { store: reopenedStore })
    await supervisor.sweepObligations()
    run = (await reopenedStore.get(run.id))!
    expect(run.status).toBe('awaiting_human')
    expect(onlyObligation(run).state).toBe('needs_attention')
    expectDurableLiveness(run, harness.nowMs())
    await supervisor.stop()
  })

  it('emits at most one supervision_obligation_resolved per obligation after terminal force-resolve and rearm flush (#1082)', async () => {
    // Production race while still delivering:
    // claim → delivering (actionable), leadTurn parks with !executionActive,
    // recordDelivered force-resolves because the run became terminal / non-actionable,
    // then rearmAfterNoProgress maps !actionable to another resolved projection.
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const supervisor = supervisorFor(harness, {
      leadTurn: async ({ run: latest }) => {
        // Become terminal mid-delivery so recordDelivered takes the force-resolve branch.
        await harness.store.append(latest.id, {
          expectedSeq: latest.lastEventSeq,
          graphRevision: latest.currentRevision,
          commandId: 'command_terminal_mid_delivery',
          idempotencyKey: 'obligation-test:terminal-mid-delivery',
          timestamp: harness.nowIso(),
          event: {
            type: 'run_status_changed',
            payload: {
              from: 'running',
              to: 'cancelled',
              reason: 'owning source turn ended with status failed'
            }
          }
        })
        return {
          status: 'delivered' as const,
          sourceTurnId: latest.sourceTurnId,
          deliveredSeq: latest.lastEventSeq,
          executionActive: false,
          parkedWithPendingSupervision: true
        }
      },
      isLeadTurnActive: () => false
    })

    await supervisor.signal(HELP_SIGNAL)
    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    const obligationId = onlyObligation(run).id

    await supervisor.flush(HELP_SIGNAL.runId)
    // Stale queued flushes / sweep after terminal must not double-resolve.
    await supervisor.flush(HELP_SIGNAL.runId)
    await supervisor.sweepObligations()
    await supervisor.sweepObligations()
    await supervisor.sweepObligations()

    run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run)).toMatchObject({
      id: obligationId,
      state: 'resolved'
    })
    const resolvedEvents = (await harness.store.events(HELP_SIGNAL.runId, 0))
      .filter((envelope) => envelope.event.type === 'supervision_obligation_resolved')
    expect(resolvedEvents).toHaveLength(1)
    expect(
      resolvedEvents.filter((envelope) =>
        envelope.event.type === 'supervision_obligation_resolved' &&
        envelope.event.payload.obligation.id === obligationId)
    ).toHaveLength(1)
    await supervisor.stop()
  })

  it('does not re-open a resolved obligation via rearmAfterNoProgress (#1082)', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const manager = new GraphSupervisionObligationManager({
      store: harness.store,
      nowIso: harness.nowIso,
      nowMs: harness.nowMs,
      nextId: harness.nextId,
      isLeadTurnActive: () => false
    })
    await manager.persistSignal(HELP_SIGNAL, true)
    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    const obligationId = onlyObligation(run).id
    // First durable resolve.
    await manager.resolve(HELP_SIGNAL.runId, [onlyObligation(run)])
    run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run).state).toBe('resolved')
    const resolvedCount = (await durableEventTypes(harness.store))
      .filter((type) => type === 'supervision_obligation_resolved').length
    expect(resolvedCount).toBe(1)

    // Subsequent rearm / claim force-resolve paths must not re-emit or reopen.
    await manager.rearmAfterNoProgress(HELP_SIGNAL.runId, [obligationId])
    await manager.rearmAfterNoProgress(HELP_SIGNAL.runId, [obligationId])
    await manager.claim(HELP_SIGNAL.runId, [obligationId])
    await manager.recordDelivered(
      HELP_SIGNAL.runId,
      [onlyObligation((await harness.store.get(HELP_SIGNAL.runId))!)],
      {
        status: 'delivered',
        sourceTurnId: 'turn_obligation',
        deliveredSeq: 1,
        executionActive: false
      }
    )
    run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run).state).toBe('resolved')
    expect(['awaiting_action', 'retry_scheduled', 'pending', 'delivering'])
      .not.toContain(onlyObligation(run).state)
    const after = (await durableEventTypes(harness.store))
      .filter((type) => type === 'supervision_obligation_resolved').length
    expect(after).toBe(1)
  })

  it('keeps multi-obligation resolved counts independent under repeated sweeps (#1082)', async () => {
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const supervisor = supervisorFor(harness, {
      leadTurn: async ({ run: latest }) => {
        await harness.store.append(latest.id, {
          expectedSeq: latest.lastEventSeq,
          graphRevision: latest.currentRevision,
          commandId: harness.nextId('command_terminal_multi'),
          idempotencyKey: `obligation-test:terminal-multi:${latest.lastEventSeq}`,
          timestamp: harness.nowIso(),
          event: {
            type: 'run_status_changed',
            payload: { from: latest.status, to: 'cancelled', reason: 'terminal' }
          }
        })
        return {
          status: 'delivered' as const,
          sourceTurnId: latest.sourceTurnId,
          deliveredSeq: latest.lastEventSeq,
          executionActive: false,
          parkedWithPendingSupervision: true
        }
      },
      isLeadTurnActive: () => false
    })

    await supervisor.signal({
      runId: HELP_SIGNAL.runId,
      reason: 'help',
      nodeIds: [],
      digest: 'First durable supervision obligation.'
    })
    await supervisor.signal({
      runId: HELP_SIGNAL.runId,
      reason: 'conflict',
      nodeIds: [],
      digest: 'Second durable supervision obligation with distinct subject.'
    })
    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(run.supervisionObligations.length).toBeGreaterThanOrEqual(2)
    const obligationIds = run.supervisionObligations.map((entry) => entry.id)
    expect(new Set(obligationIds).size).toBe(obligationIds.length)

    await supervisor.flush(HELP_SIGNAL.runId)
    for (let i = 0; i < 5; i += 1) await supervisor.sweepObligations()
    await supervisor.flush(HELP_SIGNAL.runId)

    run = (await harness.store.get(HELP_SIGNAL.runId))!
    for (const obligation of run.supervisionObligations) {
      expect(obligation.state).toBe('resolved')
    }
    const resolvedEvents = (await harness.store.events(HELP_SIGNAL.runId, 0))
      .filter((envelope) => envelope.event.type === 'supervision_obligation_resolved')
    expect(resolvedEvents).toHaveLength(run.supervisionObligations.length)
    for (const id of obligationIds) {
      expect(
        resolvedEvents.filter((envelope) =>
          envelope.event.type === 'supervision_obligation_resolved' &&
          envelope.event.payload.obligation.id === id)
      ).toHaveLength(1)
    }
    await supervisor.stop()
  })

  it('collapses concurrent manager.resolve writers to one durable resolved event (#1082)', async () => {
    // Stable per-obligation resolve idempotency key + FileGraphRunStore append
    // serialization must fold concurrent resolve() calls into a single durable
    // supervision_obligation_resolved event.
    const harness = await persistentHarness()
    await transitionRunToRunning(harness)
    const manager = new GraphSupervisionObligationManager({
      store: harness.store,
      nowIso: harness.nowIso,
      nowMs: harness.nowMs,
      nextId: harness.nextId,
      isLeadTurnActive: () => false
    })
    await manager.persistSignal(HELP_SIGNAL, true)
    let run = (await harness.store.get(HELP_SIGNAL.runId))!
    const obligation = onlyObligation(run)
    expect(obligation.state).not.toBe('resolved')

    await Promise.all([
      manager.resolve(HELP_SIGNAL.runId, [obligation]),
      manager.resolve(HELP_SIGNAL.runId, [obligation])
    ])

    run = (await harness.store.get(HELP_SIGNAL.runId))!
    expect(onlyObligation(run).state).toBe('resolved')
    const resolvedEvents = (await harness.store.events(HELP_SIGNAL.runId, 0))
      .filter((envelope) => envelope.event.type === 'supervision_obligation_resolved')
    expect(resolvedEvents).toHaveLength(1)
    expect(
      resolvedEvents.filter((envelope) =>
        envelope.event.type === 'supervision_obligation_resolved' &&
        envelope.event.payload.obligation.id === obligation.id)
    ).toHaveLength(1)
  })
})
