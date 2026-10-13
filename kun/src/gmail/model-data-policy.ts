import { GMAIL_CONVERSATION_RECIPIENT, type GmailModelRecipientBinding, type GmailModelRecipientId } from '../contracts/gmail.js'
import type { GoogleWorkspaceModelFence, ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { TurnItem } from '../contracts/items.js'
import { GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'
import { gatewaySafeModelChunk, gatewaySafeThrownError } from '../adapters/model/gateway-model-privacy.js'

export type GmailModelAvailability = { allowed: boolean; reason?: string; providerName?: string;
  recipient?: GmailModelRecipientId; endpoint?: string; consentId?: string; recipientBinding?: GmailModelRecipientBinding }
export interface GmailModelDataPolicyPort {
  availability(threadId: string, selection?: GmailModelSelection): Promise<GmailModelAvailability>
  assertAllowed(threadId: string, selection?: GmailModelSelection): Promise<void>
}
export type GmailModelSelection = Pick<ModelRequest, 'model' | 'providerId'>
export type GmailThreadDataState = { sensitive: boolean; sharingAllowed: boolean; assertSharingCurrent?: () => void }
export type GmailModelDataPolicyOptions = {
  selection(threadId: string): Promise<GmailModelSelection>
  /** Resolve private conversation and inherited scope; retain classification after disconnect. */
  dataState(threadId: string, history?: readonly TurnItem[], recipient?: GmailModelRecipientBinding): Promise<GmailThreadDataState>
  /** Legacy constructor inputs are inert; Gmail uses the normal configured model router. */
  cloudProcessingEnabled?: boolean
  local?: { providerId: 'kun-gmail-local'; model: 'qwen3:4b'; client: ModelClient }
}

/** Models use ordinary Kun routing; only private-conversation Gmail permission gates mail data. */
export class GoogleWorkspaceModelClient implements ModelClient, GmailModelDataPolicyPort {
  constructor(private readonly inner: ModelClient, private readonly policy: GmailModelDataPolicyOptions) {}
  get provider(): string { return this.inner.provider }
  get model(): string { return this.inner.model }
  get config(): unknown { return (this.inner as ModelClient & { config?: unknown }).config }
  configFor(providerId?: string): unknown {
    const inner = this.inner as ModelClient & { configFor?: (id?: string) => unknown; config?: unknown }
    return inner.configFor?.(providerId) ?? inner.config
  }

  async availability(_threadId: string, _selection?: GmailModelSelection): Promise<GmailModelAvailability> {
    return { allowed: true, providerName: 'Configured Kun models', recipient: GMAIL_CONVERSATION_RECIPIENT.id,
      consentId: 'configured-models:v1', recipientBinding: GMAIL_CONVERSATION_RECIPIENT }
  }
  async assertAllowed(_threadId: string, _selection?: GmailModelSelection): Promise<void> {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const classification = await this.policy.dataState(request.threadId, request.history)
    if (!classification.sensitive) { yield* this.inner.stream(request); return }
    const state = await this.policy.dataState(request.threadId, request.history, GMAIL_CONVERSATION_RECIPIENT)
    if (!state.sharingAllowed) throw new GoogleWorkspaceModelPolicyError('Enable Gmail sharing for this private conversation before continuing.')
    if (!state.assertSharingCurrent) throw new GoogleWorkspaceModelPolicyError('Gmail sharing could not be confirmed before dispatch.')
    const assertCurrent = () => state.assertSharingCurrent!()
    const assertDataPermission = async () => {
      assertCurrent()
      const current = await this.policy.dataState(request.threadId, request.history, GMAIL_CONVERSATION_RECIPIENT)
      if (!current.sensitive || !current.sharingAllowed || !current.assertSharingCurrent) {
        throw new GoogleWorkspaceModelPolicyError('Gmail conversation permission changed before the model request.')
      }
      current.assertSharingCurrent()
      assertCurrent()
    }
    await assertDataPermission()
    const admitted = { ...request, googleWorkspaceData: { assertCurrent },
      beforeProviderDispatch: async () => {
        await assertDataPermission()
        await request.beforeProviderDispatch?.()
        assertCurrent()
      }, beforeWireDispatch: async (input: Parameters<NonNullable<ModelRequest['beforeWireDispatch']>>[0]) => {
        await request.beforeWireDispatch?.(input)
        await assertDataPermission()
      } }
    try {
      for await (const chunk of this.inner.stream(admitted)) {
        const safe = gatewaySafeModelChunk(chunk)
        yield safe.kind === 'error' ? { ...safe, message: safe.message.replace('Gateway upstream', 'Gmail model') } : safe
      }
    } catch (error) {
      const safe = gatewaySafeThrownError(error)
      yield { ...safe, message: safe.message.replace('Gateway upstream', 'Gmail model') }
    }
  }

  /** Compatibility metadata only; endpoint, provider and account identity impose no Gmail gate. */
  googleWorkspaceDispatchGuard(_request: GmailModelSelection): GoogleWorkspaceModelFence {
    return Object.assign(() => undefined, { mode: 'configured-models' as const, recipient: GMAIL_CONVERSATION_RECIPIENT })
  }
  async assertGoogleWorkspaceDelegatedHistory(threadId: string, history?: readonly TurnItem[]): Promise<void> {
    if ((await this.policy.dataState(threadId, history)).sensitive) {
      throw new GoogleWorkspaceModelPolicyError('Gmail history stays in the current private Kun conversation and cannot be passed to a separate external Agent.')
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
    return this.inner.selectsRouteTargetDuringStream?.(request) ?? false
  }
}
