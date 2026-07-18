import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  AgentCancelRequestSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  AgentSubscribeRequestSchema,
  AuthenticatedFetchRequestSchema,
  CreateAccountSessionRequestSchema,
  ExtensionToolDeclarationSchema,
  JsonObjectSchema,
  JsonValueSchema,
  ListAccountsRequestSchema,
  ListOwnThreadsRequestSchema,
  JobCancelRequestSchema,
  JobGetRequestSchema,
  JobListRequestSchema,
  JobSnapshotSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaAnalyzeVisualFramesResultSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaEmbedVisualQueryResultSchema,
  MediaInstallVisualModelRequestSchema,
  MediaMetadataSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaCreateCacheTargetResultSchema,
  MediaOpenViewResourceRequestSchema,
  MediaPickFilesRequestSchema,
  MediaPickFilesResultSchema,
  MediaPickSaveTargetRequestSchema,
  MediaPickSaveTargetResultSchema,
  MediaProbeRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaReleaseRequestSchema,
  MediaResourceLeaseSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  MediaVisualModelStatusSchema,
  ModelProviderDeclarationSchema,
  ModelProviderStreamEventSchema,
  NetworkRequestSchema,
  ProviderBindingSchema,
  RevealSecretRequestSchema,
  ToolProgressSchema,
  ToolResultSchema,
  WorkspaceFileSchema,
  type Account,
  type AccountSession,
  type AgentRun,
  type AgentRunEvent,
  type AuthenticationProviderDeclaration,
  type CommandContribution,
  type ExtensionManifest,
  type JsonValue as PublicJsonValue,
  type ModelProviderAdapter,
  type ModelProviderRequest,
  type ModelProviderStreamEvent,
  type ProviderBinding
} from '@kun/extension-api'
import type { ExtensionModelProviderRegistry } from '../adapters/model/extension-model-provider.js'
import type { ExtensionToolRegistry } from '../adapters/tool/extension-tool-provider.js'
import type { ToolExecutionUpdate } from '../ports/tool-host.js'
import type {
  ExtensionBrokerRequest,
  ExtensionPrincipal as HostExtensionPrincipal
} from '../extensions/host-process.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { JsonValue } from '../extensions/types.js'
import type { ExtensionStateStore } from '../extensions/state-store.js'
import {
  assertBrokeredNetworkUrl,
  createSafeNetworkFetch,
  normalizedBrokerHostname
} from '../extensions/safe-network-fetch.js'
import {
  extensionProviderBindingScope,
  extensionProviderId,
  type ExtensionProviderAccountStore
} from './extension-provider-account-store.js'
import type { ExtensionAccountBroker } from './extension-account-broker.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ExtensionConfigurationService } from './extension-configuration-service.js'
import type { ExtensionArtifactService } from './extension-artifact-service.js'
import type { ExtensionMediaHandleService, MediaHandleProjection } from './extension-media-handle-service.js'
import type { ExtensionMediaProcessService } from './extension-media-process-service.js'
import type { ExtensionMediaJobService } from './extension-media-job-service.js'
import type { ExtensionAudioAnalysisJobService } from './extension-audio-analysis-job-service.js'
import type { ExtensionMediaArchiveJobService } from './extension-media-archive-job-service.js'
import type { ExtensionVisualAnalysisService } from './extension-visual-analysis-service.js'
import type { ExtensionJobService } from './extension-job-service.js'
import type { ExtensionJobSubscription } from './extension-job-subscription.js'
import type {
  ExtensionAgentEvent,
  ExtensionAgentRun,
  ExtensionAgentService,
  ExtensionAgentSubscription,
  ExtensionOwnedThread,
  ExtensionPrincipal
} from './extension-agent-service.js'
import type { ExtensionAgentProfileRegistry } from './extension-agent-profile-registry.js'
import {
  compileExtensionJsonSchema,
  type ExtensionJsonSchemaValidator
} from '../extensions/json-schema-validator.js'
import { extensionError } from '../extensions/errors.js'

const RegistrationIdSchema = z.string().min(1).max(256)
const RegistrationRequestSchema = z.strictObject({ registrationId: RegistrationIdSchema })
const RunIdSchema = z.strictObject({ runId: z.string().min(1).max(256) })
const ThreadIdSchema = z.strictObject({ threadId: z.string().min(1).max(256) })
const SubscriptionIdSchema = z.strictObject({ subscriptionId: RegistrationIdSchema })
const StorageRequestSchema = z.strictObject({
  scope: z.enum(['global', 'workspace']),
  key: z.string().min(1).max(256)
})
const StorageKeysRequestSchema = z.strictObject({ scope: z.enum(['global', 'workspace']) })
const StorageSetRequestSchema = StorageRequestSchema.extend({ value: JsonValueSchema }).strict()
const ConfigurationSectionSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const ConfigurationRequestSchema = z.strictObject({
  sectionId: ConfigurationSectionSchema,
  key: z.string().min(1).max(256)
})
const ConfigurationUpdateRequestSchema = ConfigurationRequestSchema.extend({
  value: JsonValueSchema
}).strict()
const CommandRegisterSchema = z.strictObject({ id: z.string().min(1).max(64) })
const CommandExecuteSchema = z.strictObject({
  id: z.string().min(1).max(256),
  args: JsonValueSchema.optional()
})
const ModelStreamNotificationSchema = z.strictObject({
  registrationId: RegistrationIdSchema,
  event: ModelProviderStreamEventSchema
})
const ModelStreamEnvelopePayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('event'),
    registrationId: RegistrationIdSchema,
    requestId: z.string().min(1).max(256),
    event: ModelProviderStreamEventSchema
  }),
  z.strictObject({
    kind: z.literal('end'),
    registrationId: RegistrationIdSchema,
    requestId: z.string().min(1).max(256),
    outcome: z.enum(['ended', 'failed'])
  })
])

export const DEFAULT_PROVIDER_STREAM_QUEUE_EVENTS = 32
export const DEFAULT_PROVIDER_STREAM_QUEUE_BYTES = 4 * 1024 * 1024

export type ExtensionHostBrokerOptions = {
  agent: ExtensionAgentService
  profiles: ExtensionAgentProfileRegistry
  tools: ExtensionToolRegistry
  modelProviders: ExtensionModelProviderRegistry
  providerAccounts: ExtensionProviderAccountStore
  accounts: ExtensionAccountBroker
  credentials: ExtensionCredentialStore
  state: ExtensionStateStore
  configuration: ExtensionConfigurationService
  artifacts?: ExtensionArtifactService
  mediaHandles?: ExtensionMediaHandleService
  mediaProcesses?: ExtensionMediaProcessService
  mediaJobs?: ExtensionMediaJobService
  audioAnalysisJobs?: ExtensionAudioAnalysisJobService
  archiveJobs?: ExtensionMediaArchiveJobService
  visualAnalysis?: ExtensionVisualAnalysisService
  jobs?: ExtensionJobService
  invokeExtension(
    extensionId: string,
    activationEvent: string,
    method: string,
    params: JsonValue,
    options?: {
      signal?: AbortSignal
      timeoutMs?: number
      resetTimeoutOnStream?: boolean
      workspaceRoots?: string[]
    }
  ): Promise<JsonValue>
  notifyExtension?(principal: ExtensionPrincipal, method: string, params: JsonValue): Promise<void>
  /** Deliver a public SDK notification to one sender-bound Webview session. */
  notifyView?(input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
  }): Promise<void> | void
  resolveManifest?(extensionId: string): Promise<ExtensionManifest | undefined>
  fetch?: typeof fetch
  now?: () => Date
  providerStreamQueueEvents?: number
  providerStreamQueueBytes?: number
  maxAccountSessionsPerExtension?: number
  accountSessionRetentionMs?: number
  /** Main-owned UI hook. It never receives credentials or the runtime token. */
  onUiRequest?(input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
    signal?: AbortSignal
  }): Promise<JsonValue | undefined>
  /** Main must validate an action/account/extension-bound, short-lived consent token. */
  authorizeSecretReveal?(input: {
    principal: ExtensionPrincipal
    accountId: string
    operation: string
    signal?: AbortSignal
  }): Promise<boolean>
}

type ToolRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  activationEvent: string
  dispose(): void
}

type ProviderRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  providerId: string
  activationEvent: string
  dispose(): Promise<void>
}

type AgentSubscription = {
  extensionId: string
  hostLifecycleNonce?: string
  viewSessionId?: string
  workspaceRoots: readonly string[]
  subscription: ExtensionAgentSubscription
}

type JobSubscription = {
  extensionId: string
  hostLifecycleNonce?: string
  viewSessionId?: string
  workspaceRoots: readonly string[]
  subscription: ExtensionJobSubscription
}

type CommandRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  activationEvent: string
  contribution: CommandContribution
  inputValidator?: ExtensionJsonSchemaValidator
  outputValidator?: ExtensionJsonSchemaValidator
}

type StoredAccountSession = AccountSession & {
  extensionId: string
  workspaceRoots: readonly string[]
  lastTouchedAt: number
  transactionId?: string
  providerId?: string
  kind?: 'oauth-pkce' | 'oauth-device' | 'api-key'
}

type ExtensionBrokerDispatchRequest = Pick<
  ExtensionBrokerRequest,
  'method' | 'params' | 'signal' | 'requestId'
>

type ProviderStreamEntry = {
  extensionId: string
  hostLifecycleNonce?: string
  registrationId: string
  requestId: string
  queue: AsyncEventQueue<ModelProviderStreamEvent>
  controller: AbortController
  rpcStreamId?: string
  transportTerminal: boolean
  invocationSettled: boolean
}

/**
 * Parent-owned broker for Node Extension Hosts. Every call uses the identity
 * bound to the child IPC connection; caller-supplied extension IDs are ignored.
 */
export class ExtensionHostBroker {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly providerStreamQueueEvents: number
  private readonly providerStreamQueueBytes: number
  private readonly tools = new Map<string, ToolRegistration>()
  private readonly providers = new Map<string, ProviderRegistration>()
  private readonly subscriptions = new Map<string, AgentSubscription>()
  private readonly jobSubscriptions = new Map<string, JobSubscription>()
  private readonly commands = new Map<string, CommandRegistration>()
  private readonly providerStreams = new Map<string, ProviderStreamEntry>()
  private readonly toolProgress = new Map<string, (value: ToolExecutionUpdate) => Promise<void>>()
  private readonly accountSessions = new Map<string, StoredAccountSession>()
  private readonly maxAccountSessionsPerExtension: number
  private readonly accountSessionRetentionMs: number
  private readonly profileRegistrations = new Map<string, { signature: string; dispose(): void }>()

  constructor(private readonly options: ExtensionHostBrokerOptions) {
    this.fetchImpl = options.fetch ?? createSafeNetworkFetch()
    this.now = options.now ?? (() => new Date())
    this.providerStreamQueueEvents = positiveQueueLimit(
      options.providerStreamQueueEvents,
      DEFAULT_PROVIDER_STREAM_QUEUE_EVENTS
    )
    this.providerStreamQueueBytes = positiveQueueLimit(
      options.providerStreamQueueBytes,
      DEFAULT_PROVIDER_STREAM_QUEUE_BYTES
    )
    this.maxAccountSessionsPerExtension = Math.max(
      1,
      Math.floor(options.maxAccountSessionsPerExtension ?? 128)
    )
    this.accountSessionRetentionMs = Math.max(
      60_000,
      Math.floor(options.accountSessionRetentionMs ?? 30 * 60_000)
    )
  }

  handle = async (request: ExtensionBrokerRequest): Promise<JsonValue> => {
    const principal = hostPrincipal(request.principal)
    const value = await this.dispatch(principal, request, false, true)
    return toJson(value)
  }

  /**
   * Dispatch a sender-bound Webview request through the same broker policy as
   * a Node Extension Host. The caller must derive `principal` from a verified
   * View Session; extension-controlled identity fields are never accepted.
   */
  handlePrincipal = async (input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
    signal: AbortSignal
    requestId: string
  }): Promise<JsonValue> => {
    const value = await this.dispatch(input.principal, input, false, false)
    return toJson(value)
  }

  /** Trusted runtime control path used only after Electron Main owns the interaction. */
  handleTrustedManagement = async (input: {
    principal: ExtensionPrincipal
    method: string
    params: JsonValue
    signal: AbortSignal
    requestId: string
  }): Promise<JsonValue> => {
    const value = await this.dispatch(input.principal, input, true, false)
    return toJson(value)
  }

  /** Complete a PKCE callback collected by a Main-owned protected surface. */
  async completePkceAccountSession(input: {
    principal: ExtensionPrincipal
    sessionId: string
    callbackUrl: string
  }): Promise<AccountSession> {
    const session = this.accountSessions.get(input.sessionId)
    if (
      !session ||
      session.extensionId !== input.principal.extensionId ||
      session.kind !== 'oauth-pkce' ||
      !session.transactionId ||
      !session.providerId ||
      session.status !== 'pending'
    ) throw new Error('PKCE account session is not pending')
    const callback = new URL(input.callbackUrl)
    const code = callback.searchParams.get('code')
    const state = callback.searchParams.get('state')
    if (!code || !state) throw new Error('OAuth callback URL must contain code and state')
    try {
      const account = await this.options.accounts.completePkceAuthorization({
        principal: this.expandPrincipalForProviderId(input.principal, session.providerId),
        transactionId: session.transactionId,
        state,
        code,
        protectedCallback: true
      })
      session.status = 'completed'
      session.lastTouchedAt = this.now().getTime()
      session.account = publicAccount(account, await this.publicCredentialProtection())
      session.message = 'Account connected.'
      return publicAccountSession(session)
    } catch (error) {
      session.status = 'failed'
      session.lastTouchedAt = this.now().getTime()
      session.message = boundedError(error)
      throw error
    }
  }

  notification = async (
    hostPrincipalValue: HostExtensionPrincipal,
    method: string,
    params: JsonValue
  ): Promise<void> => {
    const principal = hostPrincipal(hostPrincipalValue)
    if (method === 'tools.progress') {
      const progress = ToolProgressSchema.parse(params)
      const report = this.toolProgress.get(progress.invocationId)
      if (report) {
        await report({ output: {
          type: 'extension_tool_progress',
          ...(progress.message ? { message: progress.message } : {}),
          ...(progress.fraction !== undefined ? { fraction: progress.fraction } : {}),
          ...(progress.data !== undefined ? { data: progress.data } : {})
        } })
      }
      return
    }
    if (method === 'modelProviders.streamEvent') {
      const notification = ModelStreamNotificationSchema.parse(params)
      const registration = this.providers.get(notification.registrationId)
      if (!registration || registration.extensionId !== principal.extensionId) return
      const entry = this.providerStreams.get(
        providerStreamKey(notification.registrationId, notification.event.requestId)
      )
      if (!entry) return
      if (!entry.queue.pushLegacy(notification.event)) {
        this.failProviderStream(entry, providerQueueLimitError(entry))
      }
    }
  }

  /**
   * Receive an acknowledgement-backed stream envelope from the Extension
   * Host. The JsonRpcPeer does not acknowledge this item until this method has
   * either handed it to the model consumer or deterministically rejected it.
   */
  stream = async (
    hostPrincipalValue: HostExtensionPrincipal,
    rpcStreamId: string,
    _sequence: number,
    payload: JsonValue,
    terminal: boolean
  ): Promise<void> => {
    const principal = hostPrincipal(hostPrincipalValue)
    const item = ModelStreamEnvelopePayloadSchema.parse(payload)
    const registration = this.providers.get(item.registrationId)
    if (!registration || registration.extensionId !== principal.extensionId) return
    const entry = this.providerStreams.get(providerStreamKey(item.registrationId, item.requestId))
    if (!entry || entry.extensionId !== principal.extensionId) return
    if (entry.rpcStreamId !== undefined && entry.rpcStreamId !== rpcStreamId) {
      this.failProviderStream(entry, new Error('extension provider used multiple RPC streams for one model request'))
      return
    }
    entry.rpcStreamId = rpcStreamId

    if (item.kind === 'end') {
      if (!terminal) {
        this.failProviderStream(entry, new Error('extension provider end marker was not terminal'))
        return
      }
      entry.transportTerminal = true
      if (item.outcome === 'failed') entry.queue.fail(new Error('extension provider adapter stream failed'))
      else entry.queue.end()
      return
    }

    if (item.event.requestId !== entry.requestId) {
      this.failProviderStream(entry, new Error('extension provider stream requestId mismatch'))
      return
    }
    const eventTerminal = item.event.type === 'completed' || item.event.type === 'error'
    if (terminal !== eventTerminal) {
      this.failProviderStream(entry, new Error('extension provider RPC terminal flag does not match its event'))
      return
    }
    const accepted = await entry.queue.pushBackpressured(item.event)
    if (!accepted) {
      this.failProviderStream(entry, providerQueueLimitError(entry))
      return
    }
    if (terminal) {
      entry.transportTerminal = true
      entry.queue.end()
    }
  }

  async disposeExtension(extensionId: string): Promise<void> {
    const registrationIds = [...this.providers]
      .filter(([, registration]) => registration.extensionId === extensionId)
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this.tools]) {
      if (registration.extensionId !== extensionId) continue
      registration.dispose()
      this.tools.delete(id)
    }
    for (const [id, registration] of [...this.providers]) {
      if (registration.extensionId !== extensionId) continue
      await registration.dispose().catch(() => undefined)
      await this.options.providerAccounts.unregisterProvider(
        this.principalWithProviderPermissions(extensionId, [], registration.providerId),
        registration.providerId
      ).catch(() => undefined)
      this.providers.delete(id)
    }
    for (const [id, entry] of [...this.subscriptions]) {
      if (entry.extensionId !== extensionId) continue
      entry.subscription.close()
      this.subscriptions.delete(id)
    }
    for (const [id, entry] of [...this.jobSubscriptions]) {
      if (entry.extensionId !== extensionId) continue
      entry.subscription.close()
      this.jobSubscriptions.delete(id)
    }
    for (const [id, entry] of [...this.commands]) {
      if (entry.extensionId === extensionId) this.commands.delete(id)
    }
    this.profileRegistrations.get(extensionId)?.dispose()
    this.profileRegistrations.delete(extensionId)
    for (const [id, session] of [...this.accountSessions]) {
      if (session.extensionId !== extensionId) continue
      if (session.transactionId) {
        this.options.accounts.cancelAuthorization(
          this.principalWithProviderPermissions(extensionId, [], ''),
          session.transactionId
        )
      }
      this.accountSessions.delete(id)
    }
    for (const [key, entry] of [...this.providerStreams]) {
      if (registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))) {
        this.failProviderStream(entry, new Error('extension host was disposed'))
        this.providerStreams.delete(key)
      }
    }
  }

  /** Dispose broker state admitted for one extension workspace only. */
  async disposeExtensionWorkspace(extensionId: string, workspaceId: string): Promise<void> {
    const ownsWorkspace = (entry: { extensionId: string; workspaceRoots: readonly string[] }) =>
      entry.extensionId === extensionId && registrationIncludesWorkspace(entry, workspaceId)
    const registrationIds = [...this.providers]
      .filter(([, registration]) => ownsWorkspace(registration))
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this.tools]) {
      if (!ownsWorkspace(registration)) continue
      registration.dispose()
      this.tools.delete(id)
    }
    for (const [id, registration] of [...this.providers]) {
      if (!ownsWorkspace(registration)) continue
      await registration.dispose().catch(() => undefined)
      await this.options.providerAccounts.unregisterProvider(
        this.principalWithProviderPermissions(extensionId, [], registration.providerId),
        registration.providerId
      ).catch(() => undefined)
      this.providers.delete(id)
    }
    for (const [id, entry] of [...this.subscriptions]) {
      if (!ownsWorkspace(entry)) continue
      entry.subscription.close()
      this.subscriptions.delete(id)
    }
    for (const [id, entry] of [...this.jobSubscriptions]) {
      if (!ownsWorkspace(entry)) continue
      entry.subscription.close()
      this.jobSubscriptions.delete(id)
    }
    for (const [id, entry] of [...this.commands]) {
      if (ownsWorkspace(entry)) this.commands.delete(id)
    }
    for (const [id, session] of [...this.accountSessions]) {
      if (!ownsWorkspace(session)) continue
      if (session.transactionId) {
        this.options.accounts.cancelAuthorization(
          this.principalWithProviderPermissions(extensionId, [], session.providerId ?? ''),
          session.transactionId
        )
      }
      this.accountSessions.delete(id)
    }
    for (const [key, entry] of [...this.providerStreams]) {
      if (registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))) {
        this.failProviderStream(entry, new Error('extension host workspace was disposed'))
        this.providerStreams.delete(key)
      }
    }
  }

  /** Dispose only registrations owned by one exact Node Host generation. */
  async disposeHost(hostPrincipalValue: HostExtensionPrincipal): Promise<void> {
    const principal = hostPrincipal(hostPrincipalValue)
    const registrationIds = [...this.providers]
      .filter(([, registration]) => hostOwnsRegistration(principal, registration))
      .map(([registrationId]) => registrationId)
    for (const [id, registration] of [...this.tools]) {
      if (!hostOwnsRegistration(principal, registration)) continue
      registration.dispose()
      this.tools.delete(id)
    }
    for (const [id, registration] of [...this.providers]) {
      if (!hostOwnsRegistration(principal, registration)) continue
      await registration.dispose().catch(() => undefined)
      await this.options.providerAccounts.unregisterProvider(
        principal,
        registration.providerId
      ).catch(() => undefined)
      this.providers.delete(id)
    }
    for (const [id, entry] of [...this.subscriptions]) {
      if (!hostOwnsRegistration(principal, entry)) continue
      entry.subscription.close()
      this.subscriptions.delete(id)
    }
    for (const [id, entry] of [...this.jobSubscriptions]) {
      if (!hostOwnsRegistration(principal, entry)) continue
      entry.subscription.close()
      this.jobSubscriptions.delete(id)
    }
    for (const [id, entry] of [...this.commands]) {
      if (hostOwnsRegistration(principal, entry)) this.commands.delete(id)
    }
    for (const [key, entry] of [...this.providerStreams]) {
      if (
        hostOwnsRegistration(principal, entry) ||
        registrationIds.some((registrationId) => key.startsWith(`${registrationId}:`))
      ) {
        this.failProviderStream(entry, new Error('extension host was disposed'))
        this.providerStreams.delete(key)
      }
    }
  }

  disposeViewSession(viewSessionId: string): number {
    let disposed = 0
    for (const [id, entry] of [...this.subscriptions]) {
      if (entry.viewSessionId !== viewSessionId) continue
      entry.subscription.close()
      this.subscriptions.delete(id)
      disposed += 1
    }
    for (const [id, entry] of [...this.jobSubscriptions]) {
      if (entry.viewSessionId !== viewSessionId) continue
      entry.subscription.close()
      this.jobSubscriptions.delete(id)
      disposed += 1
    }
    return disposed
  }

  async dispose(): Promise<void> {
    const ids = new Set([
      ...[...this.tools.values()].map((entry) => entry.extensionId),
      ...[...this.providers.values()].map((entry) => entry.extensionId),
      ...[...this.subscriptions.values()].map((entry) => entry.extensionId),
      ...[...this.jobSubscriptions.values()].map((entry) => entry.extensionId),
      ...[...this.commands.values()].map((entry) => entry.extensionId),
      ...[...this.accountSessions.values()].map((entry) => entry.extensionId),
      ...[...this.providerStreams.values()].map((entry) => entry.extensionId),
      ...this.profileRegistrations.keys()
    ])
    for (const id of ids) await this.disposeExtension(id)
  }

  private failProviderStream(entry: ProviderStreamEntry, error: Error): void {
    entry.queue.fail(error)
    if (!entry.controller.signal.aborted) entry.controller.abort(error)
  }

  private async dispatch(
    principal: ExtensionPrincipal,
    request: ExtensionBrokerDispatchRequest,
    trustedManagement: boolean,
    nodeHost: boolean
  ): Promise<unknown> {
    switch (request.method) {
      case 'commands.register':
        return this.registerCommand(principal, request.params)
      case 'commands.unregister':
        return this.unregisterCommand(principal, request.params)
      case 'commands.execute':
        return this.executeCommand(principal, request.params, request.signal)
      case 'storage.get':
      case 'storage.set':
      case 'storage.delete':
      case 'storage.keys':
        return this.storage(principal, request.method, request.params)
      case 'configuration.get':
      case 'configuration.update':
      case 'configuration.keys':
        return this.configuration(principal, request.method, request.params)
      case 'network.fetch':
        return this.networkFetch(principal, request.params, request.signal)
      case 'ui.getTheme':
        return (await this.options.onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ?? {
          kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false
        }
      case 'ui.getLocale':
        return (await this.options.onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ?? {
          language: 'en', direction: 'ltr', messages: {}
        }
      case 'ui.getViewState':
        return this.viewStateGet(principal)
      case 'ui.setViewState':
        return this.viewStateSet(principal, request.params)
      case 'ui.postMessage':
      case 'ui.showNotification':
        return (await this.options.onUiRequest?.({
          principal,
          method: request.method,
          params: request.params,
          signal: request.signal
        })) ??
          (request.method === 'ui.showNotification' ? {} : null)
      case 'ui.attachComposerContext':
        throw new Error(
          'ui.attachComposerContext is available only through an authenticated desktop Extension View'
        )
      case 'agent.createRun':
        await this.ensureProfiles(principal)
        return this.agentCreateRun(principal, request.params)
      case 'agent.getRun':
        return this.agentGetRun(principal, request.params)
      case 'agent.subscribe':
        return this.agentSubscribe(principal, request.params)
      case 'agent.unsubscribe':
        return this.agentUnsubscribe(principal, request.params)
      case 'agent.steer':
        return this.agentSteer(principal, request.params)
      case 'agent.cancel':
        return this.agentCancel(principal, request.params)
      case 'threads.listOwn':
        return this.threadsListOwn(principal, request.params)
      case 'threads.getOwn':
        return this.threadsGetOwn(principal, request.params)
      case 'tools.register':
        return this.registerTool(principal, request.params)
      case 'tools.unregister':
        return this.unregisterTool(principal, request.params)
      case 'modelProviders.register':
        return this.registerProvider(principal, request.params)
      case 'modelProviders.unregister':
        return this.unregisterProvider(principal, request.params)
      case 'modelProviders.getStatus':
        return this.providerStatus(principal, request.params)
      case 'authentication.listAccounts':
        return this.listAccounts(principal, request.params)
      case 'authentication.createSession':
        return this.createAccountSession(principal, request.params, trustedManagement)
      case 'authentication.getSession':
        return this.getAccountSession(principal, request.params, trustedManagement)
      case 'authentication.cancelSession':
        return this.cancelAccountSession(principal, request.params)
      case 'authentication.deleteAccount':
        return this.deleteAccount(principal, request.params)
      case 'authentication.authenticatedFetch':
        return this.authenticatedFetch(principal, request.params, request.signal)
      case 'authentication.revealSecret':
        return this.revealSecret(principal, request.params, request.signal, nodeHost)
      case 'workspace.readFile':
      case 'workspace.writeFile':
      case 'workspace.stat':
      case 'workspace.list':
        return this.workspace(principal, request.method, request.params)
      case 'media.pickFiles':
        return this.mediaPickFiles(principal, request.params, request.signal)
      case 'media.pickSaveTarget':
        return this.mediaPickSaveTarget(principal, request.params, request.signal)
      case 'media.createCacheTarget':
        return this.mediaCreateCacheTarget(principal, request.params)
      case 'media.stat':
        return this.mediaStat(principal, request.params)
      case 'media.readText':
        return this.mediaReadText(principal, request.params)
      case 'media.release':
        return this.mediaRelease(principal, request.params, request.signal)
      case 'media.openViewResource':
        return this.mediaOpenViewResource(principal, request.params, request.signal)
      case 'media.performArtifactAction':
        return this.mediaPerformArtifactAction(principal, request.params, request.signal)
      case 'media.getCapabilities':
        return this.mediaGetCapabilities(principal)
      case 'media.getAudioAnalysisCapabilities':
        return this.mediaGetAudioAnalysisCapabilities(principal)
      case 'media.getVisualModelStatus':
        return this.mediaGetVisualModelStatus(principal)
      case 'media.installVisualModel':
        return this.mediaInstallVisualModel(principal, request.params)
      case 'media.analyzeVisualFrames':
        return this.mediaAnalyzeVisualFrames(principal, request.params, request.signal)
      case 'media.embedVisualQuery':
        return this.mediaEmbedVisualQuery(principal, request.params, request.signal)
      case 'media.probe':
        return this.mediaProbe(principal, request.params)
      case 'media.startFfmpegJob':
        return this.mediaStartFfmpegJob(principal, request.params)
      case 'media.startAudioAnalysisJob':
        return this.mediaStartAudioAnalysisJob(principal, request.params)
      case 'media.startArchiveJob':
        return this.mediaStartArchiveJob(principal, request.params)
      case 'jobs.get':
        return this.jobsGet(principal, request.params)
      case 'jobs.list':
        return this.jobsList(principal, request.params)
      case 'jobs.subscribe':
        return this.jobsSubscribe(principal, request.params)
      case 'jobs.unsubscribe':
        return this.jobsUnsubscribe(principal, request.params)
      case 'jobs.cancel':
        return this.jobsCancel(principal, request.params)
      default:
        throw new Error(`unsupported Extension Host broker method: ${request.method}`)
    }
  }

  private async mediaPickFiles(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    const request = MediaPickFilesRequestSchema.parse(params)
    const result = await this.requireUiOperation(principal, 'media.pickFiles', request, signal)
    return MediaPickFilesResultSchema.parse(result)
  }

  private async mediaPickSaveTarget(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    const request = MediaPickSaveTargetRequestSchema.parse(params)
    const result = await this.requireUiOperation(principal, 'media.pickSaveTarget', request, signal)
    return MediaPickSaveTargetResultSchema.parse(result)
  }

  private async mediaCreateCacheTarget(
    principal: ExtensionPrincipal,
    params: JsonValue
  ) {
    if (!this.options.mediaHandles) throw new Error('Media handle service is unavailable')
    const request = MediaCreateCacheTargetRequestSchema.parse(params)
    if (!principal.workspaceTrusted || principal.workspaceRoots.length !== 1) {
      throw extensionError(
        'MEDIA_SCOPE_DENIED',
        'Cache media requires exactly one active trusted workspace',
        { operation: 'media.createCacheTarget' }
      )
    }
    const workspaceRoot = principal.workspaceRoots[0]!
    const format = cacheFormat(request.format)
    const relativeDirectory = join(
      '.kun',
      'extension-cache',
      principal.extensionId,
      request.purpose
    )
    const displayName = `${request.purpose}-${randomUUID()}.${format.extension}`
    const handle = await this.options.mediaHandles.registerCacheTarget(principal, {
      workspaceRoot,
      path: join(relativeDirectory, displayName),
      displayName,
      mimeType: format.mimeType
    })
    return MediaCreateCacheTargetResultSchema.parse({
      target: publicMediaMetadata(handle, false)
    })
  }

  private async mediaStat(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.mediaHandles) throw new Error('Media handle service is unavailable')
    const request = z.strictObject({ handleId: z.string().min(16).max(512) }).parse(params)
    const handle = await this.options.mediaHandles.stat(principal, request.handleId)
    return publicMediaMetadata(handle)
  }

  private async mediaReadText(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.mediaHandles) throw new Error('Media handle service is unavailable')
    const request = MediaReadTextRequestSchema.parse(params)
    const handle = await this.options.mediaHandles.resolve(principal, request.handleId, 'read')
    if (handle.byteSize !== undefined && handle.byteSize > request.maxBytes) {
      throw extensionError(
        'MEDIA_LIMIT_EXCEEDED',
        `Selected text file exceeds the ${request.maxBytes}-byte read limit`,
        { operation: 'media.readText', limitCategory: 'media_text_bytes' }
      )
    }
    const bytes = await readFile(handle.absolutePath)
    if (bytes.byteLength > request.maxBytes) {
      throw extensionError(
        'MEDIA_LIMIT_EXCEEDED',
        `Selected text file exceeds the ${request.maxBytes}-byte read limit`,
        { operation: 'media.readText', limitCategory: 'media_text_bytes' }
      )
    }
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw extensionError(
        'MEDIA_INVALID_ARGUMENT',
        'Selected text file is not valid UTF-8',
        { operation: 'media.readText' }
      )
    }
    return MediaReadTextResultSchema.parse({
      handleId: handle.id,
      displayName: handle.displayName,
      mimeType: handle.mimeType,
      byteSize: bytes.byteLength,
      content
    })
  }

  private async mediaRelease(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    const request = MediaReleaseRequestSchema.parse(params)
    if (request.resource === 'handle') {
      if (!this.options.mediaHandles) throw new Error('Media handle service is unavailable')
      return { released: await this.options.mediaHandles.release(principal, request.handleId) }
    }
    const result = await this.requireUiOperation(principal, 'media.release', request, signal)
    return z.strictObject({ released: z.boolean() }).parse(result)
  }

  private async mediaOpenViewResource(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    if (!principal.viewSessionId || !principal.viewContributionId) {
      throw new Error('Media View resources require an authenticated View Session')
    }
    const request = MediaOpenViewResourceRequestSchema.parse(params)
    const result = await this.requireUiOperation(principal, 'media.openViewResource', request, signal)
    const lease = MediaResourceLeaseSchema.parse(result)
    if (lease.handleId !== request.handleId) {
      throw extensionError(
        'MEDIA_INVALID_ARGUMENT',
        'The protected View lease did not match the requested media handle',
        { operation: 'media.openViewResource' }
      )
    }
    await this.options.mediaHandles?.touch(principal, request.handleId)
    return lease
  }

  private async mediaPerformArtifactAction(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    if (!principal.viewSessionId || !principal.viewContributionId) {
      throw new Error('Artifact actions require an authenticated View Session')
    }
    const request = ArtifactHostActionRequestSchema.parse(params)
    const result = await this.requireUiOperation(
      principal,
      'media.performArtifactAction',
      request,
      signal
    )
    return ArtifactHostActionResultSchema.parse(result)
  }

  private async mediaGetCapabilities(principal: ExtensionPrincipal) {
    if (!this.options.mediaProcesses) throw new Error('Media process service is unavailable')
    const capabilities = await this.options.mediaProcesses.capabilities(principal)
    return MediaCapabilitiesSchema.parse({
      probedAt: capabilities.probedAt,
      ffprobe: publicMediaCapability(capabilities.ffprobe),
      ffmpeg: publicMediaCapability(capabilities.ffmpeg)
    })
  }

  private async mediaGetAudioAnalysisCapabilities(principal: ExtensionPrincipal) {
    if (!this.options.audioAnalysisJobs) {
      throw new Error('Audio-analysis job service is unavailable')
    }
    return MediaAudioAnalysisCapabilitiesSchema.parse(
      await this.options.audioAnalysisJobs.capabilities(principal)
    )
  }

  private async mediaGetVisualModelStatus(principal: ExtensionPrincipal) {
    if (!this.options.visualAnalysis) throw new Error('Visual-analysis service is unavailable')
    return MediaVisualModelStatusSchema.parse(
      await this.options.visualAnalysis.status(principal)
    )
  }

  private async mediaInstallVisualModel(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.visualAnalysis) throw new Error('Visual-analysis service is unavailable')
    MediaInstallVisualModelRequestSchema.parse(params)
    return MediaVisualModelStatusSchema.parse(
      await this.options.visualAnalysis.install(principal)
    )
  }

  private async mediaAnalyzeVisualFrames(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    if (!this.options.visualAnalysis) throw new Error('Visual-analysis service is unavailable')
    const request = MediaAnalyzeVisualFramesRequestSchema.parse(params)
    return MediaAnalyzeVisualFramesResultSchema.parse(
      await this.options.visualAnalysis.analyzeFrames(principal, request, signal)
    )
  }

  private async mediaEmbedVisualQuery(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal
  ) {
    if (!this.options.visualAnalysis) throw new Error('Visual-analysis service is unavailable')
    const request = MediaEmbedVisualQueryRequestSchema.parse(params)
    return MediaEmbedVisualQueryResultSchema.parse(
      await this.options.visualAnalysis.embedQuery(principal, request, signal)
    )
  }

  private async mediaProbe(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.mediaProcesses) throw new Error('Media process service is unavailable')
    const request = MediaProbeRequestSchema.parse(params)
    return MediaProbeResultSchema.parse(await this.options.mediaProcesses.probe(
      principal,
      request.handleId
    ))
  }

  private async mediaStartFfmpegJob(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.mediaJobs) throw new Error('Media job service is unavailable')
    const request = MediaStartFfmpegJobRequestSchema.parse(params)
    return { job: await this.options.mediaJobs.start(principal, request) }
  }

  private async mediaStartAudioAnalysisJob(
    principal: ExtensionPrincipal,
    params: JsonValue
  ) {
    if (!this.options.audioAnalysisJobs) {
      throw new Error('Audio-analysis job service is unavailable')
    }
    const request = MediaStartAudioAnalysisJobRequestSchema.parse(params)
    return MediaStartAudioAnalysisJobResultSchema.parse(
      await this.options.audioAnalysisJobs.start(principal, request)
    )
  }

  private async mediaStartArchiveJob(principal: ExtensionPrincipal, params: JsonValue) {
    if (!this.options.archiveJobs) throw new Error('Media archive job service is unavailable')
    const request = MediaStartArchiveJobRequestSchema.parse(params)
    return MediaStartArchiveJobResultSchema.parse(
      await this.options.archiveJobs.start(principal, request)
    )
  }

  private async jobsGet(principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this.requireJobs(principal)
    const request = JobGetRequestSchema.parse(params)
    return JobSnapshotSchema.parse(await jobs.getOwned(jobCaller(principal), request.jobId))
  }

  private async jobsList(principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this.requireJobs(principal)
    const request = JobListRequestSchema.parse(params)
    return await jobs.listOwned(jobCaller(principal), {
      ...(request.filter ? { filter: request.filter } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
      limit: request.limit
    })
  }

  private async jobsSubscribe(principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this.requireJobs(principal)
    const request = z.strictObject({
      jobId: z.string().min(8).max(512),
      afterCursor: z.string().min(8).max(512).optional()
    }).parse(params)
    const subscription = await jobs.subscribe(
      jobCaller(principal),
      request.jobId,
      request.afterCursor
    )
    if (!subscription.complete) {
      this.jobSubscriptions.set(subscription.subscriptionId, {
        extensionId: principal.extensionId,
        ...(principal.hostLifecycleNonce
          ? { hostLifecycleNonce: principal.hostLifecycleNonce }
          : {}),
        ...(principal.viewSessionId ? { viewSessionId: principal.viewSessionId } : {}),
        workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
        subscription
      })
      void this.pumpJobSubscription(principal, subscription)
    }
    return {
      subscriptionId: subscription.subscriptionId,
      snapshot: JobSnapshotSchema.parse(subscription.snapshot),
      replay: subscription.replay,
      cursor: subscription.cursor,
      gap: subscription.gap,
      complete: subscription.complete
    }
  }

  private jobsUnsubscribe(principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this.requireJobs(principal)
    const { subscriptionId } = SubscriptionIdSchema.parse(params)
    const entry = this.jobSubscriptions.get(subscriptionId)
    if (entry && registrationOwnedByPrincipal(entry, principal)) {
      jobs.unsubscribe(jobCaller(principal), subscriptionId)
      entry.subscription.close()
      this.jobSubscriptions.delete(subscriptionId)
    }
    return null
  }

  private async jobsCancel(principal: ExtensionPrincipal, params: JsonValue) {
    const jobs = this.requireJobs(principal)
    const request = JobCancelRequestSchema.parse(params)
    return await jobs.cancel(jobCaller(principal), request.jobId, request.reason)
  }

  private requireJobs(principal: ExtensionPrincipal): ExtensionJobService {
    if (!principal.permissions.includes('jobs.manage')) throw new Error('Missing permission: jobs.manage')
    if (!this.options.jobs) throw new Error('Extension job service is unavailable')
    return this.options.jobs
  }

  private async pumpJobSubscription(
    principal: ExtensionPrincipal,
    subscription: ExtensionJobSubscription
  ): Promise<void> {
    try {
      for await (const item of subscription) {
        if (item.type === 'overflow') break
        const notification = toJson({ subscriptionId: subscription.subscriptionId, event: item.event })
        if (principal.viewSessionId) {
          if (!this.options.notifyView) throw new Error('View notification bridge is unavailable')
          await this.options.notifyView({ principal, method: 'jobs.event', params: notification })
        } else {
          await this.options.notifyExtension?.(principal, 'jobs.event', notification)
        }
      }
    } finally {
      const entry = this.jobSubscriptions.get(subscription.subscriptionId)
      if (entry?.subscription === subscription) this.jobSubscriptions.delete(subscription.subscriptionId)
      subscription.close()
    }
  }

  private async requireUiOperation(
    principal: ExtensionPrincipal,
    method: string,
    params: unknown,
    signal: AbortSignal
  ): Promise<JsonValue> {
    if (!this.options.onUiRequest) {
      throw extensionError(
        'MEDIA_INTERACTION_REQUIRED',
        'Media operation requires protected desktop interaction',
        { operation: method }
      )
    }
    const result = await this.options.onUiRequest({
      principal,
      method,
      params: toJson(params),
      signal
    })
    if (result === undefined) {
      throw extensionError(
        'MEDIA_INTERACTION_REQUIRED',
        'Media operation requires protected desktop interaction',
        { operation: method }
      )
    }
    return result
  }

  private async registerCommand(principal: ExtensionPrincipal, params: JsonValue) {
    const input = CommandRegisterSchema.parse(params)
    const manifest = await this.options.resolveManifest?.(principal.extensionId)
    const contribution = requireManifestContribution(manifest?.contributes.commands, input.id, 'command')
    const inputValidator = contribution.inputSchema
      ? compileExtensionJsonSchema(contribution.inputSchema, `command ${input.id} input`)
      : undefined
    const outputValidator = contribution.outputSchema
      ? compileExtensionJsonSchema(contribution.outputSchema, `command ${input.id} output`)
      : undefined
    const registrationId = `command_${randomUUID()}`
    this.commands.set(registrationId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      localId: input.id,
      activationEvent: activationEventFor(manifest, `onCommand:${input.id}`),
      contribution,
      ...(inputValidator ? { inputValidator } : {}),
      ...(outputValidator ? { outputValidator } : {})
    })
    return { registrationId }
  }

  private unregisterCommand(principal: ExtensionPrincipal, params: JsonValue) {
    const { registrationId } = RegistrationRequestSchema.parse(params)
    const registration = this.commands.get(registrationId)
    if (registrationOwnedByPrincipal(registration, principal)) this.commands.delete(registrationId)
    return null
  }

  private async executeCommand(principal: ExtensionPrincipal, params: JsonValue, signal: AbortSignal) {
    const input = CommandExecuteSchema.parse(params)
    const registration = [...this.commands.entries()].find(([, entry]) =>
      entry.extensionId === principal.extensionId &&
      entry.localId === input.id &&
      sameRegistrationWorkspace(entry.workspaceRoots, principal.workspaceRoots) &&
      (principal.hostLifecycleNonce === undefined ||
        entry.hostLifecycleNonce === principal.hostLifecycleNonce)
    )
    if (!registration) throw new Error(`command is not registered: ${input.id}`)
    const [registrationId, entry] = registration
    const args = input.args ?? null
    entry.inputValidator?.assert(args, `command ${input.id} arguments`)
    const result = await this.options.invokeExtension(
      principal.extensionId,
      entry.activationEvent,
      `commands.invoke:${registrationId}`,
      toJson(args),
      { signal, workspaceRoots: [...entry.workspaceRoots] }
    )
    entry.outputValidator?.assert(result, `command ${input.id} result`)
    return result
  }

  private async storage(principal: ExtensionPrincipal, method: string, params: JsonValue) {
    const input = method === 'storage.keys'
      ? StorageKeysRequestSchema.parse(params)
      : method === 'storage.set'
        ? StorageSetRequestSchema.parse(params)
        : StorageRequestSchema.parse(params)
    const workspaceKey = input.scope === 'workspace' ? requiredWorkspaceKey(principal) : undefined
    if (method === 'storage.keys') {
      const document = await this.options.state.read(principal.extensionId)
      const values = input.scope === 'global'
        ? document.global
        : document.workspaces[workspaceKey!] ?? {}
      return Object.keys(values).filter((key) => !key.startsWith('__kun_')).sort()
    }
    const keyed = input as z.infer<typeof StorageRequestSchema>
    if (keyed.key.startsWith('__kun_')) throw new Error('Reserved extension state key')
    const get = () => input.scope === 'global'
      ? this.options.state.getGlobal(principal.extensionId, keyed.key)
      : this.options.state.getWorkspace(principal.extensionId, workspaceKey!, keyed.key)
    const set = (value: JsonValue | undefined) => input.scope === 'global'
      ? this.options.state.setGlobal(principal.extensionId, keyed.key, value)
      : this.options.state.setWorkspace(principal.extensionId, workspaceKey!, keyed.key, value)
    if (method === 'storage.get') {
      const value = await get()
      return value === undefined ? { found: false } : { found: true, value }
    }
    if (method === 'storage.set') {
      await set(toJson(StorageSetRequestSchema.parse(params).value))
      return null
    }
    if (method === 'storage.delete') {
      const existed = (await get()) !== undefined
      await set(undefined)
      return { deleted: existed }
    }
    throw new Error(`unsupported storage broker method: ${method}`)
  }

  private async configuration(principal: ExtensionPrincipal, method: string, params: JsonValue) {
    const manifest = await this.options.resolveManifest?.(principal.extensionId)
    if (!manifest || manifest.version !== principal.extensionVersion) {
      throw new Error('Extension manifest is unavailable or changed')
    }
    if (method === 'configuration.keys') {
      const input = z.strictObject({ sectionId: ConfigurationSectionSchema }).parse(params)
      return this.options.configuration.keys({ manifest, sectionId: input.sectionId })
    }
    const input = method === 'configuration.update'
      ? ConfigurationUpdateRequestSchema.parse(params)
      : ConfigurationRequestSchema.parse(params)
    if (method === 'configuration.get') {
      const value = await this.options.configuration.get({
        principal,
        manifest,
        sectionId: input.sectionId,
        key: input.key
      })
      return value === undefined ? { found: false } : { found: true, value }
    }
    await this.options.configuration.update({
      principal,
      manifest,
      sectionId: input.sectionId,
      key: input.key,
      value: ConfigurationUpdateRequestSchema.parse(params).value
    })
    return null
  }

  private async viewStateGet(principal: ExtensionPrincipal) {
    const key = viewStateKey(principal)
    const value = principal.workspaceRoots.length > 0
      ? await this.options.state.getWorkspace(
          principal.extensionId,
          requiredWorkspaceKey(principal),
          key
        )
      : await this.options.state.getGlobal(principal.extensionId, key)
    return value === undefined ? { found: false } : { found: true, value }
  }

  private async viewStateSet(principal: ExtensionPrincipal, params: JsonValue) {
    const input = z.strictObject({ value: JsonValueSchema }).parse(params)
    const key = viewStateKey(principal)
    if (principal.workspaceRoots.length > 0) {
      await this.options.state.setWorkspace(
        principal.extensionId,
        requiredWorkspaceKey(principal),
        key,
        toJson(input.value)
      )
    } else {
      await this.options.state.setGlobal(principal.extensionId, key, toJson(input.value))
    }
    return null
  }

  private async networkFetch(principal: ExtensionPrincipal, params: JsonValue, signal: AbortSignal) {
    const input = NetworkRequestSchema.parse(params)
    const url = new URL(input.url)
    assertBrokeredNetworkUrl(url)
    assertNetworkPermission(principal, normalizedBrokerHostname(url))
    const controller = linkedAbortController(signal, input.timeoutMs)
    try {
      const response = await this.fetchImpl(input.url, {
        method: input.method,
        headers: input.headers,
        ...(input.body === undefined ? {} : {
          body: input.bodyEncoding === 'base64' ? Buffer.from(input.body, 'base64') : input.body
        }),
        signal: controller.signal,
        redirect: 'manual'
      })
      return responseProjection(response)
    } finally {
      controller.dispose()
    }
  }

  private async agentCreateRun(principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentCreateRunRequestSchema.parse(params)
    let normalizedBinding = input.providerBinding
      ? { ...input.providerBinding, providerId: this.resolveProviderId(principal, input.providerBinding.providerId) }
      : undefined
    if (!normalizedBinding && input.profileId) {
      const manifest = await this.options.resolveManifest?.(principal.extensionId)
      const localProfileId = input.profileId.startsWith(`${principal.extensionId}/`)
        ? input.profileId.slice(principal.extensionId.length + 1)
        : input.profileId
      const profileBinding = manifest?.contributes.agentProfiles.find(
        (profile) => profile.id === localProfileId
      )?.providerBinding
      if (profileBinding) {
        const providerId = this.resolveProviderId(principal, profileBinding.providerId)
        const stored = profileBinding.accountId
          ? undefined
          : await this.options.providerAccounts.getBinding(
              extensionProviderBindingScope(input.workspace ?? principal.workspaceRoots[0]),
              providerId
            )
        if (
          !profileBinding.accountId &&
          (!stored ||
            stored.ownerExtensionId !== principal.extensionId ||
            stored.ownerExtensionVersion !== principal.extensionVersion)
        ) {
          throw new Error(`connected account binding is required for extension provider profile: ${localProfileId}`)
        }
        normalizedBinding = {
          providerId,
          accountId: profileBinding.accountId ?? stored!.binding.accountId,
          modelId: profileBinding.modelId
        }
      }
    }
    if (normalizedBinding) await this.options.providerAccounts.validateBinding(normalizedBinding)
    const servicePrincipal = await this.expandPrincipalForBinding(principal, normalizedBinding)
    const run = await this.options.agent.createRun(servicePrincipal, {
      input: agentInputText(input.input),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(normalizedBinding ? { providerBinding: normalizedBinding } : {}),
      ...(input.budget ? { budget: {
        ...input.budget,
        ...(input.budget.maxEvents ? { maxRetainedEvents: input.budget.maxEvents } : {})
      } } : {}),
      ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {})
    })
    return { run: publicAgentRun(run), createdThread: !input.threadId }
  }

  private async agentGetRun(principal: ExtensionPrincipal, params: JsonValue) {
    const { runId } = RunIdSchema.parse(params)
    return publicAgentRun(await this.options.agent.getRun(principal, runId))
  }

  private async agentSubscribe(principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentSubscribeRequestSchema.parse(params)
    const subscriptionId = `agentsub_${randomUUID()}`
    const replay: AgentRunEvent[] = []
    let replaying = true
    let terminalSeen = false
    const listener = async (event: ExtensionAgentEvent) => {
      const projected = publicAgentEvent(event)
      if (replaying) replay.push(projected)
      else {
        const notification = toJson({ subscriptionId, event: projected })
        try {
          if (principal.viewSessionId) {
            if (!this.options.notifyView) throw new Error('View notification bridge is unavailable')
            await this.options.notifyView({
              principal,
              method: 'agent.event',
              params: notification
            })
          } else {
            await this.options.notifyExtension?.(
              principal,
              'agent.event',
              notification
            )
          }
        } catch (error) {
          const entry = this.subscriptions.get(subscriptionId)
          if (entry) {
            entry.subscription.close()
            this.subscriptions.delete(subscriptionId)
          }
          throw error
        }
      }
      if (projected.type === 'terminal') {
        terminalSeen = true
        const entry = this.subscriptions.get(subscriptionId)
        if (entry) {
          entry.subscription.close()
          this.subscriptions.delete(subscriptionId)
        }
      }
    }
    const subscription = await this.options.agent.subscribe(principal, {
      runId: input.runId,
      afterSeq: Math.max(0, input.afterSequence - 1)
    }, listener)
    if (terminalSeen) subscription.close()
    else this.subscriptions.set(subscriptionId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      ...(principal.viewSessionId ? { viewSessionId: principal.viewSessionId } : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      subscription
    })
    replaying = false
    return { subscriptionId, replay }
  }

  private agentUnsubscribe(principal: ExtensionPrincipal, params: JsonValue) {
    const { subscriptionId } = SubscriptionIdSchema.parse(params)
    const entry = this.subscriptions.get(subscriptionId)
    if (entry && registrationOwnedByPrincipal(entry, principal)) {
      entry.subscription.close()
      this.subscriptions.delete(subscriptionId)
    }
    return null
  }

  private async agentSteer(principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentSteerRequestSchema.parse(params)
    await this.options.agent.steer(principal, input.runId, agentInputText(input.input))
    return { accepted: true, run: publicAgentRun(await this.options.agent.getRun(principal, input.runId)) }
  }

  private async agentCancel(principal: ExtensionPrincipal, params: JsonValue) {
    const input = AgentCancelRequestSchema.parse(params)
    return { accepted: true, run: publicAgentRun(await this.options.agent.cancel(principal, input.runId)) }
  }

  private async threadsListOwn(principal: ExtensionPrincipal, params: JsonValue) {
    const input = ListOwnThreadsRequestSchema.parse(params)
    const response = await this.options.agent.listOwnThreads(principal, {
      limit: input.limit,
      cursor: input.cursor,
      ...(input.workspace ? { workspace: input.workspace } : {})
    })
    return {
      items: response.items.map((thread) => publicOwnedThread(principal, thread)),
      page: {
        hasMore: Boolean(response.nextCursor),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {})
      }
    }
  }

  private async threadsGetOwn(principal: ExtensionPrincipal, params: JsonValue) {
    const { threadId } = ThreadIdSchema.parse(params)
    return publicOwnedThread(principal, await this.options.agent.getOwnThread(principal, threadId))
  }

  private async registerTool(principal: ExtensionPrincipal, params: JsonValue) {
    const requestedDeclaration = ExtensionToolDeclarationSchema.parse(params)
    const manifest = await this.options.resolveManifest?.(principal.extensionId)
    const declaration = requireManifestContribution(
      manifest?.contributes.tools,
      requestedDeclaration.id,
      'tool'
    )
    assertManifestDeclarationMatches(requestedDeclaration, declaration, 'tool')
    const registrationId = `tool_${randomUUID()}`
    const activationEvent = activationEventFor(manifest, `onTool:${declaration.id}`)
    const registration = await this.options.tools.register(principal, {
      name: declaration.id,
      description: declaration.description,
      inputSchema: declaration.inputSchema,
      ...(declaration.outputSchema ? { outputSchema: declaration.outputSchema } : {}),
      sideEffect: toolSideEffect(declaration.sideEffects),
      idempotent: declaration.idempotent,
      ...(declaration.maxOutputBytes ? { maxOutputBytes: declaration.maxOutputBytes } : {})
    }, async (invocation) => {
      this.toolProgress.set(invocation.invocationId, invocation.reportProgress)
      try {
        const result = ToolResultSchema.parse(await this.options.invokeExtension(
          principal.extensionId,
          activationEvent,
          `tools.invoke:${registrationId}`,
          toJson({
            invocationId: invocation.invocationId,
            toolId: invocation.canonicalToolId,
            input: invocation.arguments,
            workspaceId: invocation.workspace,
            runId: invocation.turnId,
            threadId: invocation.threadId
          }),
          {
            signal: invocation.signal,
            workspaceRoots: [...principal.workspaceRoots]
          }
        ))
        if (result.generatedArtifacts?.length) {
          if (!this.options.artifacts) {
            throw new Error('Generated artifact validation service is unavailable')
          }
          result.generatedArtifacts = await this.options.artifacts.validateToolResult(
            principal,
            extensionWorkspaceKey(invocation.workspace),
            result.generatedArtifacts
          )
        }
        return { output: result, declaredOutput: result.content, isError: false }
      } finally {
        this.toolProgress.delete(invocation.invocationId)
      }
    })
    this.tools.set(registrationId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      localId: declaration.id,
      activationEvent,
      dispose: registration.dispose
    })
    return { registrationId }
  }

  private unregisterTool(principal: ExtensionPrincipal, params: JsonValue) {
    const { registrationId } = RegistrationRequestSchema.parse(params)
    const registration = this.tools.get(registrationId)
    if (registration && registrationOwnedByPrincipal(registration, principal)) {
      registration.dispose()
      this.tools.delete(registrationId)
    }
    return null
  }

  private async registerProvider(principal: ExtensionPrincipal, params: JsonValue) {
    const requestedDeclaration = ModelProviderDeclarationSchema.parse(params)
    const manifest = await this.options.resolveManifest?.(principal.extensionId)
    const declaration = requireManifestContribution(
      manifest?.contributes.modelProviders,
      requestedDeclaration.id,
      'model provider'
    )
    assertManifestDeclarationMatches(requestedDeclaration, declaration, 'model provider')
    const authentication = resolveAuthentication(manifest, declaration.authenticationProviderId)
    const definition = await this.options.providerAccounts.registerProvider(principal, {
      id: declaration.id,
      displayName: declaration.displayName,
      ...(declaration.authenticationProviderId ? {
        authenticationProviderId: declaration.authenticationProviderId
      } : {}),
      authenticationScopes: authentication?.scopes ?? [],
      credentialHosts: declaration.credentialHosts,
      authTypes: [internalAuthenticationType(authentication?.type)],
      ...(authentication?.apiKey ? {
        apiKey: { headerName: authentication.apiKey.header, prefix: authentication.apiKey.prefix }
      } : authentication?.type === 'api-key' || authentication === undefined ? {
        apiKey: { headerName: 'Authorization', prefix: 'Bearer ' }
      } : {}),
      ...(authentication?.type === 'oauth2-pkce' ? {
        oauthPkce: {
          authorizationUrl: authentication.authorizationUrl!,
          tokenUrl: authentication.tokenUrl!,
          clientId: authentication.clientId!,
          redirectUri: authentication.redirectUri!,
          scopes: authentication.scopes ?? []
        }
      } : {}),
      ...(authentication?.type === 'device-code' ? {
        oauthDevice: {
          deviceAuthorizationUrl: authentication.deviceAuthorizationUrl!,
          tokenUrl: authentication.tokenUrl!,
          clientId: authentication.clientId!,
          scopes: authentication.scopes ?? []
        }
      } : {}),
      capabilities: providerCapabilities(declaration)
    })
    const registrationId = `provider_${randomUUID()}`
    const activationEvent = activationEventFor(manifest, `onProvider:${declaration.id}`)
    const adapter = this.remoteProviderAdapter(
      principal,
      registrationId,
      activationEvent
    )
    let registration
    try {
      registration = await this.options.modelProviders.register(principal, declaration, adapter)
    } catch (error) {
      await this.options.providerAccounts.unregisterProvider(principal, definition.id).catch(() => undefined)
      throw error
    }
    this.providers.set(registrationId, {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
      localId: declaration.id,
      providerId: definition.id,
      activationEvent,
      dispose: registration.dispose
    })
    await this.ensureProfiles(principal, true)
    return { registrationId }
  }

  private async unregisterProvider(principal: ExtensionPrincipal, params: JsonValue) {
    const { registrationId } = RegistrationRequestSchema.parse(params)
    const registration = this.providers.get(registrationId)
    if (registration && registrationOwnedByPrincipal(registration, principal)) {
      await registration.dispose()
      await this.options.providerAccounts.unregisterProvider(principal, registration.providerId)
      this.providers.delete(registrationId)
    }
    return null
  }

  private providerStatus(principal: ExtensionPrincipal, params: JsonValue) {
    const { providerId } = z.strictObject({ providerId: z.string().min(1).max(129) }).parse(params)
    const entry = [...this.providers.values()].find((registration) =>
      registration.extensionId === principal.extensionId &&
      (registration.providerId === providerId || registration.localId === providerId)
    )
    return {
      providerId: entry?.providerId ?? providerId,
      status: entry ? 'available' : 'unavailable',
      ...(entry ? {} : { message: 'Provider is not registered in the active Extension Host.' }),
      checkedAt: this.now().toISOString()
    }
  }

  private remoteProviderAdapter(
    principal: ExtensionPrincipal,
    registrationId: string,
    activationEvent: string
  ): ModelProviderAdapter {
    const invoke = (params: JsonValue, signal?: AbortSignal) => this.options.invokeExtension(
      principal.extensionId,
      activationEvent,
      `modelProviders.invoke:${registrationId}`,
      params,
      { signal, workspaceRoots: [...principal.workspaceRoots] }
    )
    return {
      probe: async (binding, context) => z.object({
        ok: z.boolean(), latencyMs: z.number().optional(), message: z.string().optional(),
        details: JsonObjectSchema.optional()
      }).parse(await invoke(toJson({ operation: 'probe', binding }), cancellationSignal(context.cancellation))),
      listModels: async (binding, context) => z.array(z.unknown()).parse(
        await invoke(toJson({ operation: 'listModels', binding }), cancellationSignal(context.cancellation))
      ) as never,
      stream: (providerRequest, context) => this.remoteProviderStream(
        principal,
        registrationId,
        activationEvent,
        providerRequest,
        cancellationSignal(context.cancellation)
      ),
      cancel: async (requestId) => {
        await invoke(toJson({ operation: 'cancel', requestId })).catch(() => undefined)
      },
      countTokens: async (providerRequest, context) => {
        const value = z.strictObject({ count: z.number().int().nonnegative() }).parse(await invoke(
          toJson({ operation: 'countTokens', request: providerRequest }),
          cancellationSignal(context.cancellation)
        ))
        return value.count
      }
    }
  }

  private async *remoteProviderStream(
    principal: ExtensionPrincipal,
    registrationId: string,
    activationEvent: string,
    request: ModelProviderRequest,
    signal: AbortSignal
  ): AsyncIterable<ModelProviderStreamEvent> {
    const key = providerStreamKey(registrationId, request.requestId)
    if (this.providerStreams.has(key)) throw new Error(`duplicate extension provider request: ${request.requestId}`)
    const queue = new AsyncEventQueue<ModelProviderStreamEvent>({
      maximumItems: this.providerStreamQueueEvents,
      maximumBytes: this.providerStreamQueueBytes,
      sizeOf: serializedQueueBytes
    })
    const controller = new AbortController()
    const forwardCancellation = () => controller.abort(signal.reason)
    if (signal.aborted) forwardCancellation()
    else signal.addEventListener('abort', forwardCancellation, { once: true })
    const entry: ProviderStreamEntry = {
      extensionId: principal.extensionId,
      ...(principal.hostLifecycleNonce
        ? { hostLifecycleNonce: principal.hostLifecycleNonce }
        : {}),
      registrationId,
      requestId: request.requestId,
      queue,
      controller,
      transportTerminal: false,
      invocationSettled: false
    }
    this.providerStreams.set(key, entry)
    const invocation = this.options.invokeExtension(
      principal.extensionId,
      activationEvent,
      `modelProviders.invoke:${registrationId}`,
      toJson({ operation: 'stream', request }),
      {
        signal: controller.signal,
        resetTimeoutOnStream: true,
        workspaceRoots: [...principal.workspaceRoots]
      }
    )
    void invocation.then(
      () => {
        entry.invocationSettled = true
        queue.end()
      },
      (error) => {
        entry.invocationSettled = true
        queue.fail(error)
      }
    )
    try {
      for await (const event of queue) yield event
    } finally {
      signal.removeEventListener('abort', forwardCancellation)
      if (this.providerStreams.get(key) === entry) this.providerStreams.delete(key)
      if (!entry.invocationSettled && !entry.transportTerminal && !controller.signal.aborted) {
        controller.abort(new Error('extension provider stream consumer closed'))
      }
      queue.close()
    }
  }

  private async listAccounts(principal: ExtensionPrincipal, params: JsonValue): Promise<Account[]> {
    const input = ListAccountsRequestSchema.parse(params)
    const resolvedProviderId = input.providerId
      ? this.resolveProviderId(principal, input.providerId)
      : undefined
    const expanded = resolvedProviderId
      ? this.expandPrincipalForProviderId(principal, resolvedProviderId)
      : this.expandPrincipalForAllProviders(principal)
    const accounts = await this.options.accounts.listAccounts(expanded, resolvedProviderId)
    const protection = await this.options.credentials.protection()
    const publicProtection: Account['protection'] = protection.mode === 'primary'
      ? 'system'
      : protection.mode === 'encrypted-fallback' ? 'encrypted-fallback' : 'unavailable'
    return accounts
      .filter((account) => input.includeUnavailable || account.status !== 'unavailable')
      .map((account) => AccountSchema.parse(publicAccount(account, publicProtection)))
  }

  private async createAccountSession(
    principal: ExtensionPrincipal,
    params: JsonValue,
    exposeInteractiveMaterial: boolean
  ): Promise<AccountSession> {
    this.pruneAccountSessions()
    const ownedSessionCount = [...this.accountSessions.values()].filter(
      (session) => session.extensionId === principal.extensionId
    ).length
    if (ownedSessionCount >= this.maxAccountSessionsPerExtension) {
      throw new Error('extension account-session limit reached')
    }
    const input = CreateAccountSessionRequestSchema.parse(params)
    const providerId = this.resolveProviderId(principal, input.providerId)
    const expanded = this.expandPrincipalForProviderId(principal, providerId)
    const provider = await this.options.providerAccounts.requireOwnedProvider(expanded, providerId)
    if (
      provider.authenticationProviderId &&
      provider.authenticationProviderId !== input.authenticationProviderId
    ) throw new Error('authentication contribution does not match the selected provider')
    const effectiveScopes = effectiveAuthenticationScopes(
      provider.authenticationScopes ?? [],
      input.scopes
    )
    const label = input.label ?? provider.displayName
    const id = `accountsession_${randomUUID()}`
    const now = this.now().getTime()
    let session: StoredAccountSession
    if (provider.oauthPkce) {
      const pending = await this.options.accounts.beginPkceAuthorization({
        principal: expanded,
        providerId: provider.id,
        label,
        scopes: effectiveScopes,
        headless: true
      })
      session = {
        id, extensionId: principal.extensionId,
        workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
        lastTouchedAt: now,
        transactionId: pending.transactionId,
        providerId: provider.id, kind: 'oauth-pkce',
        status: 'pending', verificationUrl: pending.authorizationUrl,
        expiresAt: pending.expiresAt,
        message: 'Complete authorization in the protected Kun account window.'
      }
    } else if (provider.oauthDevice) {
      const pending = await this.options.accounts.beginDeviceAuthorization({
        principal: expanded,
        providerId: provider.id,
        label,
        scopes: effectiveScopes
      })
      session = {
        id, extensionId: principal.extensionId,
        workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
        lastTouchedAt: now,
        transactionId: pending.transactionId,
        providerId: provider.id, kind: 'oauth-device',
        status: 'pending', verificationUrl: pending.verificationUri, userCode: pending.userCode,
        expiresAt: pending.expiresAt,
        message: 'Complete device authorization, then return to Kun.'
      }
    } else {
      session = {
        id, extensionId: principal.extensionId,
        workspaceRoots: normalizedRegistrationWorkspaceRoots(principal.workspaceRoots),
        lastTouchedAt: now,
        providerId: provider.id, kind: 'api-key', status: 'pending',
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
        message: 'API keys must be entered in the protected Kun account window.'
      }
    }
    this.accountSessions.set(id, session)
    if (session.kind === 'oauth-device' && session.transactionId) {
      void this.options.accounts.completeDeviceAuthorization({
        principal: expanded,
        transactionId: session.transactionId
      }).then(async (account) => {
        if (this.accountSessions.get(id) !== session || session.status !== 'pending') return
        session.status = 'completed'
        session.lastTouchedAt = this.now().getTime()
        session.account = publicAccount(account, await this.publicCredentialProtection())
        session.message = 'Account connected.'
      }).catch((error) => {
        if (this.accountSessions.get(id) !== session || session.status !== 'pending') return
        session.status = 'failed'
        session.lastTouchedAt = this.now().getTime()
        session.message = boundedError(error)
      })
    }
    return publicAccountSession(session, exposeInteractiveMaterial)
  }

  private async publicCredentialProtection(): Promise<Account['protection']> {
    const protection = await this.options.credentials.protection()
    return protection.mode === 'primary'
      ? 'system'
      : protection.mode === 'encrypted-fallback' ? 'encrypted-fallback' : 'unavailable'
  }

  private getAccountSession(
    principal: ExtensionPrincipal,
    params: JsonValue,
    exposeInteractiveMaterial: boolean
  ): AccountSession {
    this.pruneAccountSessions()
    const { sessionId } = z.strictObject({ sessionId: z.string().min(1).max(256) }).parse(params)
    const session = this.accountSessions.get(sessionId)
    if (!session || session.extensionId !== principal.extensionId) throw new Error('account session not found')
    if (session.expiresAt && Date.parse(session.expiresAt) <= this.now().getTime() && session.status === 'pending') {
      session.status = 'expired'
    }
    session.lastTouchedAt = this.now().getTime()
    return publicAccountSession(session, exposeInteractiveMaterial)
  }

  private cancelAccountSession(principal: ExtensionPrincipal, params: JsonValue) {
    const { sessionId } = z.strictObject({ sessionId: z.string().min(1).max(256) }).parse(params)
    const session = this.accountSessions.get(sessionId)
    if (!session || session.extensionId !== principal.extensionId) return null
    const cancelled = session.transactionId
      ? this.options.accounts.cancelAuthorization(principal, session.transactionId)
      : session.kind === 'api-key'
    if (cancelled) {
      session.status = 'cancelled'
      session.lastTouchedAt = this.now().getTime()
      session.message = 'Account authorization cancelled.'
    } else if (session.status === 'pending') {
      session.message = 'Authorization is already completing and can no longer be cancelled.'
    }
    return null
  }

  private pruneAccountSessions(): void {
    const now = this.now().getTime()
    for (const [id, session] of this.accountSessions) {
      if (
        session.status === 'pending' &&
        session.expiresAt &&
        Date.parse(session.expiresAt) <= now
      ) {
        if (session.transactionId) {
          this.options.accounts.cancelAuthorization(
            this.principalWithProviderPermissions(session.extensionId, [], session.providerId ?? ''),
            session.transactionId
          )
        }
        session.status = 'expired'
        session.lastTouchedAt = now
      }
      if (
        session.status !== 'pending' &&
        now - session.lastTouchedAt >= this.accountSessionRetentionMs
      ) this.accountSessions.delete(id)
    }
  }

  private async deleteAccount(principal: ExtensionPrincipal, params: JsonValue) {
    const { accountId } = z.strictObject({ accountId: z.string().min(1).max(256) }).parse(params)
    const account = await this.options.providerAccounts.getAccount(accountId)
    if (!account || account.ownerExtensionId !== principal.extensionId) return null
    await this.options.accounts.deleteAccount(
      this.expandPrincipalForProviderId(principal, account.providerId),
      accountId
    )
    for (const [sessionId, session] of this.accountSessions) {
      if (session.extensionId === principal.extensionId && session.account?.id === accountId) {
        this.accountSessions.delete(sessionId)
      }
    }
    return null
  }

  private async authenticatedFetch(principal: ExtensionPrincipal, params: JsonValue, signal: AbortSignal) {
    const input = AuthenticatedFetchRequestSchema.parse(params)
    const account = await this.options.providerAccounts.getAccount(input.accountId)
    if (!account || account.ownerExtensionId !== principal.extensionId) throw new Error('account not found')
    const response = await this.options.accounts.authenticatedFetch({
      principal: this.expandPrincipalForProviderId(principal, account.providerId),
      accountId: input.accountId,
      url: input.url,
      init: {
        method: input.method,
        headers: input.headers,
        ...(input.body !== undefined ? { body: input.body } : {}),
        signal: input.timeoutMs
          ? AbortSignal.any([signal, AbortSignal.timeout(input.timeoutMs)])
          : signal
      }
    })
    return responseProjection(response)
  }

  private async revealSecret(
    principal: ExtensionPrincipal,
    params: JsonValue,
    signal: AbortSignal,
    nodeHost: boolean
  ) {
    const input = RevealSecretRequestSchema.parse(params)
    const account = await this.options.providerAccounts.getAccount(input.accountId)
    if (!account || account.ownerExtensionId !== principal.extensionId) throw new Error('account not found')
    const expanded = this.expandPrincipalForProviderId(principal, account.providerId)
    if (!nodeHost) throw new Error('Raw account secret access is available only to the Node Extension Host')
    const permission = `accounts.secrets.read:${account.providerId}`
    if (!expanded.permissions.includes(permission)) throw new Error(`Missing permission: ${permission}`)
    const allowed = await this.options.authorizeSecretReveal?.({
      principal: expanded,
      accountId: input.accountId,
      operation: input.operation,
      signal
    }) ?? false
    const value = await this.options.accounts.revealSecret({
      principal: expanded,
      accountId: input.accountId,
      nodeHost,
      protectedConsent: allowed,
      operation: input.operation
    })
    const secret = value.apiKey ?? value.accessToken
    if (!secret) throw new Error('account has no revealable primary secret')
    return { secret }
  }

  private async workspace(principal: ExtensionPrincipal, method: string, params: JsonValue) {
    if (method === 'workspace.writeFile') {
      const input = WorkspaceFileSchema.parse(params)
      const target = await confinedWorkspacePath(principal, input.path, true)
      const content = input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content)
      if (content.byteLength > 8 * 1024 * 1024) throw new Error('workspace write exceeds 8 MiB')
      await writeFile(target, content)
      return null
    }
    const input = z.strictObject({
      path: z.string().min(1).max(4096),
      encoding: z.enum(['utf8', 'base64']).optional()
    }).parse(params)
    const target = await confinedWorkspacePath(principal, input.path, false)
    if (method === 'workspace.readFile') {
      const content = await readFile(target)
      if (content.byteLength > 8 * 1024 * 1024) throw new Error('workspace read exceeds 8 MiB')
      return {
        path: input.path,
        content: (input.encoding ?? 'utf8') === 'base64' ? content.toString('base64') : content.toString('utf8'),
        encoding: input.encoding ?? 'utf8'
      }
    }
    if (method === 'workspace.stat') {
      const info = await stat(target)
      return {
        path: input.path,
        type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
        size: info.size,
        modifiedAt: info.mtime.toISOString()
      }
    }
    const entries = await readdir(target, { withFileTypes: true })
    return entries.slice(0, 10_000).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    }))
  }

  private async expandPrincipalForBinding(
    principal: ExtensionPrincipal,
    binding?: ProviderBinding
  ): Promise<ExtensionPrincipal> {
    if (!binding) return principal
    return this.expandPrincipalForProviderId(principal, binding.providerId)
  }

  private async ensureProfiles(principal: ExtensionPrincipal, force = false): Promise<void> {
    const manifest = await this.options.resolveManifest?.(principal.extensionId)
    if (!manifest) return
    const definitions = manifest.contributes.agentProfiles.map((profile) => ({
      id: profile.id,
      displayName: profile.title,
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.instructions ? { instructionOverlay: profile.instructions } : {}),
      ...(profile.providerBinding ? {
        providerBinding: {
          ...profile.providerBinding,
          providerId: this.resolveProviderId(principal, profile.providerBinding.providerId)
        }
      } : {}),
      ...(profile.allowedTools ? { allowedToolScopes: profile.allowedTools } : {}),
      ...(profile.budget ? {
        defaultBudget: {
          ...profile.budget,
          ...(profile.budget.maxEvents ? { maxRetainedEvents: profile.budget.maxEvents } : {})
        }
      } : {}),
      visibility: profile.visibility
    }))
    const signature = JSON.stringify(definitions)
    const current = this.profileRegistrations.get(principal.extensionId)
    if (!force && current?.signature === signature) return
    current?.dispose()
    const dispose = this.options.profiles.register({
      extensionId: principal.extensionId,
      extensionVersion: principal.extensionVersion,
      profiles: definitions
    })
    this.profileRegistrations.set(principal.extensionId, { signature, dispose })
  }

  private expandPrincipalForProviderId(principal: ExtensionPrincipal, providerId: string): ExtensionPrincipal {
    const registration = [...this.providers.values()].find((entry) =>
      entry.extensionId === principal.extensionId &&
      (entry.providerId === providerId || entry.localId === providerId)
    )
    return registration
      ? expandProviderPermissions(principal, registration.localId, registration.providerId)
      : principal
  }

  private resolveProviderId(principal: ExtensionPrincipal, providerId: string): string {
    return [...this.providers.values()].find((entry) =>
      entry.extensionId === principal.extensionId &&
      (entry.providerId === providerId || entry.localId === providerId)
    )?.providerId ?? providerId
  }

  private expandPrincipalForAllProviders(principal: ExtensionPrincipal): ExtensionPrincipal {
    let expanded = principal
    for (const registration of this.providers.values()) {
      if (registration.extensionId === principal.extensionId) {
        expanded = expandProviderPermissions(expanded, registration.localId, registration.providerId)
      }
    }
    return expanded
  }

  private principalWithProviderPermissions(
    extensionId: string,
    permissions: readonly string[],
    providerId: string
  ): ExtensionPrincipal {
    return {
      extensionId,
      extensionVersion: 'unknown',
      permissions: [...permissions],
      workspaceRoots: [],
      workspaceTrusted: false
    }
  }
}

/** Fast pre-gate for fixed permissions. Dynamic account/network scopes are checked by the broker. */
export function requiredExtensionBrokerPermission(method: string, params: JsonValue): string | undefined {
  if (method.startsWith('commands.')) return 'commands.register'
  if (method.startsWith('agent.')) return 'agent.run'
  if (method.startsWith('threads.')) return 'agent.threads.readOwn'
  if (method.startsWith('tools.')) return 'tools.register'
  if (method.startsWith('modelProviders.')) return 'providers.register'
  if (method === 'authentication.listAccounts') return 'accounts.read'
  if (method === 'workspace.writeFile') return 'workspace.write'
  if (method.startsWith('workspace.')) return 'workspace.read'
  if (method === 'media.pickSaveTarget') return 'media.export'
  if (method === 'media.startArchiveJob') return 'media.export'
  if (method === 'media.createCacheTarget') return 'media.process'
  if (
    method === 'media.getCapabilities' ||
    method === 'media.getAudioAnalysisCapabilities' ||
    method === 'media.getVisualModelStatus' ||
    method === 'media.installVisualModel' ||
    method === 'media.analyzeVisualFrames' ||
    method === 'media.embedVisualQuery' ||
    method === 'media.probe' ||
    method === 'media.startFfmpegJob' ||
    method === 'media.startAudioAnalysisJob'
  ) return 'media.process'
  if (
    method === 'media.pickFiles' ||
    method === 'media.stat' ||
    method === 'media.readText' ||
    method === 'media.openViewResource' ||
    method === 'media.performArtifactAction'
  ) {
    return 'media.read'
  }
  if (method.startsWith('jobs.')) return 'jobs.manage'
  if (method.startsWith('storage.global')) return 'storage.global'
  if (method.startsWith('storage.workspace')) return 'storage.workspace'
  if (method.startsWith('storage.')) {
    const scope = isObject(params) && params.scope === 'global' ? 'global' : 'workspace'
    return `storage.${scope}`
  }
  if (method.startsWith('configuration.')) return 'ui.actions'
  if (method === 'ui.showNotification') return 'ui.notifications'
  if (method === 'ui.attachComposerContext') return 'ui.actions'
  if (method.startsWith('ui.')) return 'ui.views'
  return undefined
}

function publicMediaMetadata(
  handle: MediaHandleProjection,
  includeWorkspaceLocation = true
) {
  const kind = handle.mimeType.startsWith('video/')
    ? 'video'
    : handle.mimeType.startsWith('audio/')
      ? 'audio'
      : handle.mimeType.startsWith('image/')
        ? 'image'
        : handle.mimeType === 'text/vtt' || handle.mimeType === 'application/x-subrip'
          ? 'subtitle'
          : handle.mimeType === 'application/octet-stream'
            ? 'unknown'
            : 'data'
  return MediaMetadataSchema.parse({
    handleId: handle.id,
    mode: handle.mode === 'write' ? 'export' : 'read',
    kind,
    displayName: handle.displayName,
    mimeType: handle.mimeType,
    ...(handle.byteSize !== undefined ? { byteSize: handle.byteSize } : {}),
    ...(handle.modifiedAt ? { modifiedAt: handle.modifiedAt } : {}),
    ...(handle.mode === 'read' && handle.lastAccessedAt
      ? { lastAccessedAt: handle.lastAccessedAt }
      : {}),
    ...(handle.completionIdentity ? { completionIdentity: handle.completionIdentity } : {}),
    ...(includeWorkspaceLocation && handle.workspaceRelativePath
      ? { workspaceRelativeDisplayLocation: handle.workspaceRelativePath }
      : {}),
    revoked: !handle.available
  })
}

function cacheFormat(format: 'png' | 'jpeg' | 'mp4' | 'webm' | 'wav'): {
  extension: string
  mimeType: string
} {
  switch (format) {
    case 'png': return { extension: 'png', mimeType: 'image/png' }
    case 'jpeg': return { extension: 'jpg', mimeType: 'image/jpeg' }
    case 'mp4': return { extension: 'mp4', mimeType: 'video/mp4' }
    case 'webm': return { extension: 'webm', mimeType: 'video/webm' }
    case 'wav': return { extension: 'wav', mimeType: 'audio/wav' }
  }
}

function publicMediaCapability(capability: {
  name: 'ffprobe' | 'ffmpeg'
  available: boolean
  version?: string
  features?: string[]
}) {
  return {
    name: capability.name,
    available: capability.available,
    ...(capability.version ? { version: capability.version.slice(0, 512) } : {}),
    features: capability.features ?? []
  }
}

function jobCaller(principal: ExtensionPrincipal) {
  return {
    extensionId: principal.extensionId,
    workspaceIds: principal.workspaceRoots.map(extensionWorkspaceKey)
  }
}

function hostOwnsRegistration(
  principal: ExtensionPrincipal,
  entry: { extensionId: string; hostLifecycleNonce?: string } | undefined
): boolean {
  return Boolean(
    entry &&
    principal.hostLifecycleNonce &&
    entry.extensionId === principal.extensionId &&
    entry.hostLifecycleNonce === principal.hostLifecycleNonce
  )
}

function registrationOwnedByPrincipal(
  entry: {
    extensionId: string
    hostLifecycleNonce?: string
    viewSessionId?: string
  } | undefined,
  principal: ExtensionPrincipal
): boolean {
  if (!entry || entry.extensionId !== principal.extensionId) return false
  if (principal.viewSessionId !== undefined) {
    return entry.viewSessionId === principal.viewSessionId
  }
  return hostOwnsRegistration(principal, entry)
}

function normalizedRegistrationWorkspaceRoots(workspaceRoots: readonly string[]): string[] {
  return [...new Set(workspaceRoots.map((root) => resolve(root)))].sort()
}

function registrationIncludesWorkspace(
  entry: { workspaceRoots: readonly string[] },
  workspaceId: string
): boolean {
  return entry.workspaceRoots.some((root) => extensionWorkspaceKey(root) === workspaceId)
}

function sameRegistrationWorkspace(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const normalizedLeft = normalizedRegistrationWorkspaceRoots(left)
  const normalizedRight = normalizedRegistrationWorkspaceRoots(right)
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((root, index) => root === normalizedRight[index])
}

function hostPrincipal(input: HostExtensionPrincipal): ExtensionPrincipal {
  return {
    extensionId: input.extensionId,
    extensionVersion: input.version,
    permissions: [...input.grantedPermissions],
    workspaceRoots: [...input.workspaceRoots],
    workspaceTrusted: input.workspaceRoots.length > 0,
    hostLifecycleNonce: input.lifecycleNonce
  }
}

function publicAgentRun(run: ExtensionAgentRun): AgentRun {
  const providerBinding = run.providerBinding.accountId
    ? ProviderBindingSchema.parse({ ...run.providerBinding, accountId: run.providerBinding.accountId })
    : undefined
  return AgentRunSchema.parse({
    id: run.id,
    threadId: run.threadId,
    ownerExtensionId: run.ownerExtensionId,
    ownerExtensionVersion: run.ownerExtensionVersion,
    ...(run.providerBinding.accountId ? { accountId: run.providerBinding.accountId } : {}),
    extensionVisibility: run.visibility,
    ...(run.profile ? {
      extensionProfile: {
        id: run.profile.id,
        instructionDigest: run.profile.instructionDigest,
        ...(providerBinding ? { providerBinding } : {}),
        allowedTools: run.profile.allowedToolScopes,
        budget: publicBudget(run.effectiveBudget)
      }
    } : {}),
    extensionBudget: publicBudget(run.effectiveBudget),
    toolCatalogEpoch: run.toolCatalogEpoch?.id ?? 'epoch:none',
    state: publicRunState(run.status),
    ...(providerBinding ? { providerBinding } : {}),
    ...(run.usage ? { usage: publicUsage(run.usage) } : {}),
    createdAt: run.createdAt,
    updatedAt: run.finishedAt ?? run.createdAt,
    ...(run.finishedAt ? { terminalAt: run.finishedAt } : {}),
    ...(run.error ? { error: { code: 'agent_run_failed', message: run.error.slice(0, 4096) } } : {})
  })
}

function publicAgentEvent(event: ExtensionAgentEvent): AgentRunEvent {
  const base = {
    runId: event.runId,
    threadId: event.threadId,
    sequence: event.seq + 1,
    timestamp: event.timestamp
  }
  if (event.type === 'turn_started') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'running' })
  if (event.type === 'approval_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-approval' })
  if (event.type === 'user_input_requested') return AgentRunEventSchema.parse({ ...base, type: 'state', state: 'waiting-user-input' })
  if (event.type === 'turn_completed') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'completed' })
  if (event.type === 'turn_aborted') return AgentRunEventSchema.parse({ ...base, type: 'terminal', state: 'cancelled' })
  if (event.type === 'turn_failed') return AgentRunEventSchema.parse({
    ...base, type: 'terminal', state: 'failed', error: safeJsonObject(event.payload)
  })
  if (event.type === 'usage') {
    const usage = isObject(event.payload.usage) ? publicUsage(event.payload.usage as never) : {}
    return AgentRunEventSchema.parse({ ...base, type: 'usage', usage })
  }
  if (event.type === 'turn_steered') return AgentRunEventSchema.parse({
    ...base, type: 'steering-accepted', steeringId: `steer_${event.seq}`
  })
  if (event.type === 'assistant_text_delta' || event.type === 'item_completed') {
    return AgentRunEventSchema.parse({
      ...base, type: 'message', role: 'assistant', content: toPublicJson(event.payload)
    })
  }
  return AgentRunEventSchema.parse({
    ...base,
    type: 'progress',
    message: event.type,
    data: toPublicJson(event.payload)
  })
}

function publicOwnedThread(principal: ExtensionPrincipal, thread: ExtensionOwnedThread) {
  return {
    id: thread.id,
    title: thread.title,
    ownerExtensionId: principal.extensionId,
    ownerExtensionVersion: thread.ownerExtensionVersion,
    extensionVisibility: thread.visibility,
    workspace: thread.workspace,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}

function publicBudget(budget: ExtensionAgentRun['effectiveBudget']) {
  return {
    maxTokens: budget.maxTokens,
    maxElapsedMs: budget.maxElapsedMs,
    maxModelRequests: budget.maxModelRequests,
    maxToolInvocations: budget.maxToolInvocations,
    maxEvents: budget.maxRetainedEvents
  }
}

function publicUsage(usage: {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  costCny?: number
  costByCurrency?: Record<string, number>
}) {
  const reportedCosts = usage.costByCurrency ?? (
    usage.costUsd !== undefined ? { USD: usage.costUsd } :
      usage.costCny !== undefined ? { CNY: usage.costCny } : {}
  )
  const costEntries = Object.entries(reportedCosts)
  return {
    ...(usage.promptTokens !== undefined ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.cachedTokens !== undefined ? { cacheReadTokens: usage.cachedTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(costEntries.length === 1
      ? { cost: costEntries[0]![1], currency: costEntries[0]![0] }
      : {})
  }
}

function publicRunState(status: ExtensionAgentRun['status']) {
  if (status === 'cancelled') return 'cancelled' as const
  if (status === 'budget-exhausted') return 'budget-exhausted' as const
  return status
}

function publicAccount(account: {
  id: string
  providerId: string
  label: string
  authType: 'api-key' | 'oauth-pkce' | 'oauth-device'
  status: string
  metadata: Record<string, string | number | boolean | null>
  createdAt: string
  updatedAt: string
  expiresAt?: string
}, protection: Account['protection'] | undefined): Account {
  return {
    id: account.id,
    providerId: account.providerId,
    label: account.label,
    authenticationType: account.authType === 'oauth-pkce'
      ? 'oauth2-pkce'
      : account.authType === 'oauth-device' ? 'device-code' : 'api-key',
    status: account.status as Account['status'],
    metadata: account.metadata,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
    ...(protection ? { protection } : {})
  }
}

function publicAccountSession(
  session: StoredAccountSession,
  exposeInteractiveMaterial = false
): AccountSession {
  const {
    extensionId: _extensionId,
    lastTouchedAt: _lastTouchedAt,
    transactionId: _transactionId,
    providerId: _providerId,
    kind: _kind,
    ...value
  } = session
  if (exposeInteractiveMaterial && session.status === 'pending') return structuredClone(value)
  const {
    verificationUrl: _verificationUrl,
    userCode: _userCode,
    ...redacted
  } = value
  if (session.status === 'pending') {
    redacted.message = 'Interaction required. Continue in Kun Settings > Extensions > Provider accounts.'
  }
  return structuredClone(redacted)
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Account authorization failed').slice(0, 4_096)
}

function providerCapabilities(declaration: z.infer<typeof ModelProviderDeclarationSchema>) {
  const models = declaration.models
  return {
    streaming: models.length === 0 || models.some((model) => model.capabilities.streaming),
    toolCalls: models.some((model) => model.capabilities.tools),
    reasoning: models.some((model) => model.capabilities.reasoning),
    images: models.some((model) => model.capabilities.input.includes('image')),
    documents: models.some((model) => model.capabilities.input.includes('file')),
    tokenCounting: false
  }
}

function resolveAuthentication(
  manifest: ExtensionManifest | undefined,
  localId: string | undefined
): AuthenticationProviderDeclaration | undefined {
  if (!localId) return undefined
  const declaration = manifest?.contributes.authentication.find((entry) => entry.id === localId)
  if (!declaration) throw new Error(`authentication contribution is not declared: ${localId}`)
  return declaration
}

function effectiveAuthenticationScopes(
  declared: readonly string[],
  requested: readonly string[] | undefined
): string[] {
  const effective = [...new Set(requested ?? declared)]
  if (effective.some((scope) => !declared.includes(scope))) {
    throw new Error('requested authentication scope is not declared by the provider')
  }
  return effective
}

function internalAuthenticationType(type: AuthenticationProviderDeclaration['type'] | undefined) {
  if (type === 'oauth2-pkce') return 'oauth-pkce' as const
  if (type === 'device-code') return 'oauth-device' as const
  return 'api-key' as const
}

function toolSideEffect(value: z.infer<typeof ExtensionToolDeclarationSchema>['sideEffects']) {
  switch (value) {
    case 'read': return 'workspace-read' as const
    case 'write': return 'workspace-write' as const
    case 'external':
    case 'destructive': return 'external' as const
    default: return 'none' as const
  }
}

function activationEventFor(manifest: ExtensionManifest | undefined, preferred: string): string {
  const events = manifest?.activationEvents ?? []
  if (events.includes(preferred)) return preferred
  if (events.includes('onStartup')) return 'onStartup'
  throw new Error(`extension has no declared activation event for ${preferred}`)
}

function requireManifestContribution<T extends { id: string }>(
  entries: readonly T[] | undefined,
  id: string,
  kind: string
): T {
  const entry = entries?.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`${kind} is not declared in the active manifest: ${id}`)
  return structuredClone(entry)
}

function assertManifestDeclarationMatches(
  requested: unknown,
  declared: unknown,
  kind: string
): void {
  if (JSON.stringify(canonicalizeJson(requested)) !== JSON.stringify(canonicalizeJson(declared))) {
    throw new Error(`${kind} registration does not match its active manifest declaration`)
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeJson(child)])
  )
}

function expandProviderPermissions(
  principal: ExtensionPrincipal,
  localId: string,
  providerId: string
): ExtensionPrincipal {
  const permissions = new Set(principal.permissions)
  for (const operation of ['use', 'manage'] as const) {
    if (permissions.has(`accounts.${operation}:${localId}`)) {
      permissions.add(`accounts.${operation}:${providerId}`)
    }
  }
  if (permissions.has(`accounts.secrets.read:${localId}`)) {
    permissions.add(`accounts.secrets.read:${providerId}`)
  }
  return { ...principal, permissions: [...permissions] }
}

function requiredWorkspaceKey(principal: ExtensionPrincipal): string {
  const root = principal.workspaceRoots[0]
  if (!root) throw new Error('workspace-scoped operation requires an active granted workspace')
  // Matches ExtensionPaths.workspaceKey without coupling persisted state to a path.
  return createHash('sha256').update(resolve(root)).digest('hex')
}

function viewStateKey(principal: ExtensionPrincipal): string {
  return `__kun_view_state__:${principal.viewContributionId ?? 'default'}`
}

async function confinedWorkspacePath(
  principal: ExtensionPrincipal,
  requested: string,
  forWrite: boolean
): Promise<string> {
  if (isAbsolute(requested)) {
    for (const root of principal.workspaceRoots) {
      if (inside(root, requested)) return verifyWorkspaceTarget(root, requested, forWrite)
    }
    throw new Error('workspace path is outside granted roots')
  }
  const root = principal.workspaceRoots[0]
  if (!root) throw new Error('workspace path requires a granted root')
  return verifyWorkspaceTarget(root, resolve(root, requested), forWrite)
}

async function verifyWorkspaceTarget(rootInput: string, targetInput: string, forWrite: boolean): Promise<string> {
  const root = await realpath(rootInput)
  const target = resolve(targetInput)
  if (!inside(root, target)) throw new Error('workspace path escapes the granted root')
  if (!forWrite) {
    const resolved = await realpath(target)
    if (!inside(root, resolved)) throw new Error('workspace symlink escapes the granted root')
    return resolved
  }
  const parent = await realpath(resolve(target, '..'))
  if (!inside(root, parent)) throw new Error('workspace write parent escapes the granted root')
  const existing = await realpath(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
    throw error
  })
  if (existing && !inside(root, existing)) throw new Error('workspace write symlink escapes the granted root')
  return target
}

function inside(rootInput: string, targetInput: string): boolean {
  const root = resolve(rootInput)
  const target = resolve(targetInput)
  const child = relative(root, target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function assertNetworkPermission(principal: ExtensionPrincipal, hostnameInput: string): void {
  const hostname = hostnameInput.toLowerCase()
  const allowed = principal.permissions.some((permission) => {
    if (!permission.startsWith('network:')) return false
    const pattern = permission.slice('network:'.length).toLowerCase()
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return hostname.endsWith(suffix) && hostname !== pattern.slice(2)
    }
    return hostname === pattern
  })
  if (!allowed) throw new Error(`Missing network permission for ${hostname}`)
}

async function responseProjection(response: Response) {
  const maximum = 8 * 1024 * 1024
  const { content, truncated } = await readBoundedResponseBody(response, maximum)
  const contentType = response.headers.get('content-type') ?? ''
  const text = /^text\/|json|xml|javascript/i.test(contentType)
  const headers = new Headers(response.headers)
  for (const name of [
    'authorization', 'proxy-authorization', 'proxy-authenticate',
    'cookie', 'set-cookie', 'x-api-key'
  ]) headers.delete(name)
  return {
    status: response.status,
    headers: Object.fromEntries(headers.entries()),
    body: text ? content.toString('utf8') : content.toString('base64'),
    bodyEncoding: text ? 'utf8' : 'base64',
    truncated
  }
}

async function readBoundedResponseBody(
  response: Response,
  maximum: number
): Promise<{ content: Buffer; truncated: boolean }> {
  if (!response.body) return { content: Buffer.alloc(0), truncated: false }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let retained = 0
  let truncated = false
  try {
    while (retained <= maximum) {
      const next = await reader.read()
      if (next.done) break
      const value = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength)
      const remaining = maximum - retained
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining))
        retained = maximum
        truncated = true
        break
      }
      chunks.push(value)
      retained += value.byteLength
      if (retained === maximum) {
        const probe = await reader.read()
        if (!probe.done) truncated = true
        break
      }
    }
  } finally {
    if (truncated) await reader.cancel('Kun response limit reached').catch(() => undefined)
    reader.releaseLock()
  }
  return { content: Buffer.concat(chunks, retained), truncated }
}

function linkedAbortController(signal: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = timeoutMs ? setTimeout(() => controller.abort(new Error('request timed out')), timeoutMs) : undefined
  timer?.unref?.()
  return Object.assign(controller, {
    dispose() {
      signal.removeEventListener('abort', abort)
      if (timer) clearTimeout(timer)
    }
  })
}

function agentInputText(input: z.infer<typeof AgentCreateRunRequestSchema>['input']): string {
  if (typeof input === 'string') return input
  return input.content.map((part) => {
    if (part.type === 'text') return part.text
    return `[${part.type}${'name' in part && part.name ? `: ${part.name}` : ''}; ${part.mimeType}]`
  }).join('\n')
}

function cancellationSignal(token: { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): { dispose(): void } }): AbortSignal {
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort()
  else token.onCancellationRequested(() => controller.abort())
  return controller.signal
}

function providerStreamKey(registrationId: string, requestId: string): string {
  return `${registrationId}:${requestId}`
}

function providerQueueLimitError(entry: ProviderStreamEntry): Error {
  return new Error(`extension provider stream queue limit exceeded: ${entry.requestId}`)
}

function serializedQueueBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function positiveQueueLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('provider stream queue limit must be positive')
  return value
}

function safeJsonObject(value: unknown): Record<string, PublicJsonValue> {
  const parsed = toPublicJson(value)
  return isObject(parsed) ? parsed as Record<string, PublicJsonValue> : { value: parsed }
}

function toPublicJson(value: unknown): PublicJsonValue {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value ?? null)))
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: Array<{
    value: T
    bytes: number
    accepted?: (accepted: boolean) => void
  }> = []
  private readonly waiters: Array<{ resolve(value: IteratorResult<T>): void; reject(error: unknown): void }> = []
  private bufferedBytes = 0
  private terminal = false
  private error: unknown

  constructor(private readonly options: {
    maximumItems: number
    maximumBytes: number
    sizeOf(value: T): number
  }) {}

  pushLegacy(value: T): boolean {
    return this.enqueue(value)
  }

  pushBackpressured(value: T): Promise<boolean> {
    if (this.terminal) return Promise.resolve(false)
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return Promise.resolve(true)
    }
    const bytes = this.options.sizeOf(value)
    if (!this.hasCapacity(bytes)) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.values.push({ value, bytes, accepted: resolve })
      this.bufferedBytes += bytes
    })
  }

  end(): void {
    if (this.terminal) return
    this.terminal = true
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
  }

  fail(error: unknown): void {
    if (this.terminal) return
    this.terminal = true
    this.error = error
    for (const entry of this.values.splice(0)) entry.accepted?.(false)
    this.bufferedBytes = 0
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  close(): void {
    if (this.terminal && this.values.length === 0) return
    this.terminal = true
    for (const entry of this.values.splice(0)) entry.accepted?.(false)
    this.bufferedBytes = 0
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const entry = this.values.shift()
        if (entry !== undefined) {
          this.bufferedBytes -= entry.bytes
          entry.accepted?.(true)
          return Promise.resolve({ value: entry.value, done: false })
        }
        if (this.error !== undefined) return Promise.reject(this.error)
        if (this.terminal) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
      },
      return: async () => {
        this.close()
        return { value: undefined, done: true }
      }
    }
  }

  private enqueue(value: T): boolean {
    if (this.terminal) return false
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return true
    }
    const bytes = this.options.sizeOf(value)
    if (!this.hasCapacity(bytes)) return false
    this.values.push({ value, bytes })
    this.bufferedBytes += bytes
    return true
  }

  private hasCapacity(bytes: number): boolean {
    return this.values.length < this.options.maximumItems &&
      this.bufferedBytes + bytes <= this.options.maximumBytes
  }
}
