import type { ModelStreamChunk } from '../../ports/model-client.js'
import { GatewayRouteChangedError } from '../../domain/model-gateway-export-policy.js'

const GATEWAY_DIAGNOSTICS: Record<string, string> = {
  paper_request_budget_exhausted: 'Paper reading permits one upstream request; explicitly submit again to retry.',
  provider_configuration_changed: 'Provider configuration is not active. Retry after settings finish applying.' ,
  token_budget_exceeded: 'Gateway client token budget exhausted.',
  cost_limit_exceeded: 'Gateway client estimated cost limit reached for this period.',
  token_budget_unbounded: 'This request has no declared conservative token bound. Check the account input ceiling and maximum output.',
  token_budget_unavailable: 'Gateway budget storage is unavailable; pending reservations remain held.',
  gateway_route_changed: 'Gateway provider configuration changed. Retry the request.',
  route_attempt_budget_exhausted: 'Gateway upstream attempt budget exhausted.',
  route_deadline_exceeded: 'Gateway routing deadline exceeded.',
  route_request_aborted: 'Gateway request aborted.'
}

/** Budget and cost refusals say when the window resets and where the key can read its limits. */
function diagnosticMessage(code: string, failure: { resetAt?: string } | undefined): string {
  const base = GATEWAY_DIAGNOSTICS[code]!
  if (code !== 'token_budget_exceeded' && code !== 'cost_limit_exceeded') return base
  const resetAt = failure?.resetAt && Number.isFinite(Date.parse(failure.resetAt)) ? new Date(failure.resetAt).toISOString() : undefined
  return `${base}${resetAt ? ` It resets at ${resetAt}.` : ''} See GET /v1/kun/limit for this key's limits.`
}

/** Upstream diagnostics are untrusted: an auth error may echo the provider key. */
export function gatewaySafeModelChunk(chunk: ModelStreamChunk): ModelStreamChunk {
  if (chunk.kind === 'retrying') {
    const { failureSummary: _summary, ...safe } = chunk
    return safe
  }
  if (chunk.kind !== 'error') return chunk
  const status = chunk.failure?.httpStatus
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status : undefined
  const diagnostic = chunk.code && Object.hasOwn(GATEWAY_DIAGNOSTICS, chunk.code) ? chunk.code : undefined
  const failure = chunk.failure ? { ...chunk.failure } : undefined
  if (failure) delete failure.providerCode
  return {
    kind: 'error',
    message: diagnostic ? diagnosticMessage(diagnostic, failure)
      : `Gateway upstream request failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}.`,
    code: diagnostic ?? (httpStatus ? `http_${httpStatus}` : 'upstream_error'),
    ...(failure ? { failure } : {}),
    ...(chunk.route ? { route: chunk.route } : {})
  }
}

export function gatewaySafeThrownError(error: unknown): Extract<ModelStreamChunk, { kind: 'error' }> {
  return error instanceof GatewayRouteChangedError
    ? { kind: 'error', code: 'gateway_route_changed', message: GATEWAY_DIAGNOSTICS.gateway_route_changed,
        failure: { category: 'request', failoverAllowed: false } }
    : { kind: 'error', code: 'upstream_error', message: 'Gateway upstream request failed.',
        failure: { category: 'unknown', failoverAllowed: false } }
}
