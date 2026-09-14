import type { RuntimeEvent } from '../../contracts/events.js'
import type { RoomMessage } from '../../contracts/rooms.js'
import type { RoomRunRecord } from '../../contracts/room-runs.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../../rooms/room-runtime-types.js'
import type { EventBus } from '../../ports/event-bus.js'
import { inspectRoomRun } from '../../rooms/room-run-query.js'
import { roomTurnItems } from '../../rooms/room-item-history.js'
import { agentStableId } from '../../agents/agent-identity-service.js'

/** Offset-aware projection: a hydration snapshot may already include a replayed delta. */
export function applyRunText(parts: Map<string, string>, event: RuntimeEvent) {
  if (!('item' in event) || event.item.kind !== 'assistant_text') return false
  if (!parts.has(event.item.id) && parts.size >= 128) return false
  const id = event.item.id, text = event.item.text.slice(0, 64000), old = parts.get(id) ?? ''
  if (event.kind === 'assistant_text_delta') {
    const offset = event.deltaOffset
    if (offset === undefined || offset > old.length) return false
    parts.set(id, (old + text.slice(Math.max(0, old.length - offset))).slice(0, 64000))
  } else if (['item_created', 'item_updated', 'item_completed'].includes(event.kind)) {
    // Do not let an earlier buffered snapshot erase text already hydrated from disk.
    if (text.length >= old.length || event.kind === 'item_completed') parts.set(id, text)
  }
  return parts.get(id) !== old
}

/** Presentation-only, bound to one host-verified run. Never persists drafts or wakes Agents. */
export class RoomRunTextStream {
  private off?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private starting = false
  private busy = false
  private dirty = false
  private hydrated = false
  private parts = new Map<string, string>()
  private buffered: RuntimeEvent[] = []
  private run?: RoomRunRecord
  private message?: RoomMessage
  private last = ''
  constructor(private deps: RoomRuntimeDeps, private bus: EventBus, private roomId: string, private runId: string,
    private emit: (message: RoomMessage | null) => boolean) {}
  async start() {
    if (this.closed || this.off || this.starting) return
    this.starting = true
    try {
      const { run, availability } = await inspectRoomRun(this.deps, this.roomId, this.runId)
      if (run.phase !== 'conversation') { this.close(); return }
      if (this.closed || availability.status !== 'available' || !run.threadId || !run.turnId || !run.requestId) return
      this.run = run
      this.off = this.bus.subscribe(run.threadId, (event) => {
        if (this.closed || event.threadId !== run.threadId || ('turnId' in event ? event.turnId : 'item' in event ? event.item.turnId : undefined) !== run.turnId) return
        if (!this.hydrated) { if (this.buffered.length < 128 && 'item' in event && event.item.kind === 'assistant_text') this.buffered.push({ ...event, item: { ...event.item, text: event.item.text.slice(0, 64000) } }); return }
        if (applyRunText(this.parts, event) || event.kind.startsWith('turn_')) this.schedule()
      })
      const rows: Array<{ id: string; text: string }> = []
      let replayAfter = await this.deps.sessions.highestSeq(run.threadId)
      let chars = 0
      if (this.deps.sessions.loadItemPage) {
        let before: string | undefined
        const cursors = new Set<string>()
        for (let count = 0; count < 32; count++) {
          const page = await this.deps.sessions.loadItemPage(run.threadId, { turnId: run.turnId, before, maxItems: 200, maxBytes: 1024 * 1024 })
          if (page.replayAfterSeq !== undefined) replayAfter = Math.min(replayAfter, page.replayAfterSeq)
          for (const item of [...page.items].reverse()) if (item.kind === 'assistant_text' && item.threadId === run.threadId && item.turnId === run.turnId) {
            rows.unshift({ id: item.id, text: item.text.slice(0, 64000) }); chars += item.text.length
          }
          if (!page.hasMore || chars >= 64000 || rows.length >= 128 || !page.nextCursor || cursors.has(page.nextCursor)) break
          cursors.add(page.nextCursor); before = page.nextCursor
        }
      } else for await (const item of roomTurnItems(this.deps.sessions, run.threadId, run.turnId)) {
        if (item.kind === 'assistant_text') { rows.unshift({ id: item.id, text: item.text.slice(0, 64000) }); chars += item.text.length }
        if (chars >= 64000 || rows.length >= 128) break
      }
      if (this.closed) return
      for (const item of rows.slice(-128)) this.parts.set(item.id, item.text)
      // Live checkpoints expose their represented sequence; the production bus
      // intentionally retains no history. Close the hydration gap from durable pages.
      if (this.deps.sessions.loadEventPage) {
        let sinceSeq = Math.max(replayAfter, run.usageSinceSeq ?? 0), eventCursor: string | undefined
        const through = await this.deps.sessions.highestSeq(run.threadId)
        for (let count = 0; count < 32 && sinceSeq < through && !this.closed; count++) {
          const page = await this.deps.sessions.loadEventPage(run.threadId, { sinceSeq, cursor: eventCursor, maxEvents: 128, maxBytes: 256 * 1024, maxRecordBytes: 4 * 1024 * 1024 })
          for (const event of page.events) if (event.threadId === run.threadId && 'item' in event && event.item.turnId === run.turnId) applyRunText(this.parts, event)
          if (!page.hasMore || !page.events.length || page.events.at(-1)!.seq >= through) break
          if (page.nextCursor) eventCursor = page.nextCursor
          else sinceSeq = page.events.at(-1)!.seq
        }
      } else if (this.deps.sessions.iterateEventsSince) {
        const through = await this.deps.sessions.highestSeq(run.threadId)
        let count = 0, bytes = 0
        for await (const event of this.deps.sessions.iterateEventsSince(run.threadId, Math.max(replayAfter, run.usageSinceSeq ?? 0), { maxRecordBytes: 4 * 1024 * 1024 })) {
          if (this.closed || event.seq > through || ++count > 4096 || (bytes += Buffer.byteLength(JSON.stringify(event))) > 8 * 1024 * 1024) break
          if (event.threadId === run.threadId && 'item' in event && event.item.turnId === run.turnId) applyRunText(this.parts, event)
        }
      }
      for (const event of this.buffered) applyRunText(this.parts, event)
      this.buffered = []; this.hydrated = true
      const request = await this.deps.store.get<RoomRequestState>('request', run.requestId)
      const source = request ? await this.deps.store.get<RoomMessage>('message', request.value.sourceMessageId) : null
      this.message = { id: agentStableId('private-message', run.id), roomId: run.roomId, originRunId: run.id,
        rootRequestId: run.rootRequestId, sourceRequestId: run.requestId, authorKind: 'member', authorMemberId: run.memberId,
        authorAgentId: run.participantAgentId, authorLabelSnapshot: run.memberLabel, body: '', bodyRevision: 0,
        messageSeq: source?.seq ?? 0, status: 'streaming', mentionMemberIds: [], attachmentIds: [],
        displayThreadRootId: source?.value.replyToMessageId ? source.value.displayThreadRootId : undefined,
        createdAt: run.startedAt ?? run.createdAt }
      this.schedule()
    } finally { this.starting = false }
  }
  private schedule() {
    this.dirty = true
    if (this.closed || this.timer || this.busy) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch((error) => { console.warn('[kun] room text stream:', String(error)); this.close() }) }, 40)
    this.timer.unref?.()
  }
  private async flush() {
    if (this.closed || !this.run?.requestId || !this.message) return
    this.busy = true; this.dirty = false
    try {
      const row = await this.deps.store.get<RoomRequestState>('request', this.run.requestId)
      if (this.closed) return
      if (!row || row.roomId !== this.roomId || row.value.cancellationRequested || ['cancelled', 'failed', 'stopping'].includes(row.value.status)) {
        this.emit(null); this.close(); return
      }
      const body = [...this.parts.values()].join('\n\n').slice(0, 64000)
      if (body && body !== this.last) {
        if (this.emit({ ...this.message, body })) this.last = body
        else this.schedule()
      }
    } finally { this.busy = false; if (this.dirty) this.schedule() }
  }
  close() { this.closed = true; clearTimeout(this.timer); this.off?.(); this.parts.clear(); this.buffered = [] }
}
