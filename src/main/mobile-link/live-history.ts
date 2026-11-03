import { randomUUID } from 'node:crypto'
import { diffHistory, encodeFrames, liveCursor, utf8Size, LIVE_DELTA_MAX_BYTES, type Frame } from '@kun/remote-protocol'

export type LiveKind = 'code' | 'agent' | 'group'
/** Changed pages are re-read at most this often; a fast stream costs about two local reads a second. */
export const LIVE_READ_SPACING_MS = 400
/** A quiet subscription is re-read this often, catching changes that raised no runtime event. */
export const LIVE_IDLE_READ_MS = 30000

export interface LiveHistoryDependencies {
  send(frame: Frame): void
  /** Reads one remote operation for this subscription's phone, under its current authority. */
  read(method: string, params: Record<string, unknown>): Promise<unknown>
  /** The page could not be read; the subscription ends and the phone recovers on its own. */
  failed(error: unknown): void
}

function params(kind: LiveKind, id: string) {
  return kind === 'agent' ? { agentId: id } : kind === 'group' ? { roomId: id } : { threadId: id }
}

/**
 * Keeps one phone's copy of a history page current. The first page goes out whole; after that each
 * runtime event schedules a local re-read and only the difference travels through the relay.
 */
export class LiveHistory {
  private rev = 0
  private page: Record<string, unknown> | undefined
  private timer?: ReturnType<typeof setTimeout>
  private idle?: ReturnType<typeof setTimeout>
  private reading = false
  private dirty = false
  private stopped = false
  private readAt = -Infinity
  constructor(
    private readonly device: string,
    private readonly kind: LiveKind,
    private readonly id: string,
    private readonly deps: LiveHistoryDependencies,
    private readonly spacing = LIVE_READ_SPACING_MS,
    private readonly idleRead = LIVE_IDLE_READ_MS
  ) {}

  /** Sends the first page and returns the event cursor it was read at. */
  async start(): Promise<number> {
    const page = await this.read()
    if (this.stopped) return 0
    this.snapshot(page)
    this.scheduleIdle()
    return liveCursor(this.kind, page)
  }

  /** A runtime event arrived; re-read soon, never more often than the spacing. */
  changed() {
    if (this.stopped || !this.page) return
    this.dirty = true
    if (this.timer || this.reading) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh() },
      Math.max(0, this.readAt + this.spacing - Date.now()))
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearTimeout(this.idle)
    this.timer = this.idle = undefined
  }

  private async read(): Promise<Record<string, unknown>> {
    this.readAt = Date.now()
    const query = params(this.kind, this.id)
    const [page, approvals] = await Promise.all([
      this.deps.read(this.kind + '.history', query),
      this.kind === 'group' ? undefined : this.deps.read('approval.list', query).catch(() => undefined)
    ])
    if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('INVALID_HISTORY')
    return approvals === undefined ? page as Record<string, unknown> : { ...page as Record<string, unknown>, liveApprovals: approvals }
  }

  private async refresh() {
    if (this.stopped || this.reading) return
    this.reading = true
    this.dirty = false
    try {
      const next = await this.read()
      if (this.stopped || !this.page) return
      const diff = diffHistory(this.kind, this.page, next)
      if ('unchanged' in diff) return
      if ('delta' in diff && utf8Size(JSON.stringify(diff.delta)) <= LIVE_DELTA_MAX_BYTES) {
        const base = this.rev
        this.page = next
        this.rev++
        // A dropped delta is detected by the next one's base, so the relay may shed it.
        this.deps.send({ kind: 'event', id: randomUUID(), dst: this.device, lossy: true,
          payload: { resource: this.kind, resourceId: this.id, live: { rev: this.rev, base, delta: diff.delta } } } as Frame)
      } else this.snapshot(next)
    } catch (error) {
      if (!this.stopped) { this.stop(); this.deps.failed(error) }
    } finally {
      this.reading = false
      this.scheduleIdle()
      if (this.dirty && !this.stopped) this.changed()
    }
  }

  private snapshot(page: Record<string, unknown>) {
    const frame: Frame = { kind: 'event', id: randomUUID(), dst: this.device,
      payload: { resource: this.kind, resourceId: this.id, live: { rev: this.rev + 1, snapshot: page } } }
    try { encodeFrames({ v: 1, ...frame }) } catch {
      // Beyond the logical message limit: the phone pulls pages itself instead.
      this.stop()
      this.deps.send({ ...frame, payload: { resource: this.kind, resourceId: this.id, live: { rev: 0, error: 'LIVE_UNAVAILABLE' } } })
      return
    }
    this.page = page
    this.rev++
    this.deps.send(frame)
  }

  private scheduleIdle() {
    clearTimeout(this.idle)
    if (this.stopped) return
    this.idle = setTimeout(() => { this.dirty = true; this.changed() }, this.idleRead)
    this.idle.unref?.()
  }
}
