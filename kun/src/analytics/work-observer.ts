import { createHash } from 'node:crypto'
import type { RuntimeEvent } from '../contracts/events.js'
import type { Turn } from '../contracts/turns.js'
import { workRequestEpoch, workRunKeySource } from '../contracts/product-analytics-work.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'
import { analyticsErrorCategory } from './error-category.js'
import { analyticsLeaseActive, appendAnalytics, readAnalytics, type PendingAnalytics } from './outbox.js'

type WaitKind = 'approval' | 'user_input'
type WaitOutcome = 'approved' | 'denied' | 'submitted' | 'cancelled' | 'timeout' | 'unknown'
type Fact = {
  threadId: string; turnId: string; kind: string; timestamp: string
  errorCategory?: ReturnType<typeof analyticsErrorCategory>
  wait?: { key: string; kind: WaitKind; status: string }
}
type Wait = { kind: WaitKind; started: number; finished: boolean }
type Run = { runKey: string; started: number; waits: Map<string, Wait> }
const MAX_ACTIVE = 256, MAX_RECENT = 2048, MAX_WAITS = 128, START_WINDOW_MS = 30_000
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const duration = (started: number, finished: number): number => Math.max(0, Math.min(86_400_000, finished - started))
const lifecycle = new Set(['turn_started', 'turn_completed', 'turn_failed', 'turn_aborted'])

/** Select safe facts before queueing: prompts, approval actions and answers never enter analytics. */
function eventFact(event: RuntimeEvent): Fact | null {
  if (!event.turnId) return null
  const base: Fact = { threadId: event.threadId, turnId: event.turnId, kind: event.kind, timestamp: event.timestamp }
  if (lifecycle.has(event.kind)) {
    if (event.kind === 'turn_failed') base.errorCategory = analyticsErrorCategory('code' in event ? event.code ?? '' : '')
    return base
  }
  if (event.kind === 'approval_requested' || event.kind === 'approval_resolved') {
    // Automatic approval review is execution work, not time spent waiting for a user.
    if (event.approvalReviewer !== 'user') return null
    return { ...base, wait: { key: digest('approval:' + event.approvalId), kind: 'approval', status: event.status } }
  }
  if (event.kind === 'user_input_requested' || event.kind === 'user_input_resolved')
    return { ...base, wait: { key: digest('user_input:' + event.inputId), kind: 'user_input', status: event.status } }
  return null
}

/** Work measures explicitly marked user submissions, never autonomous continuations or child turns. */
export class WorkAnalyticsObserver implements RuntimeEventObserver {
  private lane = Promise.resolve()
  private pending = 0
  private epoch: string | null = null
  private active = new Map<string, Run>()
  private recent = new Map<string, number>()

  constructor(private readonly deps: {
    store: RoomStore
    threads: Pick<ThreadStore, 'get'>
    turns: { getTurn(threadId: string, turnId: string): Promise<Turn | null> }
  }) {}

  record(event: RuntimeEvent): void {
    if (!analyticsLeaseActive(this.deps.store)) { this.clear(); return }
    if (this.pending >= 100) return
    const fact = eventFact(event)
    if (!fact) return
    this.pending++
    this.lane = this.lane.then(() => this.observe(fact)).catch(() => {}).finally(() => { this.pending-- })
  }

  private clear(): void {
    this.epoch = null
    this.active.clear()
    this.recent.clear()
  }

  private async observe(fact: Fact): Promise<void> {
    const state = (await readAnalytics(this.deps.store)).value
    if (!state.epoch || state.leaseUntil <= Date.now() || state.workAnalyticsVersion !== 1) { this.clear(); return }
    if (this.epoch !== state.epoch) { this.clear(); this.epoch = state.epoch }
    const at = Date.parse(fact.timestamp)
    if (!Number.isFinite(at) || fact.timestamp < state.after || at > Date.now() + 5_000) return
    const key = digest(fact.threadId + ':' + fact.turnId)
    let run = this.active.get(key)
    if (fact.kind === 'turn_started') {
      if (run || Date.now() - at > START_WINDOW_MS) return
      const thread = await this.deps.threads.get(fact.threadId)
      const turn = await this.deps.turns.getTurn(fact.threadId, fact.turnId)
      if (!thread || !turn || (turn.agentSurface ?? thread.agentSurface) !== 'write' ||
        turn.clientSurface !== 'gui' || turn.messageSource || thread.parentThreadId || thread.executionUnit ||
        thread.ownerExtensionId || thread.historyRefId || thread.roomContext || thread.workbenchOrigin ||
        !turn.clientRequestId || workRequestEpoch(turn.clientRequestId) !== state.epoch) return
      const runKey = digest(workRunKeySource(turn.clientRequestId))
      for (const [seen, timestamp] of this.recent)
        if (Date.now() - timestamp > START_WINDOW_MS) this.recent.delete(seen)
      if (this.recent.has(runKey) || this.active.size >= MAX_ACTIVE || this.recent.size >= MAX_RECENT ||
        [...this.active.values()].some(active => active.runKey === runKey)) return
      run = { runKey, started: at, waits: new Map() }
      this.active.set(key, run)
      this.recent.set(runKey, at)
      await this.append(state.epoch, run, 'start', fact.timestamp, 'run_started', {})
      return
    }
    if (!run || at < run.started) return
    if (fact.wait) {
      await this.observeWait(state.epoch, run, fact)
      return
    }
    if (!lifecycle.has(fact.kind)) return
    const status = fact.kind === 'turn_completed' ? 'completed' : fact.kind === 'turn_failed' ? 'failed' : 'cancelled'
    for (const [waitKey, wait] of run.waits) {
      if (!wait.finished) await this.finishWait(state.epoch, run, waitKey, wait, fact.timestamp,
        status === 'cancelled' ? 'cancelled' : 'unknown')
    }
    await this.append(state.epoch, run, 'end', fact.timestamp, 'run_finished', {
      status, durationMs: duration(run.started, at), ...(fact.errorCategory ? { errorCategory: fact.errorCategory } : {})
    })
    this.active.delete(key)
  }

  private async observeWait(epoch: string, run: Run, fact: Fact): Promise<void> {
    const input = fact.wait!
    const requested = fact.kind.endsWith('_requested')
    const existing = run.waits.get(input.key)
    if (requested) {
      if (input.status !== 'pending' || existing || run.waits.size >= MAX_WAITS) return
      run.waits.set(input.key, { kind: input.kind, started: Date.parse(fact.timestamp), finished: false })
      await this.append(epoch, run, 'wait-start:' + input.key, fact.timestamp, 'work_wait_started', { waitKind: input.kind })
      return
    }
    if (!existing || existing.finished || Date.parse(fact.timestamp) < existing.started || input.status === 'pending') return
    const outcomes: Record<string, WaitOutcome> = input.kind === 'approval'
      ? { allowed: 'approved', denied: 'denied', expired: 'unknown' }
      : { submitted: 'submitted', cancelled: 'cancelled', timeout: 'timeout' }
    await this.finishWait(epoch, run, input.key, existing, fact.timestamp, outcomes[input.status] ?? 'unknown')
  }

  private async finishWait(epoch: string, run: Run, key: string, wait: Wait, timestamp: string, outcome: WaitOutcome): Promise<void> {
    wait.finished = true
    await this.append(epoch, run, 'wait-end:' + key, timestamp, 'work_wait_finished', {
      waitKind: wait.kind, waitOutcome: outcome, durationMs: duration(wait.started, Date.parse(timestamp))
    })
  }

  private async append(epoch: string, run: Run, suffix: string, occurredAt: string,
    name: PendingAnalytics['name'], properties: PendingAnalytics['properties']): Promise<void> {
    const hash = digest(epoch + ':' + run.runKey + ':' + suffix)
    const eventId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
    await appendAnalytics(this.deps.store, epoch, { eventId, occurredAt, name, properties: { mode: 'work', runKey: run.runKey, ...properties } })
  }
}
