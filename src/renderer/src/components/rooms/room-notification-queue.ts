export type RoomNotificationEvent = {
  seq: number; roomId: string; kind: string; payload?: { id?: string; taskId?: string }
}
type Pending = { event: RoomNotificationEvent; attempts: number; retryAt: number }
type State = { cursor: number; pending: Record<string, Pending>; notified: string[] }
/** Event acknowledgement and notification delivery have separate durable lifetimes. */
export class RoomNotificationQueue {
  private state: State
  private draining?: Promise<void>
  constructor(initialCursor: number, private readonly persist: (value: string) => void, saved?: string | null) {
    this.state = { cursor: Number.isSafeInteger(initialCursor) && initialCursor >= 0 ? initialCursor : 0, pending: {}, notified: [] }
    try {
      const parsed = JSON.parse(saved ?? 'null') as State | null
      if (parsed && Number.isSafeInteger(parsed.cursor) && parsed.cursor >= 0 && parsed.pending &&
        Array.isArray(parsed.notified)) this.state = parsed
    } catch { /* A damaged cache starts from the server cursor; room state remains canonical. */ }
  }
  get cursor() { return this.state.cursor }
  get pendingCount() { return Object.keys(this.state.pending).length }
  private save() {
    try { this.persist(JSON.stringify(this.state)); return true } catch { return false }
  }
  accept(event: RoomNotificationEvent) {
    if (!Number.isSafeInteger(event.seq) || event.seq <= this.state.cursor) return false
    if (/^(task|integration|request)\./.test(event.kind) && event.payload?.id) {
      const key = JSON.stringify([event.roomId, event.kind.split('.')[0], event.payload.id])
      this.state.pending[key] = { event, attempts: 0, retryAt: 0 }
    }
    const previous = this.state.cursor
    this.state.cursor = event.seq
    if (!this.save()) this.state.cursor = previous
    return true
  }
  drain(deliver: (event: RoomNotificationEvent, known: (key: string) => boolean) => Promise<string | null>, now = Date.now()) {
    if (this.draining) return this.draining
    this.draining = (async () => {
      for (const [id, pending] of Object.entries(this.state.pending)) {
        if (pending.retryAt > now) continue
        try {
          const key = await deliver(pending.event, (key) => this.state.notified.includes(key))
          if (key && !this.state.notified.includes(key)) {
            this.state.notified.push(key)
            this.state.notified = this.state.notified.slice(-2000)
          }
          if (this.state.pending[id] === pending) delete this.state.pending[id]
        } catch {
          if (this.state.pending[id] === pending) {
            pending.attempts++
            pending.retryAt = now + Math.min(30000, 1000 * 2 ** Math.min(5, pending.attempts - 1))
          }
        }
        this.save()
      }
    })().finally(() => { this.draining = undefined })
    return this.draining
  }
}
