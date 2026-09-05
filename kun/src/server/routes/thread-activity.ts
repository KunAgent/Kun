import { jsonResponse, type JsonResponse } from '../response.js'
import type { ThreadActivityRegistry } from '../../services/thread-activity-registry.js'

const HEARTBEAT_MS = 15_000

export async function threadActivityResponse(
  registry: ThreadActivityRegistry,
  request: Request
): Promise<Response | JsonResponse> {
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return threadActivityEventStream(registry, request)
  }
  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const waitRaw = url.searchParams.get('wait_ms')
  const waitMs = waitRaw === null ? 0 : Number(waitRaw)
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000) {
    return jsonResponse({ code: 'validation_error', message: 'invalid wait_ms' }, 400)
  }
  let result = registry.changesSince(cursor)
  if (cursor && !result.resetRequired && result.batch.changes.length === 0 && waitMs > 0) {
    await registry.waitForChange(request.signal, waitMs)
    result = registry.changesSince(cursor)
  }
  return jsonResponse(result.resetRequired
    ? { type: 'reset_required', cursor: result.cursor, reason: result.reason }
    : { type: 'activity', ...result.batch })
}

export function threadActivityEventStream(
  registry: ThreadActivityRegistry,
  request: Request
): Response {
  const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined
  const encoder = new TextEncoder()
  let closed = false
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let removeAbort: (() => void) | undefined
  let deliveredCursor = cursor

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        removeAbort?.()
        try { controller.close() } catch { /* consumer already closed */ }
      }
      const send = (): void => {
        if (closed) return
        const result = registry.changesSince(deliveredCursor)
        try {
          if (result.resetRequired) {
            controller.enqueue(encoder.encode(
              `event: reset_required\ndata: ${JSON.stringify({ cursor: result.cursor, reason: result.reason })}\n\n`
            ))
            deliveredCursor = result.cursor
            return
          }
          if (result.batch.changes.length > 0) {
            controller.enqueue(encoder.encode(
              `id: ${result.batch.cursor}\nevent: activity\ndata: ${JSON.stringify(result.batch)}\n\n`
            ))
          } else if (!deliveredCursor) {
            controller.enqueue(encoder.encode(
              `id: ${result.batch.cursor}\nevent: synchronized\ndata: ${JSON.stringify({ cursor: result.batch.cursor })}\n\n`
            ))
          }
          deliveredCursor = result.batch.cursor
        } catch {
          close()
        }
      }
      const abort = (): void => close()
      request.signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => request.signal.removeEventListener('abort', abort)
      unsubscribe = registry.subscribe(send)
      send()
      heartbeat = setInterval(() => {
        if (closed) return
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch { close() }
      }, HEARTBEAT_MS)
      heartbeat.unref?.()
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
      removeAbort?.()
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}
