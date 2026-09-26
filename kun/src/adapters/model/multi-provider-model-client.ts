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
  model: string

  private default_: ModelClient
  private providers: Map<string, ModelClient>
  private readonly turnPins = new Map<string, {
    client: ModelClient
    /** Pin identity: the provider id, or a routing selection (`kind:id`). */
    pinKey: string
    label: string
    routed: boolean
    touchedAt: number
  }>()

  constructor(input: { default: ModelClient; providers?: Map<string, ModelClient> }) {
    this.default_ = input.default
    this.providers = canonicalProviders(input.providers)
    this.model = input.default.model
  }

  replace(input: { default: ModelClient; providers?: Map<string, ModelClient> }): void {
    this.default_ = input.default
    this.providers = canonicalProviders(input.providers)
    this.model = input.default.model
  }

  register(providerId: string, client: ModelClient): () => void {
    const id = providerId.trim().toLowerCase()
    if (!id) throw new Error('model provider id is required')
    if (this.providers.has(id)) throw new Error(`model provider already registered: ${providerId}`)
    this.providers.set(id, client)
    return () => {
      if (this.providers.get(id) === client) this.providers.delete(id)
    }
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId.trim().toLowerCase())
  }

  registeredProviderIds(): string[] {
    return [...this.providers.keys()].sort()
  }

  /**
   * Pick the client for this request's `providerId`. Omitted ids use the
   * default client; an explicit unknown id is an error so private request
   * content can never silently fall back to different provider credentials.
   */
  resolve(providerId?: string): ModelClient {
    const trimmed = providerId?.trim().toLowerCase()
    if (!trimmed || trimmed === 'default') return this.default_
    const client = this.providers.get(trimmed)
    if (!client) throw new Error(`unknown model provider: ${providerId}`)
    return client
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const providerId = request.providerId?.trim().toLowerCase() || 'default'
    const selection = request.routeSelection
    // A declared routing selection pins the turn to the *selection*, not to
    // the first resolved provider, so an explicit route-pool/account-group
    // failover is allowed while a silent provider switch still throws.
    const pinKey = selection
      ? `${selection.kind}:${selection.id}`.toLowerCase()
      : `provider:${providerId}`
    const label = selection ? pinKey : providerId
    const pinned = this.turnPins.get(request.turnId)
    if (pinned && pinned.pinKey !== pinKey) {
      throw new Error(
        `model provider changed within turn ${request.turnId}: ${pinned.label} -> ${label}`
      )
    }
    if (selection && selection.targetProviderId?.trim().toLowerCase() !== providerId) {
      throw new Error(
        `route selection ${pinKey} target mismatch within turn ${request.turnId}: ` +
        `${selection.targetProviderId ?? ''} != ${providerId}`
      )
    }
    // Routed requests re-resolve per attempt because each failover target is
    // a different provider client; unrouted requests keep the pinned client.
    const client = pinned && !selection ? pinned.client : this.resolve(request.providerId)
    this.turnPins.set(request.turnId, {
      client,
      pinKey,
      label,
      routed: Boolean(selection),
      touchedAt: Date.now()
    })
    this.pruneTurnPins()
    return client.stream(request)
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

  private pruneTurnPins(): void {
    if (this.turnPins.size <= 2_000) return
    const cutoff = Date.now() - 6 * 60 * 60 * 1_000
    for (const [turnId, pin] of this.turnPins) {
      if (pin.touchedAt < cutoff || this.turnPins.size > 4_000) {
        this.turnPins.delete(turnId)
      }
    }
  }
}

function canonicalProviders(providers?: Map<string, ModelClient>): Map<string, ModelClient> {
  return new Map(
    [...(providers ?? new Map())]
      .map(([id, client]) => [id.trim().toLowerCase(), client] as const)
      .filter(([id]) => Boolean(id))
  )
}
