import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

/**
 * Routes a streaming model request to a per-`providerId` `ModelClient`.
 *
 * The runtime spins up one default client (the GUI's configured Kun runtime
 * provider) plus an optional map of extra clients — one per provider the GUI
 * has credentials for. When a `ModelRequest` carries a `providerId` matching
 * an entry in the map, that entry's client handles the stream; otherwise the
 * default client runs (preserving single-provider behavior).
 *
 * This is the smallest surface that lets a workflow / scheduled task / IM
 * bridge pick a non-runtime provider per request without spinning up another
 * Kun process or having the loop know about provider routing.
 */
export class MultiProviderModelClient implements ModelClient {
  readonly provider = 'compat-multi'
  readonly model: string

  private readonly default_: ModelClient
  private readonly providers: Map<string, ModelClient>

  constructor(input: { default: ModelClient; providers?: Map<string, ModelClient> }) {
    this.default_ = input.default
    this.providers = new Map(
      [...(input.providers ?? new Map()).entries()]
        .map(([providerId, client]) => [providerId.trim().toLowerCase(), client] as const)
        .filter(([providerId]) => providerId.length > 0)
    )
    this.model = input.default.model
  }

  /**
   * Pick the client for this request's `providerId` (case-insensitive,
   * trimmed). A missing id uses the default client; an explicit unknown id
   * fails closed so requests never leak to different credentials.
   */
  resolve(providerId?: string): ModelClient {
    const normalized = providerId?.trim().toLowerCase()
    if (!normalized) return this.default_
    const client = this.providers.get(normalized)
    if (!client) throw new Error(`unknown_provider_id: ${providerId?.trim()}`)
    return client
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    return this.resolve(request.providerId).stream(request)
  }

  /**
   * Exposes the default client's HTTP config (baseUrl, endpointFormat,
   * model) for the loop's diagnostic logging. The diagnostic call site
   * has no per-thread context — returning the default keeps the existing
   * single-provider deployment log shape unchanged.
   */
  get config(): unknown {
    return (this.default_ as { config?: unknown }).config
  }
}
