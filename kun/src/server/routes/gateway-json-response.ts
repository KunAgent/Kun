import { jsonResponse, type JsonResponse } from '../response.js'

/** Gateway traffic and credential material must never enter an HTTP cache. */
export function gatewayJsonResponse(body: unknown, status = 200): JsonResponse {
  const response = jsonResponse(body, status)
  response.headers['cache-control'] = 'no-store'
  return response
}
