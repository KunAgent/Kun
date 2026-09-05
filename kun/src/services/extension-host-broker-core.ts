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
import { installServiceOperations } from './service-operation-install.js'
import { extensionHostBrokerDispatchLifecycleOperations } from './extension-host-broker-dispatch-lifecycle-operations.js'
import { extensionHostBrokerMediaOperations } from './extension-host-broker-media-operations.js'
import { extensionHostBrokerJobsUiStorageOperations } from './extension-host-broker-jobs-ui-storage-operations.js'
import { extensionHostBrokerAgentsOperations } from './extension-host-broker-agents-operations.js'
import { extensionHostBrokerProvidersOperations } from './extension-host-broker-providers-operations.js'
import { extensionHostBrokerAccountsOperations } from './extension-host-broker-accounts-operations.js'
import { extensionHostBrokerWorkspacePrincipalOperations } from './extension-host-broker-workspace-principal-operations.js'
import type { ExtensionHostBrokerOperations } from './extension-host-broker-operations-contract.js'
import type { AsyncEventQueue } from './extension-host-broker-stream-support.js'
export { requiredExtensionBrokerPermission, publicMediaMetadata, cacheFormat, publicMediaCapability, jobCaller, hostOwnsRegistration, registrationOwnedByPrincipal, normalizedRegistrationWorkspaceRoots, registrationIncludesWorkspace, sameRegistrationWorkspace, publicAgentRun, publicAgentEvent, publicOwnedThread, publicBudget, publicUsage, publicRunState, publicAccount, publicAccountSession } from './extension-host-broker-public-projection.js'
export { boundedError, providerCapabilities, resolveAuthentication, effectiveAuthenticationScopes, internalAuthenticationType, toolSideEffect, activationEventFor, requireManifestContribution, assertManifestDeclarationMatches, canonicalizeJson, expandProviderPermissions, requiredWorkspaceKey, viewStateKey, confinedWorkspacePath, verifyWorkspaceTarget, inside, assertNetworkPermission, responseProjection, readBoundedResponseBody, linkedAbortController, agentInputText, cancellationSignal, serializedQueueBytes, safeJsonObject, toPublicJson } from './extension-host-broker-registration-network.js'
export { isObject, AsyncEventQueue } from './extension-host-broker-stream-support.js'

export const RegistrationIdSchema = z.string().min(1).max(256)
export const RegistrationRequestSchema = z.strictObject({ registrationId: RegistrationIdSchema })
export const RunIdSchema = z.strictObject({ runId: z.string().min(1).max(256) })
export const ThreadIdSchema = z.strictObject({ threadId: z.string().min(1).max(256) })
export const SubscriptionIdSchema = z.strictObject({ subscriptionId: RegistrationIdSchema })
export const StorageRequestSchema = z.strictObject({
  scope: z.enum(['global', 'workspace']),
  key: z.string().min(1).max(256)
})
export const StorageKeysRequestSchema = z.strictObject({ scope: z.enum(['global', 'workspace']) })
export const StorageSetRequestSchema = StorageRequestSchema.extend({ value: JsonValueSchema }).strict()
export const SecretRequestSchema = z.strictObject({
  key: z.string().min(1).max(128)
})
export const SecretSetRequestSchema = SecretRequestSchema.extend({
  value: z.string().min(1).max(16 * 1024)
}).strict()
export const ConfigurationSectionSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const ConfigurationRequestSchema = z.strictObject({
  sectionId: ConfigurationSectionSchema,
  key: z.string().min(1).max(256)
})
export const ConfigurationUpdateRequestSchema = ConfigurationRequestSchema.extend({
  value: JsonValueSchema
}).strict()
export const CommandRegisterSchema = z.strictObject({ id: z.string().min(1).max(64) })
export const CommandExecuteSchema = z.strictObject({
  id: z.string().min(1).max(256),
  args: JsonValueSchema.optional()
})
export const ModelStreamNotificationSchema = z.strictObject({
  registrationId: RegistrationIdSchema,
  event: ModelProviderStreamEventSchema
})
export const ModelStreamEnvelopePayloadSchema = z.discriminatedUnion('kind', [
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

export type ToolRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  activationEvent: string
  dispose(): void
}

export type ProviderRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  providerId: string
  activationEvent: string
  dispose(): Promise<void>
}

export type AgentSubscription = {
  extensionId: string
  hostLifecycleNonce?: string
  viewSessionId?: string
  workspaceRoots: readonly string[]
  subscription: ExtensionAgentSubscription
}

export type JobSubscription = {
  extensionId: string
  hostLifecycleNonce?: string
  viewSessionId?: string
  workspaceRoots: readonly string[]
  subscription: ExtensionJobSubscription
}

export type CommandRegistration = {
  extensionId: string
  hostLifecycleNonce?: string
  workspaceRoots: readonly string[]
  localId: string
  activationEvent: string
  contribution: CommandContribution
  inputValidator?: ExtensionJsonSchemaValidator
  outputValidator?: ExtensionJsonSchemaValidator
}

export type StoredAccountSession = AccountSession & {
  extensionId: string
  workspaceRoots: readonly string[]
  lastTouchedAt: number
  transactionId?: string
  providerId?: string
  kind?: 'oauth-pkce' | 'oauth-device' | 'api-key'
}

export type ExtensionBrokerDispatchRequest = Pick<
  ExtensionBrokerRequest,
  'method' | 'params' | 'signal' | 'requestId'
>

export type ProviderStreamEntry = {
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
  declare private failProviderStream: (typeof extensionHostBrokerDispatchLifecycleOperations)['failProviderStream']
  declare private dispatch: (typeof extensionHostBrokerDispatchLifecycleOperations)['dispatch']
  declare private mediaPickFiles: (typeof extensionHostBrokerMediaOperations)['mediaPickFiles']
  declare private mediaPickSaveTarget: (typeof extensionHostBrokerMediaOperations)['mediaPickSaveTarget']
  declare private mediaCreateCacheTarget: (typeof extensionHostBrokerMediaOperations)['mediaCreateCacheTarget']
  declare private mediaStat: (typeof extensionHostBrokerMediaOperations)['mediaStat']
  declare private mediaReadText: (typeof extensionHostBrokerMediaOperations)['mediaReadText']
  declare private mediaRelease: (typeof extensionHostBrokerMediaOperations)['mediaRelease']
  declare private mediaOpenViewResource: (typeof extensionHostBrokerMediaOperations)['mediaOpenViewResource']
  declare private mediaPerformArtifactAction: (typeof extensionHostBrokerMediaOperations)['mediaPerformArtifactAction']
  declare private mediaGetCapabilities: (typeof extensionHostBrokerMediaOperations)['mediaGetCapabilities']
  declare private mediaGetAudioAnalysisCapabilities: (typeof extensionHostBrokerMediaOperations)['mediaGetAudioAnalysisCapabilities']
  declare private mediaGetVisualModelStatus: (typeof extensionHostBrokerMediaOperations)['mediaGetVisualModelStatus']
  declare private mediaInstallVisualModel: (typeof extensionHostBrokerMediaOperations)['mediaInstallVisualModel']
  declare private mediaAnalyzeVisualFrames: (typeof extensionHostBrokerMediaOperations)['mediaAnalyzeVisualFrames']
  declare private mediaEmbedVisualQuery: (typeof extensionHostBrokerMediaOperations)['mediaEmbedVisualQuery']
  declare private mediaProbe: (typeof extensionHostBrokerMediaOperations)['mediaProbe']
  declare private mediaStartFfmpegJob: (typeof extensionHostBrokerMediaOperations)['mediaStartFfmpegJob']
  declare private mediaStartAudioAnalysisJob: (typeof extensionHostBrokerMediaOperations)['mediaStartAudioAnalysisJob']
  declare private mediaStartArchiveJob: (typeof extensionHostBrokerMediaOperations)['mediaStartArchiveJob']
  declare private jobsGet: (typeof extensionHostBrokerJobsUiStorageOperations)['jobsGet']
  declare private jobsList: (typeof extensionHostBrokerJobsUiStorageOperations)['jobsList']
  declare private jobsSubscribe: (typeof extensionHostBrokerJobsUiStorageOperations)['jobsSubscribe']
  declare private jobsUnsubscribe: (typeof extensionHostBrokerJobsUiStorageOperations)['jobsUnsubscribe']
  declare private jobsCancel: (typeof extensionHostBrokerJobsUiStorageOperations)['jobsCancel']
  declare private requireJobs: (typeof extensionHostBrokerJobsUiStorageOperations)['requireJobs']
  declare private pumpJobSubscription: (typeof extensionHostBrokerJobsUiStorageOperations)['pumpJobSubscription']
  declare private requireUiOperation: (typeof extensionHostBrokerJobsUiStorageOperations)['requireUiOperation']
  declare private registerCommand: (typeof extensionHostBrokerJobsUiStorageOperations)['registerCommand']
  declare private unregisterCommand: (typeof extensionHostBrokerJobsUiStorageOperations)['unregisterCommand']
  declare private executeCommand: (typeof extensionHostBrokerJobsUiStorageOperations)['executeCommand']
  declare private storage: (typeof extensionHostBrokerJobsUiStorageOperations)['storage']
  declare private secrets: (typeof extensionHostBrokerJobsUiStorageOperations)['secrets']
  declare private configuration: (typeof extensionHostBrokerJobsUiStorageOperations)['configuration']
  declare private viewStateGet: (typeof extensionHostBrokerJobsUiStorageOperations)['viewStateGet']
  declare private viewStateSet: (typeof extensionHostBrokerJobsUiStorageOperations)['viewStateSet']
  declare private networkFetch: (typeof extensionHostBrokerJobsUiStorageOperations)['networkFetch']
  declare private agentGetRunOptions: (typeof extensionHostBrokerAgentsOperations)['agentGetRunOptions']
  declare private agentCreateRun: (typeof extensionHostBrokerAgentsOperations)['agentCreateRun']
  declare private agentGetRun: (typeof extensionHostBrokerAgentsOperations)['agentGetRun']
  declare private agentListRunEvents: (typeof extensionHostBrokerAgentsOperations)['agentListRunEvents']
  declare private agentSubscribe: (typeof extensionHostBrokerAgentsOperations)['agentSubscribe']
  declare private agentUnsubscribe: (typeof extensionHostBrokerAgentsOperations)['agentUnsubscribe']
  declare private agentSteer: (typeof extensionHostBrokerAgentsOperations)['agentSteer']
  declare private agentCancel: (typeof extensionHostBrokerAgentsOperations)['agentCancel']
  declare private threadsListOwn: (typeof extensionHostBrokerAgentsOperations)['threadsListOwn']
  declare private threadsGetOwn: (typeof extensionHostBrokerAgentsOperations)['threadsGetOwn']
  declare private registerTool: (typeof extensionHostBrokerProvidersOperations)['registerTool']
  declare private unregisterTool: (typeof extensionHostBrokerProvidersOperations)['unregisterTool']
  declare private registerProvider: (typeof extensionHostBrokerProvidersOperations)['registerProvider']
  declare private unregisterProvider: (typeof extensionHostBrokerProvidersOperations)['unregisterProvider']
  declare private providerStatus: (typeof extensionHostBrokerProvidersOperations)['providerStatus']
  declare private remoteProviderAdapter: (typeof extensionHostBrokerProvidersOperations)['remoteProviderAdapter']
  declare private remoteProviderStream: (typeof extensionHostBrokerProvidersOperations)['remoteProviderStream']
  declare private listAccounts: (typeof extensionHostBrokerAccountsOperations)['listAccounts']
  declare private createAccountSession: (typeof extensionHostBrokerAccountsOperations)['createAccountSession']
  declare private publicCredentialProtection: (typeof extensionHostBrokerAccountsOperations)['publicCredentialProtection']
  declare private getAccountSession: (typeof extensionHostBrokerAccountsOperations)['getAccountSession']
  declare private cancelAccountSession: (typeof extensionHostBrokerAccountsOperations)['cancelAccountSession']
  declare private pruneAccountSessions: (typeof extensionHostBrokerAccountsOperations)['pruneAccountSessions']
  declare private deleteAccount: (typeof extensionHostBrokerAccountsOperations)['deleteAccount']
  declare private authenticatedFetch: (typeof extensionHostBrokerAccountsOperations)['authenticatedFetch']
  declare private revealSecret: (typeof extensionHostBrokerAccountsOperations)['revealSecret']
  declare private workspace: (typeof extensionHostBrokerWorkspacePrincipalOperations)['workspace']
  declare private expandPrincipalForBinding: (typeof extensionHostBrokerWorkspacePrincipalOperations)['expandPrincipalForBinding']
  declare private ensureProfiles: (typeof extensionHostBrokerWorkspacePrincipalOperations)['ensureProfiles']
  declare private expandPrincipalForProviderId: (typeof extensionHostBrokerWorkspacePrincipalOperations)['expandPrincipalForProviderId']
  declare private resolveProviderId: (typeof extensionHostBrokerWorkspacePrincipalOperations)['resolveProviderId']
  declare private expandPrincipalForAllProviders: (typeof extensionHostBrokerWorkspacePrincipalOperations)['expandPrincipalForAllProviders']
  declare private principalWithProviderPermissions: (typeof extensionHostBrokerWorkspacePrincipalOperations)['principalWithProviderPermissions']

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
}

export interface ExtensionHostBroker extends ExtensionHostBrokerOperations {}

installServiceOperations(
  ExtensionHostBroker.prototype,
  extensionHostBrokerDispatchLifecycleOperations,
  extensionHostBrokerMediaOperations,
  extensionHostBrokerJobsUiStorageOperations,
  extensionHostBrokerAgentsOperations,
  extensionHostBrokerProvidersOperations,
  extensionHostBrokerAccountsOperations,
  extensionHostBrokerWorkspacePrincipalOperations
)

export function hostPrincipal(input: HostExtensionPrincipal): ExtensionPrincipal {
  return {
    extensionId: input.extensionId,
    extensionVersion: input.version,
    permissions: [...input.grantedPermissions],
    workspaceRoots: [...input.workspaceRoots],
    workspaceTrusted: input.workspaceRoots.length > 0,
    hostLifecycleNonce: input.lifecycleNonce
  }
}

export function providerStreamKey(registrationId: string, requestId: string): string {
  return `${registrationId}:${requestId}`
}

export function providerQueueLimitError(entry: ProviderStreamEntry): Error {
  return new Error(`extension provider stream queue limit exceeded: ${entry.requestId}`)
}

export function positiveQueueLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('provider stream queue limit must be positive')
  return value
}

export function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}
