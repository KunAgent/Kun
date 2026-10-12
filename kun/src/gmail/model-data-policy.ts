import type { GoogleWorkspaceModelFence, ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { TurnItem } from '../contracts/items.js'
import { GOOGLE_WORKSPACE_MODEL_PROVIDER, GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'

export type GmailModelAvailability = { allowed: boolean; reason?: string; providerName?: string }
export interface GmailModelDataPolicyPort {
  availability(threadId: string, selection?: GmailModelSelection): Promise<GmailModelAvailability>
  assertAllowed(threadId: string, selection?: GmailModelSelection): Promise<void>
}
export type GmailModelSelection = Pick<ModelRequest, 'model' | 'providerId'>
export type GmailThreadDataState = { sensitive: boolean; sharingAllowed: boolean }
export type GmailModelDataPolicyOptions = {
  /** Future reviewed cloud release only; absent/false keeps public Gmail processing local. */
  cloudProcessingEnabled?: boolean
  selection(threadId: string): Promise<GmailModelSelection>
  /** Resolve private-room and inherited parent scope; retain sensitivity after disconnect. */
  dataState(threadId: string, history?: readonly TurnItem[]): Promise<GmailThreadDataState>
  /** The host-created local client ignores the display profile's URL, key, and transport settings. */
  local?: { providerId: 'kun-gmail-local'; model: 'qwen3:4b'; client: ModelClient }
}

/** Covers every shared model request, including titles and compaction, before any provider runs. */
export class GoogleWorkspaceModelClient implements ModelClient, GmailModelDataPolicyPort {
  constructor(private readonly inner: ModelClient, private readonly policy: GmailModelDataPolicyOptions) {}
  get provider(): string { return this.inner.provider }
  get model(): string { return this.inner.model }
  get config(): unknown { return (this.inner as ModelClient & { config?: unknown }).config }
  configFor(providerId?: string): unknown {
    const local = this.policy.local
    if (local && providerId === local.providerId) return (local.client as ModelClient & { config?: unknown }).config
    const inner = this.inner as ModelClient & { configFor?: (id?: string) => unknown; config?: unknown }
    return inner.configFor?.(providerId) ?? inner.config
  }

  async availability(threadId: string, admittedSelection?: GmailModelSelection): Promise<GmailModelAvailability> {
    try {
      const selection = admittedSelection ?? await this.policy.selection(threadId)
      const fence = this.guard(selection)
      fence()
      return { allowed: true, providerName: fence.providerName ?? GOOGLE_WORKSPACE_MODEL_PROVIDER }
    } catch { return { allowed: false, reason: 'approved_ollama_required' } }
  }

  async assertAllowed(threadId: string, admittedSelection?: GmailModelSelection): Promise<void> {
    const selection = admittedSelection ?? await this.policy.selection(threadId)
    this.guard(selection)()
  }

  private client(selection: GmailModelSelection): ModelClient {
    if (selection.providerId === 'kun-gmail-local') {
      if (!this.policy.local || selection.model !== this.policy.local.model) throw new GoogleWorkspaceModelPolicyError()
      return this.policy.local.client
    }
    return this.inner
  }

  private guard(selection: GmailModelSelection): GoogleWorkspaceModelFence {
    if (selection.providerId !== 'kun-gmail-local' && this.policy.cloudProcessingEnabled !== true) {
      throw new GoogleWorkspaceModelPolicyError('Gmail model processing currently requires Kun’s verified cloud-disabled local Ollama model.')
    }
    const client = this.client(selection)
    if (selection.model.trim().toLowerCase() === 'auto' || !client.googleWorkspaceDispatchGuard) {
      throw new GoogleWorkspaceModelPolicyError()
    }
    const fence = client.googleWorkspaceDispatchGuard(selection)
    const mode = selection.providerId === 'kun-gmail-local' ? 'verified-local' : 'reviewed-cloud'
    if (fence.mode !== mode || !fence.assertEndpoint) throw new GoogleWorkspaceModelPolicyError()
    return fence
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const state = await this.policy.dataState(request.threadId, request.history)
    const client = this.client(request)
    if (!state.sensitive) { yield* client.stream(request); return }
    if (request.gatewayRouting) throw new GoogleWorkspaceModelPolicyError('Gmail conversations cannot be exported through a model gateway.')
    if (!state.sharingAllowed) throw new GoogleWorkspaceModelPolicyError('Gmail model sharing is disabled for this conversation. Re-enable it or remove the email conversation before continuing.')
    const captured = this.guard(request)
    const assertCurrent = () => captured()
    const assertDataPermission = async () => {
      const current = await this.policy.dataState(request.threadId, request.history)
      if (!current.sensitive || !current.sharingAllowed) {
        throw new GoogleWorkspaceModelPolicyError('Gmail data permission changed before the model request.')
      }
      assertCurrent()
    }
    await assertDataPermission()
    yield* client.stream({ ...request, googleWorkspaceData: { assertCurrent, assertEndpoint: captured.assertEndpoint },
      beforeProviderDispatch: async () => {
        await assertDataPermission()
        await request.beforeProviderDispatch?.()
        assertCurrent()
      }, beforeWireDispatch: async (input) => {
        await request.beforeWireDispatch?.(input)
        await assertDataPermission()
      } })
  }

  googleWorkspaceDispatchGuard(request: GmailModelSelection): GoogleWorkspaceModelFence { return this.guard(request) }
  async assertGoogleWorkspaceDelegatedHistory(threadId: string, history?: readonly TurnItem[]): Promise<void> {
    if ((await this.policy.dataState(threadId, history)).sensitive) {
      throw new GoogleWorkspaceModelPolicyError('Gmail history cannot be exported to a subscription SDK or external Agent. Start a new task using an eligible native Kun model.')
    }
  }
  paperReadOnlyDispatchGuard(request: GmailModelSelection): () => void {
    if (!this.inner.paperReadOnlyDispatchGuard) throw new Error('Paper read-only model transport is unavailable')
    return this.inner.paperReadOnlyDispatchGuard(request)
  }
  gatewayDispatchGuard(): () => void {
    if (!this.inner.gatewayDispatchGuard) throw new Error('Gateway dispatch guard is unavailable')
    return this.inner.gatewayDispatchGuard()
  }
  selectsRouteTargetDuringStream(request: GmailModelSelection): boolean {
    if (this.policy.local && request.providerId === this.policy.local.providerId) return false
    return this.inner.selectsRouteTargetDuringStream?.(request) ?? false
  }
}
