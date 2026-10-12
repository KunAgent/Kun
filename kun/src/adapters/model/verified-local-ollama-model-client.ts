import type { GoogleWorkspaceModelFence, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GoogleWorkspaceModelPolicyError } from '../../domain/google-workspace-model-policy.js'
import { CompatModelClient } from './compat-model-client.js'
import { KUN_GMAIL_LOCAL_PROVIDER_ID, isNativeGmailTool } from '../../gmail/tool-policy.js'

export { KUN_GMAIL_LOCAL_PROVIDER_ID } from '../../gmail/tool-policy.js'
export const KUN_GMAIL_LOCAL_MODEL = 'qwen3:4b'

/** Created only by the managed launcher; no GUI configuration can supply this proof. */
export type VerifiedLocalOllamaProof = {
  readonly origin: string
  readonly model: string
  readonly directFetch: typeof fetch
  /** Checks owned server identity, NO_CLOUD, local model provenance, and process lifetime. */
  readonly assertCurrent: () => void
}

export class VerifiedLocalOllamaModelClient extends CompatModelClient {
  private readonly origin: string
  private readonly localModel: string
  private readonly assertOwned: () => void

  constructor(proof: VerifiedLocalOllamaProof) {
    const origin = new URL(proof.origin)
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port ||
        origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        proof.model !== KUN_GMAIL_LOCAL_MODEL || typeof proof.directFetch !== 'function' || typeof proof.assertCurrent !== 'function') {
      throw new GoogleWorkspaceModelPolicyError('The app-owned local Gmail model proof is invalid.')
    }
    super({ providerId: KUN_GMAIL_LOCAL_PROVIDER_ID, baseUrl: `${origin.origin}/v1`, model: proof.model,
      apiKey: '', endpointFormat: 'chat_completions', fetchImpl: proof.directFetch, modelProxyUrl: '',
      modelCapabilities: () => ({ id: proof.model, supportsToolCalling: true, inputModalities: ['text'],
        outputModalities: ['text'], messageParts: ['text'], endpointFormat: 'chat_completions',
        contextWindow: 32768, maxOutputTokens: 4096 }) })
    this.origin = origin.origin
    this.localModel = proof.model
    this.assertOwned = proof.assertCurrent
  }

  override googleWorkspaceDispatchGuard(request: Pick<ModelRequest, 'model' | 'providerId'>): GoogleWorkspaceModelFence {
    const check = () => {
      this.assertOwned()
      if (request.providerId !== KUN_GMAIL_LOCAL_PROVIDER_ID || request.model !== this.localModel ||
          this.config.baseUrl !== `${this.origin}/v1` || this.config.model !== this.localModel ||
          this.config.modelProxyUrl || this.config.endpoints || this.config.customEndpointProtocol) {
        throw new GoogleWorkspaceModelPolicyError('The local Gmail model selection changed or is not app-owned.')
      }
    }
    const assertEndpoint = (value: string, protocol: string) => {
      check()
      const url = new URL(value)
      if (protocol !== 'chat_completions' || url.origin !== this.origin || url.pathname !== '/v1/chat/completions' ||
          url.username || url.password || url.search || url.hash) throw new GoogleWorkspaceModelPolicyError()
    }
    check()
    return Object.assign(check, { mode: 'verified-local' as const, providerName: 'Ollama Local (cloud disabled)', assertEndpoint })
  }

  override stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.gatewayRouting) throw new GoogleWorkspaceModelPolicyError('The app-managed local Gmail model is not exported through a gateway.')
    const fence = this.googleWorkspaceDispatchGuard(request)
    return super.stream({ ...request, tools: request.tools.filter(isNativeGmailTool),
      googleWorkspaceData: { assertCurrent: fence, assertEndpoint: fence.assertEndpoint } })
  }
}
