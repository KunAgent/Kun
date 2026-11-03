/**
 * A relayed runtime event only tells a phone "this history changed, pull it again" plus the newest cursor
 * (KunApp remote/history.ts and shared-task/history.ts). Forwarding every streamed delta as its own frame
 * spent relay frames and phone acks on nothing new, and the relay closes a socket above 256 frames/s or
 * 64 unacked frames. One subscription now sends at most one frame per spacing, carrying the newest event.
 */
export const EVENT_FRAME_SPACING_MS = 200
const CONTROL_KINDS = new Set(['subscribed', 'heartbeat', 'replay_synchronized', 'replay_reset_required'])

/** Newly persisted work. The phone resets its resync backoff only for these, so a control event never displaces one. */
function progress(event: unknown) {
  const value = event as { kind?: unknown; seq?: unknown } | null
  return typeof value?.kind === 'string' && !CONTROL_KINDS.has(value.kind) && Number.isSafeInteger(value.seq)
}

export class EventCoalescer {
  private pending: { event: unknown } | undefined
  private timer?: ReturnType<typeof setTimeout>
  private sentAt = -Infinity
  private stopped = false
  constructor(
    private send: (event: unknown) => void,
    private failed: (error: unknown) => void,
    private spacing = EVENT_FRAME_SPACING_MS
  ) {}
  /** The first event after a quiet spacing goes out at once and throws to the caller like a direct send. */
  push(event: unknown) {
    if (this.stopped) return
    if (!this.pending || progress(event) || !progress(this.pending.event)) this.pending = { event }
    if (this.timer) return
    const wait = this.sentAt + this.spacing - Date.now()
    if (wait <= 0) return this.flush()
    this.timer = setTimeout(() => {
      this.timer = undefined
      try { this.flush() } catch (error) {
        this.stop()
        this.failed(error)
      }
    }, wait)
  }
  /** Sends the held event now, e.g. before a resync notice so the phone still sees the newest cursor. */
  flush() {
    clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = undefined
    if (!pending || this.stopped) return
    this.sentAt = Date.now()
    this.send(pending.event)
  }
  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
  }
}
