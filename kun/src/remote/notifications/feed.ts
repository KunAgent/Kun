import { randomUUID } from 'node:crypto'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { codeNotification, agentNotification, type MobileNotificationEvent } from './events.js'
/** One runtime-owned, metadata-only ring. No task writes or execution recovery occur here. */
export class RemoteNotificationFeed {
  private epoch = randomUUID()
  private sequence = 0
  private ring: Array<{ seq: number; createdAt: number; event: MobileNotificationEvent }> = []
  private seen = new Set<string>()
  private listeners = new Set<() => void>()
  private closers = new Set<() => void>()
  private activated = false
  private closed = false
  private pending = 0
  private work: Promise<void> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private roomCursor?: number
  private polling = false
  private graceTimer?: ReturnType<typeof setTimeout>
  constructor(private runtime: ServerRuntime) {
    runtime.events.addObserver(this)
    runtime.registerRemoteCleanup?.(() => this.close())
  }
  private enqueue(task: () => Promise<MobileNotificationEvent | null>): Promise<boolean> {
    if (this.closed || !this.activated || this.pending >= 128) return Promise.resolve(false)
    this.pending++
    const operation = this.work.catch(() => {}).then(async () => {
      if (this.closed) return false
      let event: MobileNotificationEvent | null = null
      for (let attempt = 0; ; attempt++) {
        try { event = await task(); break }
        catch (error) {
          if (attempt >= 2 || this.closed) throw error
          await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
        }
      }
      if (!event || this.closed || this.seen.has(event.eventId)) return true
      this.seen.add(event.eventId); this.ring.push({ seq: ++this.sequence, createdAt: Date.now(), event })
      while (this.ring.length > 512 || this.ring[0]?.createdAt < Date.now() - 3600000) this.seen.delete(this.ring.shift()!.event.eventId)
      for (const listener of this.listeners) listener()
      return true
    }).finally(() => { this.pending-- })
    this.work = operation.then(() => {})
    void this.work.catch(() => {})
    return operation
  }
  record(event: RuntimeEvent) {
    if (['turn_completed', 'turn_failed', 'approval_requested', 'user_input_requested'].includes(event.kind))
      void this.enqueue(() => codeNotification(this.runtime, event)).catch(() => {})
  }
  private async pollRooms() {
    if (this.closed || !this.activated || !this.listeners.size || this.polling) return
    this.polling = true
    try {
      const store = this.runtime.rooms!.deps.store
      if (this.roomCursor === undefined) this.roomCursor = await store.latestEventSeq?.() ?? 0
      const events = await store.events('*', this.roomCursor, 100)
      for (const event of events) {
        if (['request.updated', 'notification.requested'].includes(event.kind) &&
          !await this.enqueue(() => agentNotification(this.runtime, event))) break
        this.roomCursor = event.seq
      }
    } catch { /* metadata is best effort; next pass retries the same durable cursor */ }
    finally {
      this.polling = false
      if (!this.closed && this.listeners.size) { this.timer = setTimeout(() => void this.pollRooms(), 500); this.timer.unref?.() }
    }
  }
  private cursor(seq = this.sequence) { return Buffer.from(JSON.stringify([this.epoch, seq])).toString('base64url') }
  stream(request: Request): Response {
    if (this.closed || this.listeners.size >= 4) return new Response(null, { status: 503 })
    while (this.ring[0]?.createdAt < Date.now() - 3600000) this.seen.delete(this.ring.shift()!.event.eventId)
    let position = this.sequence, reset = false
    const raw = new URL(request.url).searchParams.get('cursor')
    if (raw) {
      try {
        const [epoch, value] = JSON.parse(Buffer.from(raw, 'base64url').toString())
        if (epoch !== this.epoch || !Number.isSafeInteger(value) || value < (this.ring[0]?.seq ?? this.sequence + 1) - 1 || value > this.sequence) reset = true
        else position = value
      } catch { reset = true }
    }
    const encoder = new TextEncoder(), listeners = this.listeners
    let close = () => {}, wake = () => {}
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let ended = false
        const send = () => {
          if (ended) return
          if ((controller.desiredSize ?? 0) <= 0) return
          if (position < (this.ring[0]?.seq ?? this.sequence + 1) - 1) {
            position = this.sequence
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'reset_required', cursor: this.cursor(position) }) + '\n\n'))
            return
          }
          for (const row of this.ring.filter((row) => row.seq > position).slice(0, 100)) {
            if ((controller.desiredSize ?? 0) <= 0) break
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ cursor: this.cursor(row.seq), event: row.event }) + '\n\n'))
            position = row.seq
          }
        }
        wake = send
        const heartbeat = setInterval(() => { if (!ended && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(': heartbeat\n\n')) }, 15000)
        heartbeat.unref?.()
        close = () => {
          if (ended) return
          ended = true; clearInterval(heartbeat); listeners.delete(send); this.closers.delete(close); request.signal.removeEventListener('abort', close)
          if (!listeners.size && !this.closed) {
            clearTimeout(this.timer)
            this.graceTimer = setTimeout(() => { this.activated = false; this.ring = []; this.seen.clear(); this.roomCursor = undefined }, 60000)
            this.graceTimer.unref?.()
          }
          try { controller.close() } catch {}
        }
        const wasEmpty = !listeners.size
        listeners.add(send); this.closers.add(close)
        clearTimeout(this.graceTimer)
        this.activated = true
        if (wasEmpty) { if (!raw) this.roomCursor = undefined; void this.pollRooms() }
        request.signal.addEventListener('abort', close, { once: true })
        controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: reset ? 'reset_required' : 'synchronized', cursor: this.cursor(position) }) + '\n\n'))
        if (request.signal.aborted) close(); else send()
      }, pull: () => wake(), cancel: () => close()
    })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  async close() {
    this.closed = true
    clearTimeout(this.timer); clearTimeout(this.graceTimer)
    for (const close of this.closers) close()
    this.closers.clear(); this.listeners.clear(); this.ring = []; this.seen.clear()
    await this.work.catch(() => {})
  }
}
