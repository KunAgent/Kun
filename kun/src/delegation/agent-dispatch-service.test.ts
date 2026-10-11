import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentDispatchActionSchema,
  publicAgentDispatchIntent,
  type AgentDispatchIntent
} from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeSettings, type KunToolPermissionMode } from '../contracts/policy.js'
import { currentTurnMutationFence, runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
import { FileAgentDispatchIntentStore } from './agent-dispatch-intent-store.js'
import {
  AgentDispatchConflictError, AgentDispatchService,
  type AgentDispatchHandler, type AgentDispatchProposal
} from './agent-dispatch-service.js'

const roots: string[] = []
const services: AgentDispatchService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function setup(overrides: Partial<AgentDispatchHandler> = {}, applicationSessionId = 'app-1') {
  const root = await mkdtemp(join(tmpdir(), 'kun-dispatch-')); roots.push(root)
  const clock = { now: Date.parse('2026-10-07T00:00:00.000Z') }
  const start = vi.fn(async () => ({ threadId: 'child-1' }))
  const cancel = vi.fn(async () => undefined)
  const validate = vi.fn(async () => undefined)
  const handler = { validate, start, cancel, ...overrides }
  const updates: AgentDispatchIntent[] = []
  const store = new FileAgentDispatchIntentStore(root)
  const service = new AgentDispatchService({ store, applicationSessionId, now: () => clock.now,
    onUpdated: (intent) => { updates.push(intent) } })
  service.registerHandler('worker', handler); service.registerHandler('workbench', handler)
  services.push(service); await service.start()
  return { root, store, service, clock, start, cancel, validate, updates, handler }
}

function proposal(mode: KunToolPermissionMode = 'full-access', options: Partial<AgentDispatchProposal> = {}): AgentDispatchProposal {
  return {
    kind: 'worker', source: { threadId: 'parent', turnId: 'turn-1', toolCallId: 'call-1',
      userIntent: 'Please implement the task', actingModelRoute: { model: 'review-model', providerId: 'test' } },
    policySnapshot: kunToolPermissionModeSettings(mode),
    recommendation: { title: 'Implement task', task: 'Write and validate the requested file',
      agentId: 'external-test', permissionMode: mode, agentSelection: 'auto', workspace: '/workspace',
      acceptanceCriteria: ['The file exists and passes checks'] },
    payload: { instructions: 'opaque host instructions' }, ...options
  }
}

describe('durable dispatch decisions', () => {
  it.each(['worker', 'workbench'] as const)('requires human confirmation for %s and uses the durable card', async (kind) => {
    const fixture = await setup()
    const intent = await fixture.service.propose(proposal('ask-for-approval', { kind }))
    await fixture.service.reconcile()
    expect(intent.state).toBe('pending_confirmation'); expect(fixture.start).not.toHaveBeenCalled()
    const action = { action: 'start_now' as const, expectedRevision: intent.revision, requestId: 'accept-1' }
    await fixture.service.act(intent.intentId, action); await fixture.service.reconcile()
    expect(fixture.start).toHaveBeenCalledTimes(1)
    const accepted = await fixture.service.get(intent.intentId)
    expect(accepted).toMatchObject({ state: 'running', intentId: intent.intentId, target: { threadId: 'child-1' } })
    expect(await fixture.service.act(intent.intentId, action)).toEqual(accepted)
    expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await readFile(fixture.store.path, 'utf8')).intents).toHaveLength(1)
  })

  it.each(['worker', 'workbench'] as const)('reviews %s once and starts immediately on allow', async (kind) => {
    const review = vi.fn(async () => ({ decision: 'allow' as const, reason: 'Matches the requested task' }))
    const fixture = await setup({ review })
    const intent = await fixture.service.propose(proposal('approve-for-me', { kind }))
    await fixture.service.reconcile()
    expect(review).toHaveBeenCalledTimes(1); expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'running',
      decision: { decision: 'allow', reason: 'Matches the requested task' } })
    expect(fixture.updates.some((entry) => entry.state === 'countdown')).toBe(false)
  })

  it.each([
    ['denial', async () => ({ decision: 'deny' as const, reason: 'Outside requested scope' }), 'Outside requested scope'],
    ['review failure', async () => { throw new Error('Reviewer unavailable') }, 'Reviewer unavailable']
  ])('shows automatic %s as a failure instead of asking for a click', async (_name, review, error) => {
    const fixture = await setup({ review })
    const intent = await fixture.service.propose(proposal('approve-for-me'))
    await fixture.service.reconcile()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'failed', error: expect.stringContaining(error) })
    expect(fixture.start).not.toHaveBeenCalled()
  })

  it('keeps countdown host-owned and starts the batch once at 60 seconds', async () => {
    const fixture = await setup()
    const first = await fixture.service.propose(proposal('full-access', { batchId: 'batch-1' }))
    fixture.clock.now += 5000
    const second = await fixture.service.propose(proposal('full-access', { batchId: 'batch-1',
      source: { ...proposal().source, toolCallId: 'call-2' } }))
    expect(first.deadline).toBe(second.deadline)
    fixture.clock.now = Date.parse(first.deadline!) - 1
    await fixture.service.reconcile(); expect(fixture.start).not.toHaveBeenCalled()
    fixture.clock.now += 1
    await fixture.service.reconcile(); expect(fixture.start).toHaveBeenCalledTimes(2)
    await fixture.service.reconcile(); expect(fixture.start).toHaveBeenCalledTimes(2)
  })

  it('runs the host timer without any renderer control request', async () => {
    const fixture = await setup()
    await fixture.service.propose(proposal())
    fixture.clock.now += 60_000
    await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1), { timeout: 2500, interval: 10 })
  })

  it.each(['review', 'start'] as const)('keeps other deadlines moving during a slow %s without duplicate work', async (phase) => {
    let release!: () => void, enter!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const review = vi.fn(async (intent: AgentDispatchIntent) => {
      if (intent.source.toolCallId === 'slow' && phase === 'review') { enter(); await blocked }
      return { decision: 'allow' as const }
    })
    const start = vi.fn(async (intent: AgentDispatchIntent) => {
      if (intent.source.toolCallId === 'slow' && phase === 'start') { enter(); await blocked }
      return { threadId: intent.source.toolCallId }
    })
    const fixture = await setup({ review, start })
    const scans = vi.spyOn(fixture.store, 'list')
    const countdown = await fixture.service.propose(proposal())
    await fixture.service.propose(proposal('approve-for-me', { source: { ...proposal().source, toolCallId: 'slow' } }))
    await entered
    try {
      // Let multiple autonomous ticks encounter the blocked operation before expiry.
      await vi.waitFor(() => expect(scans.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 3000 })
      expect(start.mock.calls.some(([intent]) => intent.intentId === countdown.intentId)).toBe(false)
      fixture.clock.now += 60_000
      await vi.waitFor(async () => expect(await fixture.service.get(countdown.intentId)).toMatchObject({ state: 'running' }),
        { timeout: 2000 })
      expect(review).toHaveBeenCalledTimes(1)
      expect(start.mock.calls.filter(([intent]) => intent.intentId === countdown.intentId)).toHaveLength(1)
      expect(start.mock.calls.filter(([intent]) => intent.source.toolCallId === 'slow')).toHaveLength(phase === 'start' ? 1 : 0)
    } finally { release(); await fixture.service.reconcile() }
  }, 7000)

  it('lets cancellation at 59 seconds beat the timer and deduplicates click/timer races', async () => {
    const fixture = await setup()
    const cancelled = await fixture.service.propose(proposal())
    fixture.clock.now += 59_000
    await fixture.service.act(cancelled.intentId, { action: 'cancel', requestId: 'cancel-1', expectedRevision: cancelled.revision })
    fixture.clock.now += 1000; await fixture.service.reconcile()
    expect(fixture.start).not.toHaveBeenCalled()
    const intent = await fixture.service.propose(proposal('full-access', { source: { ...proposal().source, toolCallId: 'racing-call' } }))
    fixture.clock.now += 60_000
    await Promise.allSettled([
      fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'click-1', expectedRevision: intent.revision }),
      fixture.service.reconcile()
    ])
    await fixture.service.reconcile(); expect(fixture.start).toHaveBeenCalledTimes(1)
  })

  it('pauses before editing, rejects stale writes, and restarts a fresh window', async () => {
    const fixture = await setup({ updatePayload: (intent, recommendation) => ({ ...intent.payload, task: recommendation.task }) })
    const intent = await fixture.service.propose(proposal())
    const paused = await fixture.service.act(intent.intentId, { action: 'pause', requestId: 'pause', expectedRevision: intent.revision })
    fixture.clock.now += 90_000; await fixture.service.reconcile()
    expect(fixture.start).not.toHaveBeenCalled()
    await expect(fixture.service.act(intent.intentId, { action: 'resume', requestId: 'stale', expectedRevision: intent.revision }))
      .rejects.toBeInstanceOf(AgentDispatchConflictError)
    const edited = await fixture.service.act(intent.intentId, { action: 'update', requestId: 'edit', expectedRevision: paused.revision,
      recommendation: { task: 'Updated bounded task', agentId: 'another-agent' } })
    expect(edited).toMatchObject({ state: 'countdown', payload: { task: 'Updated bounded task' },
      recommendation: { agentSelection: 'user', agentId: 'another-agent' } })
    expect(Date.parse(edited.deadline!)).toBe(fixture.clock.now + 60_000)
  })

  it('does not block cancellation while an edited recommendation awaits readiness validation', async () => {
    let enteredValidation: () => void = () => undefined, releaseValidation: () => void = () => undefined
    const entered = new Promise<void>((resolve) => { enteredValidation = resolve })
    const blocked = new Promise<void>((resolve) => { releaseValidation = resolve })
    const fixture = await setup({ validate: async (intent) => {
      if (intent.recommendation.task === 'Edited task awaiting readiness') { enteredValidation(); await blocked }
    } })
    const intent = await fixture.service.propose(proposal())
    const paused = await fixture.service.act(intent.intentId, { action: 'pause', requestId: 'pause', expectedRevision: intent.revision })
    const edit = fixture.service.act(intent.intentId, { action: 'update', requestId: 'edit', expectedRevision: paused.revision,
      recommendation: { task: 'Edited task awaiting readiness' } })
    // Observe rejection immediately so a later CAS conflict is never unhandled.
    const outcome = edit.then(() => undefined, (error) => error)
    await entered
    let cancelled = false
    const cancellation = fixture.service.act(intent.intentId, { action: 'cancel', requestId: 'cancel', expectedRevision: paused.revision })
      .then(() => { cancelled = true })
    try { await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 1000, interval: 10 }) }
    finally { releaseValidation() }
    await cancellation
    expect(await outcome).toBeInstanceOf(AgentDispatchConflictError)
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'cancelled' })
  })

  it('revalidates disabled Agents before starting after the intervention window', async () => {
    let enabled = true
    const fixture = await setup({ validate: async () => { if (!enabled) throw new Error('Agent is disabled') } })
    const intent = await fixture.service.propose(proposal())
    enabled = false; fixture.clock.now += 60_000; await fixture.service.reconcile()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'failed', error: expect.stringContaining('Agent is disabled') })
    expect(fixture.start).not.toHaveBeenCalled()
  })

  it('restores an existing deadline for a Runtime restart but gives a new app a full window', async () => {
    const fixture = await setup()
    const intent = await fixture.service.propose(proposal())
    await fixture.service.stop(); fixture.clock.now += 15_000
    const reopen = async (applicationSessionId: string) => {
      const service = new AgentDispatchService({ store: new FileAgentDispatchIntentStore(fixture.root),
        applicationSessionId, now: () => fixture.clock.now })
      service.registerHandler('worker', fixture.handler); services.push(service); await service.start()
      return service
    }
    const sameSession = await reopen('app-1')
    expect((await sameSession.get(intent.intentId))?.deadline).toBe(intent.deadline)
    await sameSession.stop(); fixture.clock.now += 60_000
    const newSession = await reopen('app-2')
    expect((await newSession.get(intent.intentId))?.deadline).toBe(new Date(fixture.clock.now + 60_000).toISOString())
    expect(fixture.start).not.toHaveBeenCalled()
  })

  it('clears the parent mutation fence before a deferred scheduler start', async () => {
    const seen: unknown[] = []
    const fixture = await setup({ start: async () => { seen.push(currentTurnMutationFence()); return { threadId: 'target' } } })
    await runWithTurnMutationFence({ threadId: 'parent', turnId: 'turn-1', ownerFlavor: 'development', ownerInstanceId: 'runtime', fencingToken: 1 },
      () => fixture.service.propose(proposal('approve-for-me')))
    // Default missing reviewer is a visible denial; manual countdown start exercises scheduler isolation.
    const intent = await fixture.service.propose(proposal('full-access', { source: { ...proposal().source, toolCallId: 'countdown' } }))
    fixture.clock.now += 60_000
    await runWithTurnMutationFence({ threadId: 'parent', turnId: 'turn-1', ownerFlavor: 'development', ownerInstanceId: 'runtime', fencingToken: 1 },
      () => fixture.service.reconcile())
    expect(seen).toEqual([undefined]); expect(intent.state).toBe('countdown')
  })

  it('does not dispatch before lifecycle start and removes private payloads from public cards', async () => {
    const fixture = await setup()
    const service = new AgentDispatchService({ store: fixture.store, applicationSessionId: 'app-1', now: () => fixture.clock.now })
    service.registerHandler('worker', fixture.handler); services.push(service)
    const intent = await service.propose(proposal('approve-for-me'))
    expect(fixture.start).not.toHaveBeenCalled()
    const publicIntent = publicAgentDispatchIntent(intent)
    expect(publicIntent).not.toHaveProperty('payload'); expect(publicIntent).not.toHaveProperty('requestLedger')
    expect(publicIntent.source).not.toHaveProperty('userIntent')
    expect(AgentDispatchActionSchema.safeParse({ action: 'update', requestId: 'edit', expectedRevision: 1,
      payload: { source: 'forged' } }).success).toBe(false)
    expect(AgentDispatchActionSchema.safeParse({ action: 'update', requestId: 'edit', expectedRevision: 1,
      recommendation: { permissionMode: 'full-access' } }).success).toBe(false)
  })
})

describe('scheduler reconciliation and cancellation', () => {
  it('polls deadlines while startup recovery is still reviewing another persisted card', async () => {
    const fixture = await setup()
    await fixture.service.stop()
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const recovered = new AgentDispatchService({ store: fixture.store, applicationSessionId: 'app-1', now: () => fixture.clock.now })
    recovered.registerHandler('worker', { ...fixture.handler, review: async () => {
      enter(); await blocked; return { decision: 'allow' }
    } })
    services.push(recovered)
    const countdown = await recovered.propose(proposal())
    await recovered.propose(proposal('approve-for-me', { source: { ...proposal().source, toolCallId: 'recover-review' } }))
    const starting = recovered.start()
    await entered
    try {
      fixture.clock.now += 60_000
      await vi.waitFor(async () => expect(await recovered.get(countdown.intentId)).toMatchObject({ state: 'running' }),
        { timeout: 2500 })
    } finally { release(); await starting }
  })

  it('deduplicates a blocked scan and drains it before shutdown without admitting returned intents', async () => {
    const fixture = await setup()
    const intent = await fixture.service.propose(proposal())
    await fixture.service.reconcile()
    fixture.clock.now += 60_000
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const scans = vi.spyOn(fixture.store, 'list').mockImplementation(async () => { enter(); await blocked; return [intent] })
    const first = fixture.service.reconcile(), second = fixture.service.reconcile()
    await entered
    let stopped = false
    const stopping = fixture.service.stop().then(() => { stopped = true })
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(stopped).toBe(false); expect(scans).toHaveBeenCalledTimes(1)
    } finally { release(); await Promise.all([first, second, stopping]) }
    expect(stopped).toBe(true); expect(fixture.start).not.toHaveBeenCalled()
  })

  it('applies actual target takeover once and preserves admitted execution status', async () => {
    const takeover = vi.fn(async () => undefined)
    const fixture = await setup({ takeover })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile()
    const running = (await fixture.service.get(intent.intentId))!
    const action = { action: 'takeover' as const, requestId: 'takeover', expectedRevision: running.revision }
    await Promise.all([fixture.service.act(intent.intentId, action), fixture.service.act(intent.intentId, action)])
    await fixture.service.reconcile(); await fixture.service.act(intent.intentId, action)
    expect(takeover).toHaveBeenCalledTimes(1)
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'running', takenOver: true,
      takeoverApplied: true, cancellationRequested: false })
    expect(fixture.cancel).not.toHaveBeenCalled()
  })
  it('recovers a persisted interrupted start by querying the target before any retry', async () => {
    const fixture = await setup()
    const intent = await fixture.service.propose(proposal())
    await fixture.service.stop()
    await fixture.store.transaction((file) => {
      const current = file.intents[0]; current.state = 'starting'; current.revision += 1
    })
    const start = vi.fn(async () => ({ threadId: 'unexpected-new-target' }))
    const reconcile = vi.fn(async (current: AgentDispatchIntent) => {
      expect(current.startRequestId).toBe(intent.startRequestId)
      return { state: 'running' as const, target: { threadId: 'accepted-before-crash' } }
    })
    const restarted = new AgentDispatchService({ store: fixture.store, applicationSessionId: 'app-1', now: () => fixture.clock.now })
    restarted.registerHandler('worker', { validate: fixture.validate, start, reconcile }); services.push(restarted)
    await restarted.start()
    expect(reconcile).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled()
    expect(await restarted.get(intent.intentId)).toMatchObject({ state: 'running', target: { threadId: 'accepted-before-crash' } })
  })

  it('aborts and drains in-flight review before shutdown returns', async () => {
    let reviewing: () => void = () => undefined
    const entered = new Promise<void>((resolve) => { reviewing = resolve })
    const fixture = await setup({ review: async (_intent, signal) => {
      reviewing()
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return { decision: 'allow' }
    } })
    const intent = await fixture.service.propose(proposal('approve-for-me'))
    await entered; await fixture.service.stop()
    fixture.clock.now += 120_000; await fixture.service.reconcile()
    expect(fixture.start).not.toHaveBeenCalled()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'reviewing' })
    await expect(fixture.service.act(intent.intentId, { action: 'pause', expectedRevision: 1, requestId: 'too-late' }))
      .rejects.toThrow('stopping')
  })
  it('stops a target admitted while cancellation was racing startup', async () => {
    let resolveStart: (value: { threadId: string }) => void = () => undefined
    let enteredStart: () => void = () => undefined
    const entered = new Promise<void>((resolve) => { enteredStart = resolve })
    const start = vi.fn(() => { enteredStart(); return new Promise<{ threadId: string }>((resolve) => { resolveStart = resolve }) })
    const fixture = await setup({ start })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await entered
    const starting = (await fixture.service.get(intent.intentId))!
    await fixture.service.act(intent.intentId, { action: 'cancel', requestId: 'cancel', expectedRevision: starting.revision })
    resolveStart({ threadId: 'late-target' }); await fixture.service.reconcile()
    expect(start).toHaveBeenCalledTimes(1); expect(fixture.cancel).toHaveBeenCalled()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'stopping', target: { threadId: 'late-target' }, cancellationRequested: true })
  })

  it('does not retry an uncertain start until the adapter proves absence', async () => {
    let existing: 'unknown' | 'absent' = 'unknown'
    const start = vi.fn(async () => { throw new Error('Transport disconnected after submit') })
    const fixture = await setup({ start, reconcile: async () => existing === 'absent' ? { state: 'absent' } : null })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile(); await fixture.service.reconcile()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'uncertain' }); expect(start).toHaveBeenCalledTimes(1)
    existing = 'absent'; await fixture.service.reconcile(); expect(start).toHaveBeenCalledTimes(2)
  })

  it('resumes a verified partial admission using the same stable scheduler identity', async () => {
    const submitted: string[] = []
    const start = vi.fn(async (intent: AgentDispatchIntent) => {
      submitted.push(intent.startRequestId)
      if (submitted.length === 1) throw new Error('Crash between batch items')
      return { workerIds: ['existing-first-worker', 'new-second-worker'] }
    })
    const fixture = await setup({ start, reconcile: async () => submitted.length === 1
      ? { state: 'resume' } : { state: 'running', target: { workerIds: ['existing-first-worker', 'new-second-worker'] } } })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile(); await fixture.service.reconcile()
    expect(submitted).toEqual([intent.startRequestId, intent.startRequestId])
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'running',
      target: { workerIds: ['existing-first-worker', 'new-second-worker'] } })
  })

  it('does not advance the card revision for unchanged target polling', async () => {
    const fixture = await setup({ reconcile: async () => ({ state: 'running', target: { threadId: 'child-1' } }) })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile()
    const before = await fixture.service.get(intent.intentId)
    await fixture.service.reconcile(); await fixture.service.reconcile()
    expect(await fixture.service.get(intent.intentId)).toEqual(before)
  })

  it('reconciles accepted queue targets and cancels them without a second admission', async () => {
    let stopped = false
    const fixture = await setup({ reconcile: async () => stopped ? { state: 'cancelled' } : { state: 'queued' },
      cancel: async () => { stopped = true } })
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile(); await fixture.service.reconcile(); await fixture.service.reconcile()
    expect(fixture.start).toHaveBeenCalledTimes(1)
    const queued = (await fixture.service.get(intent.intentId))!
    expect(queued.state).toBe('queued')
    await fixture.service.act(intent.intentId, { action: 'cancel', requestId: 'cancel', expectedRevision: queued.revision })
    await fixture.service.reconcile()
    expect(await fixture.service.get(intent.intentId)).toMatchObject({ state: 'cancelled' })
  })

  it('allows one replacement only after failed automatic execution and preserves card identity', async () => {
    const fixture = await setup()
    const intent = await fixture.service.propose(proposal('ask-for-approval'))
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start', expectedRevision: intent.revision })
    await fixture.service.reconcile()
    await fixture.service.updateTarget(intent.intentId, { state: 'failed', error: 'Agent stopped after login failure' })
    const replacement = await fixture.service.replace(intent.intentId, { recommendation: { ...intent.recommendation, agentId: 'fallback' },
      payload: { inspected: true }, reason: 'Original execution stopped; edits inspected' })
    expect(replacement).toMatchObject({ intentId: intent.intentId, state: 'pending_confirmation', replacementCount: 1,
      replacementReason: 'Original execution stopped; edits inspected', previousTarget: { threadId: 'child-1' } })
    expect(replacement.startRequestId).not.toBe(intent.startRequestId)
    await fixture.service.act(intent.intentId, { action: 'start_now', requestId: 'start-replacement', expectedRevision: replacement.revision })
    await fixture.service.reconcile(); await fixture.service.updateTarget(intent.intentId, { state: 'failed', error: 'Second failure' })
    await expect(fixture.service.replace(intent.intentId, { recommendation: replacement.recommendation, payload: {} }))
      .rejects.toThrow('another automatic replacement')
  })
})
