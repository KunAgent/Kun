import { timingSafeEqual } from 'node:crypto'
import { jsonResponse, type JsonResponse } from '../server/response.js'

export function authorized(
  request: Request,
  token: string,
  action: () => JsonResponse | Response
): JsonResponse | Response {
  return tokenMatches(request.headers.get('authorization'), token)
    ? action()
    : jsonResponse({ code: 'unauthorized', message: 'manager authorization required' }, 401)
}

export async function authorizedAsync(
  request: Request,
  token: string,
  action: () => Promise<JsonResponse | Response>
): Promise<JsonResponse | Response> {
  return tokenMatches(request.headers.get('authorization'), token)
    ? action()
    : jsonResponse({ code: 'unauthorized', message: 'manager authorization required' }, 401)
}

export function tokenMatches(header: string | null, expected: string): boolean {
  const actual = header?.replace(/^Bearer\s+/iu, '') ?? ''
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function validation(message: string, details?: unknown): JsonResponse {
  return jsonResponse({ code: 'validation_error', message, ...(details ? { details } : {}) }, 400)
}
