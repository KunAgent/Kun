import { accountModelRequest } from './request-attempt-accounting.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GatewayRouteChangedError } from '../../domain/model-gateway-export-policy.js'
import { ProviderRequestScheduler, ProviderAdmissionError } from '../../services/provider-request-scheduler.js'
import type { ProviderAdmission } from '../../contracts/provider-configuration.js'

export type ModelClientRouterInput = {
  default: ModelClient
  providers?: Map<string, ModelClient>
  /** Trusted HTTP/API-key clients, pinned by object identity at construction. */
  gatewayClients?: Map<string, ModelClient>
  admission?: Map<string, { accountId: string; limits: ProviderAdmission }>
  defaultProviderId?: string
}

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

  private dispatchAuthority?: () => Promise<void>
  setDispatchAuthority(check: () => Promise<void>): void { this.dispatchAuthority = check }

  private default_: ModelClient
  private providers: Map<string, ModelClient>
  private gatewayClients: Map<string, ModelClient>
  private gatewayGeneration = {}
  private admission: NonNullable<ModelClientRouterInput['admission']>
  private defaultProviderId: string
  private readonly turnPins = new Map<string, {
    client: ModelClient
    /** Pin identity: the provider id, or a routing selection (`kind:id`). */
    pinKey: string
    label: string
    routed: boolean
    touchedAt: number
    admitted?: boolean
  }>()

  constructor(input: ModelClientRouterInput, private readonly scheduler = new ProviderRequestScheduler()) {
    this.default_ = input.default
    this.providers = canonicalProviders(input.providers)
    this.gatewayClients = canonicalProviders(input.gatewayClients)
    this.model = input.default.model
    this.admission = input.admission ?? new Map()
    this.defaultProviderId = input.defaultProviderId ?? 'default'
  }

  replace(input: ModelClientRouterInput): void {
    this.gatewayGeneration = {}
    this.default_ = input.default
    this.providers = canonicalProviders(input.providers)
    this.gatewayClients = canonicalProviders(input.gatewayClients)
    this.model = input.default.model
    this.admission = input.admission ?? new Map()
    this.defaultProviderId = input.defaultProviderId ?? 'default'
  }

  register(providerId: string, client: ModelClient): () => void {
    const id = providerId.trim().toLowerCase()
    if (!id) throw new Error('model provider id is required')
    if (this.providers.has(id)) throw new Error(`model provider already registered: ${providerId}`)
    this.providers.set(id, client)
    this.gatewayGeneration = {}
    return () => {
      if (this.providers.get(id) === client) { this.providers.delete(id); this.gatewayGeneration = {} }
    }
  }

  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId.trim().toLowerCase())
    if (removed) this.gatewayGeneration = {}
    return removed
  }

  gatewayDispatchGuard(): () => void {
    const generation = this.gatewayGeneration
    return () => { if (generation !== this.gatewayGeneration) throw new GatewayRouteChangedError() }
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

  paperReadOnlyDispatchGuard(request: Pick<ModelRequest, 'model' | 'providerId'>): () => void {
    const client = this.resolve(request.providerId)
    if (!client.paperReadOnlyDispatchGuard) throw new Error('This provider cannot enforce paper read-only transport')
    const guard = client.paperReadOnlyDispatchGuard(request)
    const generation = this.gatewayGeneration
    return () => {
      if (generation !== this.gatewayGeneration || client !== this.resolve(request.providerId)) {
        throw new Error('Paper provider changed after disclosure; submit again with the new selection')
      }
      guard()
    }
  }

  /** Exact review clients retain account scheduling and cannot silently adopt a replacement credential client. */
  capture(providerId?: string): ModelClient {
    const client = this.resolve(providerId)
    const sourceId = !providerId || providerId === 'default' ? this.defaultProviderId : providerId.toLowerCase()
    const assertCurrent = () => { if (this.resolve(providerId) !== client) throw new GatewayRouteChangedError() }
    return { provider: client.provider, model: client.model, stream: (request) => {
      assertCurrent()
      return accountModelRequest(request, (accounted) => this.streamAdmitted(client, { ...accounted, beforeProviderDispatch: async () => {
        assertCurrent(); if (this.dispatchAuthority) await this.dispatchAuthority(); await request.beforeProviderDispatch?.()
      } }, this.admission.get(sourceId)))
    } }
  }

  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    request.paperReadOnly?.assertCurrent()
    request.gatewayRouting?.assertCurrent?.()
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
    // Gateway ids always address an explicit connection, including a profile
    // literally named "default"; never borrow the ambient default credential.
    const client = request.gatewayRouting ? this.providers.get(providerId)
      : pinned && !selection ? pinned.client : this.resolve(request.providerId)
    if (!client || (request.gatewayRouting && (!request.gatewayRouting.assertCurrent || this.gatewayClients.get(providerId) !== client))) {
      throw new GatewayRouteChangedError()
    }
    this.turnPins.set(request.turnId, {
      client,
      pinKey,
      label,
      routed: Boolean(selection),
      touchedAt: Date.now(),
      admitted: pinned?.client === client && pinned.admitted === true
    })
    const pin = this.turnPins.get(request.turnId)!
    this.pruneTurnPins()
    const admitted = { ...request, beforeProviderDispatch: async () => {
      const current = providerId === 'default' && !request.gatewayRouting ? this.default_ : this.providers.get(providerId)
      if (!pin.admitted && current !== client) throw new GatewayRouteChangedError()
      if (this.dispatchAuthority) await this.dispatchAuthority()
      await request.beforeProviderDispatch?.()
      pin.admitted = true
    } }
    const admission = this.admission.get(providerId === 'default' ? this.defaultProviderId : providerId)
    return this.streamAdmitted(client, admitted, admission)
  }

  private async *streamAdmitted(client: ModelClient, request: ModelRequest,
    admission?: { accountId: string; limits: ProviderAdmission }): AsyncIterable<ModelStreamChunk> {
    let release: (() => void) | undefined
    try {
      if (admission) release = await this.scheduler.acquire(admission.accountId, request.gatewayRouting?.callerId ?? 'kun',
        admission.limits, request.abortSignal)
      request.abortSignal.throwIfAborted()
      if (this.dispatchAuthority) await this.dispatchAuthority()
      yield* client.stream(request)
    } catch (error) {
      if (!(error instanceof ProviderAdmissionError)) throw error
      yield { kind: 'error', code: error.code, message: error.message,
        failure: { category: 'rate_limit', reason: 'rate', httpStatus: 429, localAdmission: true, failoverAllowed: true } }
    } finally { release?.() }
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
