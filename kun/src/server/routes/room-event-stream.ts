import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { ServerRuntime } from './server-runtime.js'

/** Durable, bounded replay with backpressure; no unbounded live event buffer. */
export function roomEventStream(input: {
  runtime: ServerRuntime
  rooms: RoomRuntime
  roomId: string
  request: Request
  sinceSeq: number
}): Response {
  const encoder = new TextEncoder()
  let cursor = input.sinceSeq
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let unregister: (() => void) | undefined
  let lastSentAt = Date.now()
  const close = (): void => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    input.request.signal.removeEventListener('abort', close)
    unregister?.()
    try { streamController?.close() } catch { /* cancelled stream */ }
  }
  const poll = async (): Promise<void> => {
    if (closed || !streamController) return
    try {
      if ((streamController.desiredSize ?? 0) > 0) {
        const events = await input.rooms.service.store.events(input.roomId, cursor, 100)
        if (closed) return
        if (events.length) {
          streamController.enqueue(encoder.encode(events.map((event) =>
            `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join('')))
          cursor = events.at(-1)!.seq
          lastSentAt = Date.now()
        } else if (Date.now() - lastSentAt > 15_000) {
          streamController.enqueue(encoder.encode(': heartbeat\n\n'))
          lastSentAt = Date.now()
        }
      }
    } catch {
      // Disconnect on persistence loss. Reconnecting clients resume from last durable ID.
      close()
    } finally {
      if (!closed) {
        timer = setTimeout(() => void poll(), 500)
        timer.unref?.()
      }
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      input.request.signal.addEventListener('abort', close, { once: true })
      unregister = input.runtime.eventStreamRegistry?.register(`room:${input.roomId}`, close)
      if (input.request.signal.aborted) { close(); return }
      controller.enqueue(encoder.encode('retry: 1000\n: connected\n\n'))
      void poll()
    },
    cancel: close
  })
  return new Response(stream, { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no'
  } })
}
