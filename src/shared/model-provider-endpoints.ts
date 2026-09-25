import type { ModelEndpointFormat, ModelProviderEndpointsV1 } from './app-settings-types'

type EndpointCarrier = {
  baseUrl: string
  endpoints?: ModelProviderEndpointsV1 | null
}

/**
 * Resolves the base URL a request should use for `format`: a per-protocol
 * override from `endpoints` wins, otherwise the provider `baseUrl` applies.
 * `custom_endpoint` is always served by the raw `baseUrl` — it is an explicit
 * full path, not a family to reroute. This is the same contract kun's
 * `CompatModelClient.baseUrlForFormat` implements, shared so main-process
 * consumers (probing, model listing, inline completion, scheduled-task
 * detection) resolve identical URLs.
 */
export function resolveProviderEndpointBaseUrl(
  provider: EndpointCarrier,
  format: ModelEndpointFormat
): string {
  if (format === 'chat_completions' || format === 'responses' || format === 'messages') {
    const override = provider.endpoints?.[format]?.trim()
    if (override) return override
  }
  return provider.baseUrl
}
