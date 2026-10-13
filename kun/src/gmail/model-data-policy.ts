import { LOCAL_GMAIL_RECIPIENT, type GmailModelRecipientBinding, type GmailModelRecipientId } from '../contracts/gmail.js'
import type { GoogleWorkspaceModelFence, ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { TurnItem } from '../contracts/items.js'
import { GOOGLE_WORKSPACE_MODEL_PROVIDER, GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'

export type GmailModelAvailability = { allowed: boolean; reason?: string; providerName?: string;
  recipient?: GmailModelRecipientId; endpoint?: string; consentId?: string; recipientBinding?: GmailModelRecipientBinding }
export interface GmailModelDataPolicyPort {
  availability(threadId: string, selection?: GmailModelSelection): Promise<GmailModelAvailability>
  assertAllowed(threadId: string, selection?: GmailModelSelection): Promise<void>
}
export type GmailModelSelection = Pick<ModelRequest, 'model' | 'providerId'>
export type GmailThreadDataState = { sensitive: boolean; sharingAllowed: boolean; assertSharingCurrent?: () => void }
export type GmailModelDataPolicyOptions = {
  /** Cloud processing additionally requires a host-minted exact-account proof and per-task consent. */
  cloudProcessingEnabled?: boolean
  selection(threadId: string): Promise<GmailModelSelection>
  /** Resolve private-room and inherited parent scope; retain sensitivity after disconnect. */
  dataState(threadId: string, history?: readonly TurnItem[], recipient?: GmailModelRecipientBinding): Promise<GmailThreadDataState>
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
      return { allowed: true, providerName: fence.providerName ?? GOOGLE_WORKSPACE_MODEL_PROVIDER,
        recipient: fence.recipient?.id, endpoint: fence.endpoint, consentId: fence.consentId, recipientBinding: fence.recipient }
    } catch (error) {
      const selection = admittedSelection ?? await this.policy.selection(threadId)
      const config = this.configFor(selection.providerId) as { baseUrl?: string } | undefined
      const deepseek = config?.baseUrl?.startsWith('https://api.deepseek.com')
      return { allowed: false, reason: deepseek ? 'deepseek_api_account_not_reviewed' : 'approved_model_required',
        ...(deepseek ? { recipient: 'deepseek-api', endpoint: 'https://api.deepseek.com', providerName: 'DeepSeek API' } : {}),
        ...(error instanceof GoogleWorkspaceModelPolicyError && error.message.includes('changed') ? { reason: 'deepseek_api_account_evidence_changed' } : {}) }
    }
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
    if (mode === 'reviewed-cloud' && (!fence.recipient || !fence.consentId || !fence.assertCredentials)) throw new GoogleWorkspaceModelPolicyError()
    if (mode === 'verified-local') return Object.assign(fence, { recipient: LOCAL_GMAIL_RECIPIENT,
      consentId: 'kun-managed-local:v1', endpoint: 'Kun managed local Ollama' })
    return fence
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const classification = await this.policy.dataState(request.threadId, request.history)
    const client = this.client(request)
    if (!classification.sensitive) { yield* client.stream(request); return }
    if (request.gatewayRouting) throw new GoogleWorkspaceModelPolicyError('Gmail conversations cannot be exported through a model gateway.')
    const captured = this.guard(request)
    const state = await this.policy.dataState(request.threadId, request.history, captured.recipient)
    if (!state.sharingAllowed) throw new GoogleWorkspaceModelPolicyError('Gmail sharing has not been granted to this exact model account for this conversation. Review and enable it before continuing.')
    if (!state.assertSharingCurrent) throw new GoogleWorkspaceModelPolicyError('Gmail sharing could not be fenced before dispatch.')
    const assertCurrent = () => { captured(); state.assertSharingCurrent!() }
    const assertDataPermission = async () => {
      assertCurrent()
      const current = await this.policy.dataState(request.threadId, request.history, captured.recipient)
      if (!current.sensitive || !current.sharingAllowed || !current.assertSharingCurrent) {
        throw new GoogleWorkspaceModelPolicyError('Gmail data permission changed before the model request.')
      }
      current.assertSharingCurrent()
      assertCurrent()
    }
    await assertDataPermission()
    yield* client.stream({ ...request, googleWorkspaceData: { assertCurrent, assertEndpoint: captured.assertEndpoint, assertCredentials: captured.assertCredentials },
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
