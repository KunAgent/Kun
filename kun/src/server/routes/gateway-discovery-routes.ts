import { KUN_VERSION as KUN_SERVICE_VERSION } from '../../version.js'
import type { JsonResponse } from '../response.js'
import { GATEWAY_SESSION_HEADER, gatewaySessionId } from '../../services/gateway-usage-service.js'
import { gatewayJsonResponse as jsonResponse } from './gateway-json-response.js'
import { gatewayRouteTraceStore } from './gateway-route-trace.js'
import { authorizeGateway, openAiError } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * `GET /api/hello`: unauthenticated identity probe so an agent can tell a Kun
 * gateway from another process on the same port. It reveals no
 * configuration beyond whether the gateway is enabled.
 */
export function gatewayHello(runtime: ServerRuntime, request: Request): JsonResponse {
  const origin = new URL(request.url).origin
  return jsonResponse({
    name: 'kun',
    version: KUN_SERVICE_VERSION,
    gateway: {
      enabled: runtime.modelGateway?.enabled() ?? false,
      v1: `${origin}/v1`,
      anthropic: origin,
      sessionHeader: GATEWAY_SESSION_HEADER,
      routeTrace: `${origin}/v1/kun/route`
    }
  })
}

/**
 * `GET /v1/kun/route?session=<id>[&after=<seq>&wait=<seconds>]`: the latest
 * route decision for one of the caller's own sessions. The session id is the
 * value the client sent in its session header; it is hashed with the caller
 * identity, so a client can only read its own sessions.
 */
export async function gatewayRouteTrace(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const verdict = await authorizeGateway(runtime, request)
  if (!verdict.ok) {
    return verdict.reason === 'rate_limited'
      ? openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
      : openAiError('Invalid gateway API key.', 'invalid_api_key', verdict.reason === 'unavailable' ? 503 : 401)
  }
  if (!runtime.modelGateway?.enabled()) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  const params = new URL(request.url).searchParams
  const raw = params.get('session')
  if (!raw) return openAiError('session is required.', 'invalid_request_error', 400)
  let key: string | undefined
  try {
    key = verdict.auth.kind === 'harness'
      ? raw === verdict.auth.grant.threadId ? raw : undefined
      : gatewaySessionId(verdict.auth.client?.clientId ?? 'legacy', raw)
  } catch {
    return openAiError('session must contain 1-128 letters, digits, dots, underscores or hyphens.', 'invalid_request_error', 400)
  }
  if (!key) return jsonResponse({ route: null, seq: 0 })
  const after = Number(params.get('after') ?? 0)
  const waitSeconds = Number(params.get('wait') ?? 0)
  if (!Number.isFinite(after) || after < 0 || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
    return openAiError('after and wait must be non-negative numbers.', 'invalid_request_error', 400)
  }
  const store = gatewayRouteTraceStore(runtime.modelGateway)
  const route = waitSeconds > 0
    ? await store.wait(key, after, waitSeconds * 1_000, request.signal)
    : store.latest(key)
  return jsonResponse({ route, seq: route?.seq ?? 0 })
}
