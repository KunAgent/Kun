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
    this.providers = input.providers ?? new Map()
    this.model = input.default.model
  }

  /**
   * Pick the client for this request's `providerId` (case-insensitive,
   * trimmed); fall back to the default client when the id is missing or
   * unknown.
   */
  resolve(providerId?: string): ModelClient {
    const trimmed = providerId?.trim()
    if (!trimmed) return this.default_
    return this.providers.get(trimmed) ?? this.default_
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

  /**
   * Exposes the routed client's HTTP config for per-request diagnostics.
   * Streaming already resolves by providerId; cache and pipeline telemetry
   * should describe the same client that will handle the request.
   */
  configFor(providerId?: string): unknown {
    return (this.resolve(providerId) as { config?: unknown }).config
  }
}
