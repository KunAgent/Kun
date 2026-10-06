import type { ToolCallProviderMetadata } from '../../contracts/items.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { tapGatewayStream } from './gateway-stream-tap.js'

/**
 * Provider-private continuation data for gateway tool calls.
 *
 * External agents replay their own conversation on every request, but they
 * never see the opaque state a provider requires to continue a tool-use turn:
 * Anthropic signed thinking blocks, Gemini thought signatures and Responses
 * reasoning items. Every ingress protocol echoes the tool-call id back
 * verbatim, so the gateway keeps that state server-side keyed by the caller
 * and the call id, and restores it onto the matching history item.
 *
 * The store is bounded (LRU + TTL), scoped to the authenticated caller, and
 * never returns data to a client; restored metadata only reaches the adapter
 * that produced it (the projector already ignores foreign protocols).
 */
const DEFAULT_CAPACITY = 8_192
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1_000
const MAX_METADATA_BYTES = 512 * 1_024

type Entry = { metadata: ToolCallProviderMetadata; expiresAt: number }

export class GatewayContinuationStore {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  size(): number { return this.entries.size }

  remember(callerId: string, callId: string, metadata: ToolCallProviderMetadata | undefined): void {
    if (!metadata || !callId || !Object.keys(metadata).length) return
    if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) return
    const key = this.key(callerId, callId)
    this.entries.delete(key)
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(key, { metadata, expiresAt: this.now() + this.ttlMs })
  }

  recall(callerId: string, callId: string): ToolCallProviderMetadata | undefined {
    const key = this.key(callerId, callId)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.metadata
  }

  /** Drop everything a revoked or rotated caller left behind. */
  forgetCaller(callerId: string): void {
    const prefix = `${callerId}\u0000`
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key)
  }

  private key(callerId: string, callId: string): string {
    return `${callerId}\u0000${callId}`
  }
}

const STORES = new WeakMap<object, GatewayContinuationStore>()

/** One store per runtime gateway instance, so tests and hot-reloaded runtimes stay isolated. */
export function gatewayContinuationStore(owner: object): GatewayContinuationStore {
  let store = STORES.get(owner)
  if (!store) {
    store = new GatewayContinuationStore()
    STORES.set(owner, store)
  }
  return store
}

/** Records provider metadata attached to completed tool calls as they stream through. */
export function captureGatewayContinuations(
  source: AsyncIterable<ModelStreamChunk>,
  store: GatewayContinuationStore,
  callerId: string
): AsyncIterable<ModelStreamChunk> {
  return tapGatewayStream(source, (chunk) => {
    if (chunk.kind === 'tool_call_complete') store.remember(callerId, chunk.callId, chunk.providerMetadata)
  })
}

/** Re-attaches remembered provider metadata to replayed tool calls that carry none. */
export function restoreGatewayContinuations(
  request: ModelRequest,
  store: GatewayContinuationStore,
  callerId: string
): number {
  let restored = 0
  for (const item of request.history) {
    if (item.kind !== 'tool_call' || item.providerMetadata) continue
    const metadata = store.recall(callerId, item.callId)
    if (!metadata) continue
    item.providerMetadata = metadata
    restored += 1
  }
  return restored
}
