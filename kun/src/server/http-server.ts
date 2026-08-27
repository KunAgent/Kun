import type { Router } from './router.js'
import type { JsonResponse } from './response.js'
import { jsonResponse } from './response.js'

export type HttpServerOptions = {
  router: Router
}

/** Warn once a non-streaming request exceeds this budget; SSE streams opt out. */
const SLOW_REQUEST_LOG_MS = 500

function toResponse(response: Response | JsonResponse): Response {
  if (response instanceof Response) return response
  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
}

function isStreamingResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('text/event-stream')
}

export async function dispatchRequest(router: Router, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const match = router.match(request.method, url.pathname)
  if (!match) {
    return toResponse(jsonResponse(
      { code: 'not_found', message: 'route not found' },
      404
    ))
  }
  const startedAt = performance.now()
  const response = toResponse(await match.handler(request, { params: match.params }))
  const elapsedMs = performance.now() - startedAt
  if (elapsedMs >= SLOW_REQUEST_LOG_MS && !isStreamingResponse(response)) {
    // Route-level signal for event-loop stalls (#621 family): names the
    // endpoint and thread so a slow scan is attributable in stdout logs.
    console.warn(
      `[kun] ${request.method} ${url.pathname} took ${Math.round(elapsedMs)}ms`
    )
  }
  return response
}
