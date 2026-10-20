import { analyticsErrorCategory } from './error-category.js'
import { codeWardrobeThread } from '../rooms/code-wardrobe-observer.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { createHash } from 'node:crypto'
import type { RuntimeEvent } from '../contracts/events.js'
import type { Turn } from '../contracts/turns.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'
import { readAnalytics, appendAnalytics, analyticsLeaseActive } from './outbox.js'

/** Optional observer: never wait on disk/network in the runtime's event pipeline. */
export class ProductAnalyticsObserver implements RuntimeEventObserver {
  private lane = Promise.resolve()
  private pending = 0
  private active = new Map<string, { epoch: string; started: number; mode: 'code' | 'room'; runKey: string }>()
  constructor(private readonly deps: { store: RoomStore; threads: Pick<ThreadStore, 'get'>;
    turns: { getTurn(threadId: string, turnId: string): Promise<Turn | null> } }) {}
  record(event: RuntimeEvent): void {
    if (!analyticsLeaseActive(this.deps.store)) { this.active.clear(); return }
    if (!['turn_started', 'turn_completed', 'turn_failed', 'turn_aborted'].includes(event.kind) || !event.turnId || this.pending >= 100) return
    // Capture only opaque identifiers; never keep full runtime payloads in this queue.
    const { threadId, turnId, kind, timestamp } = event
    const category = kind === 'turn_failed' ? analyticsErrorCategory('code' in event && typeof event.code === 'string' ? event.code : '') : undefined
    this.pending++
    this.lane = this.lane.then(() => this.observe(threadId, turnId, kind, timestamp, category))
      .catch(() => {}).finally(() => { this.pending-- })
  }
  private async observe(threadId: string, turnId: string, kind: string, timestamp: string, errorCategory?: ReturnType<typeof analyticsErrorCategory>) {
    const state = (await readAnalytics(this.deps.store)).value
    if (!state.epoch || state.leaseUntil < Date.now()) { this.active.clear(); return }
    const key = createHash('sha256').update(threadId + ':' + turnId).digest('hex')
    let start = this.active.get(key)
    if (kind === 'turn_started') {
      if (timestamp < state.after || Date.now() - Date.parse(timestamp) > 30_000) return
      const thread = await this.deps.threads.get(threadId)
      const turn = await this.deps.turns.getTurn(threadId, turnId)
      if (!thread || !turn || turn.messageSource || thread.parentThreadId || thread.executionUnit || thread.ownerExtensionId ||
        thread.workbenchOrigin || thread.designProfile || thread.workspaceMode === 'ade' ||
        (turn.clientSurface && turn.clientSurface !== 'gui') || (!thread.roomContext && !codeWardrobeThread(thread))) return
      if (this.active.size >= 256) return
      start = { epoch: state.epoch, started: Date.parse(timestamp), mode: thread.roomContext ? 'room' : 'code', runKey: thread.roomContext && turn.clientRequestId
        ? createHash('sha256').update(roomRunId(thread.roomContext.roomId, turn.clientRequestId)).digest('hex') : key }
      this.active.set(key, start)
    }
    if (!start || start.epoch !== state.epoch) { this.active.delete(key); return }
    const finished = kind !== 'turn_started'
    const digest = createHash('sha256').update(state.epoch + ':' + key + ':' + (finished ? 'end' : 'start')).digest('hex')
    const eventId = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`
    await appendAnalytics(this.deps.store, state.epoch, { eventId, occurredAt: timestamp,
      name: finished ? 'run_finished' : 'run_started', properties: { mode: start.mode, runKey: start.runKey, ...(errorCategory ? { errorCategory } : {}),
        ...(finished ? { status: kind === 'turn_completed' ? 'completed' : kind === 'turn_failed' ? 'failed' : 'cancelled',
          durationMs: Math.max(0, Math.min(86_400_000, Date.parse(timestamp) - start.started)) } : {}) } })
    if (finished) this.active.delete(key)
  }
}
