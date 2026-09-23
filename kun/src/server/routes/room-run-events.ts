import { isPublicRuntimeEvent, type RuntimeEvent } from '../../contracts/events.js'
import type { RoomRunEvent } from '../../contracts/room-run-query.js'
import type { RoomRuntimeDeps } from '../../rooms/room-runtime-types.js'
import { inspectRoomRun, encodeRunCursor, type RoomRunCursor } from '../../rooms/room-run-query.js'
import type { ServerRuntime } from './server-runtime.js'

async function boundedEvents(deps: RoomRuntimeDeps, threadId: string, sinceSeq: number) {
  if (deps.sessions.loadEventPage) return deps.sessions.loadEventPage(threadId, { sinceSeq,
    maxEvents: 128, maxBytes: 256 * 1024, maxRecordBytes: 4 * 1024 * 1024 })
  if (!deps.sessions.iterateEventsSince) return undefined
  const events: RuntimeEvent[] = []
  let bytes = 0
  for await (const event of deps.sessions.iterateEventsSince(threadId, sinceSeq, { maxRecordBytes: 4 * 1024 * 1024 })) {
    const size = Buffer.byteLength(JSON.stringify(event))
    if (events.length && (events.length >= 128 || bytes + size > 256 * 1024)) return { events, hasMore: true }
    bytes += size
    events.push(event)
  }
  return { events, hasMore: false }
}

/** Replay is a coalesced invalidation feed. Canonical content stays behind bounded item pages. */
export async function roomRunEventPage(deps: RoomRuntimeDeps, roomId: string, runId: string,
  before: RoomRunCursor): Promise<{ events: RoomRunEvent[]; cursor: string }> {
  const current = await inspectRoomRun(deps, roomId, runId)
  const next = { ...before, revision: current.row.revision, availability: current.availability.status }
  let updated = next.revision !== before.revision || Boolean(before.availability && before.availability !== next.availability)
  let items = false, reset = before.revision > current.row.revision ||
    (before.availability === 'available' && next.availability !== 'available')
  if (current.availability.status === 'available' && current.run.threadId && current.run.turnId) {
    const threadId = current.run.threadId
    const highest = await deps.sessions.highestSeq(threadId)
    const floor = await deps.sessions.eventReplayFloorSeq?.(threadId) ?? 0
    if (before.seq > highest || before.seq < floor - 1) {
      next.seq = highest
      reset = true
    } else if (highest > before.seq) {
      let page
      try { page = await boundedEvents(deps, threadId, before.seq) }
      catch (error) {
        if (!/record exceeds|record.*too large/i.test(String(error))) throw error
        // Oversized historical records must not trap reconnect in an endless replay loop.
        // Refresh from the bounded item projection at the new checkpoint instead.
        next.seq = highest
        items = true
        updated = true
        page = { events: [], hasMore: false }
      }
      if (!page) { next.seq = highest; items = true; updated = true }
      else {
        for (const event of page.events) {
          next.seq = Math.max(next.seq, event.seq)
          const turnId = ('turnId' in event ? event.turnId : undefined) ?? ('item' in event ? event.item.turnId : undefined)
          if (event.threadId !== threadId || !isPublicRuntimeEvent(event) || turnId !== current.run.turnId) continue
          items = true
          if (event.kind.startsWith('turn_') || event.kind.startsWith('approval_') ||
            event.kind.startsWith('user_input_') || event.kind === 'usage') updated = true
        }
        if (!page.hasMore) next.seq = highest
      }
    }
  }
  const cursor = encodeRunCursor(next)
  const event = (kind: RoomRunEvent['kind']): RoomRunEvent => ({ kind, roomId, runId, cursor })
  const events: RoomRunEvent[] = reset ? [event('run.reset')] : [
    ...(updated ? [event('run.updated')] : []), ...(items ? [event('run.items_changed')] : [])]
  if (!events.length && cursor !== encodeRunCursor(before)) events.push(event('run.cursor'))
  return { events, cursor }
}

export function roomRunEventStream(input: {
  runtime: ServerRuntime; deps: RoomRuntimeDeps; roomId: string; runId: string
  request: Request; cursor: RoomRunCursor
}): Response {
  let cursor = input.cursor, closed = false, lastSent = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let unregister: (() => void) | undefined
  const encoder = new TextEncoder()
  const close = (): void => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    unregister?.()
    input.request.signal.removeEventListener('abort', close)
    try { controller?.close() } catch { /* reader already cancelled */ }
  }
  const poll = async (): Promise<void> => {
    if (closed || !controller) return
    try {
      if ((controller.desiredSize ?? 0) > 0) {
        const page = await roomRunEventPage(input.deps, input.roomId, input.runId, cursor)
        if (closed) return
        // Cursors are host-produced and already verified for this run.
        cursor = JSON.parse(Buffer.from(page.cursor, 'base64url').toString('utf8')) as RoomRunCursor
        if (page.events.length) {
          controller.enqueue(encoder.encode(page.events.map((event) =>
            `id: ${page.cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join('')))
          lastSent = Date.now()
        } else if (Date.now() - lastSent >= 15_000) {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          lastSent = Date.now()
        }
      }
    } catch (error) { console.warn('[kun] room run stream:', error instanceof Error ? error.message : String(error)); close() }
    finally {
      if (!closed) { timer = setTimeout(() => void poll(), 500); timer.unref?.() }
    }
  }
  const stream = new ReadableStream<Uint8Array>({ start(value) {
    controller = value
    input.request.signal.addEventListener('abort', close, { once: true })
    unregister = input.runtime.eventStreamRegistry?.register(`room-run:${input.roomId}:${input.runId}`, close)
    if (input.request.signal.aborted) { close(); return }
    controller.enqueue(encoder.encode('retry: 1000\n: connected\n\n'))
    void poll()
  }, cancel: close })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } })
}
