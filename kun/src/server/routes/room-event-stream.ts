import type { RoomStoreEvent } from '../../rooms/room-store.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { ServerRuntime } from './server-runtime.js'
import { onRoomStoreCommit } from '../../rooms/room-commit-signal.js'

/** Poll cadence after events arrive, and the cap while a room stays quiet. */
const ACTIVE_POLL_MS = 500
const QUIET_POLL_MAX_MS = 2_000

/** Durable, bounded replay with backpressure; no unbounded live event buffer. */
export function roomEventStream(input: {
  runtime: ServerRuntime
  rooms: RoomRuntime
  roomId: string
  request: Request
  sinceSeq: number
  projectEvent?(event: RoomStoreEvent): RoomStoreEvent | null
}): Response {
  const encoder = new TextEncoder()
  let cursor = input.sinceSeq
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let unregister: (() => void) | undefined
  let stopWake: (() => void) | undefined
  let lastSentAt = Date.now()
  let quietPolls = 0
  let polling = false
  let wakeRequested = false
  const close = (): void => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    input.request.signal.removeEventListener('abort', close)
    unregister?.()
    stopWake?.()
    try { streamController?.close() } catch { /* cancelled stream */ }
  }
  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => { timer = undefined; void poll() }, delayMs)
    timer.unref?.()
  }
  // A local room write ends the quiet backoff right away.
  const wake = (): void => {
    quietPolls = 0
    if (closed) return
    if (polling) { wakeRequested = true; return }
    if (timer) { clearTimeout(timer); schedule(0) }
  }
  const poll = async (): Promise<void> => {
    if (closed || !streamController) return
    polling = true
    let delivered = false
    try {
      if ((streamController.desiredSize ?? 0) > 0) {
        const events = await input.rooms.service.store.events(input.roomId, cursor, 100)
        if (closed) return
        if (events.length) {
          const projected = input.projectEvent ? events.flatMap((event) => { const value = input.projectEvent!(event); return value ? [value] : [] }) : events
          if (projected.length) {
            streamController.enqueue(encoder.encode(projected.map((event) =>
              `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join('')))
            lastSentAt = Date.now()
          }
          cursor = events.at(-1)!.seq
          delivered = true
        }
        if (Date.now() - lastSentAt > 15_000) {
          streamController.enqueue(encoder.encode(': heartbeat\n\n'))
          lastSentAt = Date.now()
        }
      }
    } catch {
      // Disconnect on persistence loss. Reconnecting clients resume from last durable ID.
      close()
    } finally {
      polling = false
      if (!closed) {
        quietPolls = delivered || wakeRequested ? 0 : quietPolls + 1
        const delay = wakeRequested ? 0 : Math.min(QUIET_POLL_MAX_MS, ACTIVE_POLL_MS * 2 ** Math.min(2, quietPolls))
        wakeRequested = false
        schedule(delay)
      }
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      input.request.signal.addEventListener('abort', close, { once: true })
      unregister = input.runtime.eventStreamRegistry?.register(`room:${input.roomId}`, close)
      stopWake = onRoomStoreCommit(wake)
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
