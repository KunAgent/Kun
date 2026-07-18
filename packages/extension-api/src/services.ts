import { z } from 'zod'
import type {
  Account,
  AccountSession,
  AuthenticatedFetchRequest,
  CreateAccountSessionRequest,
  ListAccountsRequest,
  RevealSecretRequest
} from './accounts.js'
import type {
  AgentCancelRequest,
  AgentCreateRunRequest,
  AgentCreateRunResponse,
  AgentMutationResult,
  AgentRun,
  AgentRunEvent,
  AgentSubscribeRequest,
  AgentSteerRequest,
  ExtensionThreadProjection,
  ListOwnThreadsRequest,
  ListOwnThreadsResponse
} from './agent.js'
import {
  JsonObjectSchema,
  JsonValueSchema,
  RelativePathSchema,
  type JsonObject,
  type JsonValue
} from './common.js'
import type { Event, Disposable } from './lifecycle.js'
import type {
  ArtifactHostActionRequest,
  ArtifactHostActionResult
} from './artifacts.js'
import type {
  JobCancelRequest,
  JobCancellationResult,
  JobEvent,
  JobListRequest,
  JobPage,
  JobSnapshot,
  JobSubscribeRequest
} from './jobs.js'
import type {
  MediaAudioAnalysisCapabilities,
  MediaAnalyzeVisualFramesRequest,
  MediaAnalyzeVisualFramesResult,
  MediaEmbedVisualQueryRequest,
  MediaEmbedVisualQueryResult,
  MediaInstallVisualModelRequest,
  MediaMetadata,
  MediaCapabilities,
  MediaCreateCacheTargetRequest,
  MediaCreateCacheTargetResult,
  MediaOpenViewResourceRequest,
  MediaPickFilesRequest,
  MediaPickFilesResult,
  MediaPickSaveTargetRequest,
  MediaPickSaveTargetResult,
  MediaProbeRequest,
  MediaProbeResult,
  MediaReadTextRequest,
  MediaReadTextResult,
  MediaReleaseRequest,
  MediaReleaseResult,
  MediaResourceLease,
  MediaStartFfmpegJobRequest,
  MediaStartFfmpegJobResult,
  MediaStartAudioAnalysisJobRequest,
  MediaStartAudioAnalysisJobResult,
  MediaStartArchiveJobRequest,
  MediaStartArchiveJobResult,
  MediaStatRequest,
  MediaVisualModelStatus
} from './media.js'
import type {
  ModelProviderAdapter,
  ModelProviderDeclarationInput,
  ProviderStatus
} from './providers.js'
import type { ExtensionToolDeclarationInput, ExtensionToolHandler } from './tools.js'
import type {
  ComposerContextAttachment,
  ComposerContextAttachmentRequest
} from './composer-context.js'

export interface HostRequestOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface HostRequestContext {
  readonly signal?: AbortSignal
  /**
   * Correlation identifier assigned by the Host for this invocation. The
   * built-in transport always supplies it; custom transports may omit it for
   * compatibility with Extension API v1.0.
   */
  readonly requestId?: string
}

export type HostRequestHandler = (
  params: JsonValue | undefined,
  context: HostRequestContext
) => JsonValue | Promise<JsonValue>

export interface HostNotification {
  readonly method: string
  readonly params?: JsonValue
}

export interface HostTransport extends Disposable {
  request(method: string, params?: JsonValue, options?: HostRequestOptions): Promise<unknown>
  notify(method: string, params?: JsonValue): void | Promise<void>
  /** Send an acknowledgement-backed stream item correlated to one Host request. */
  sendStream?(requestId: string, payload: JsonValue, terminal?: boolean): Promise<void>
  onNotification(listener: (notification: HostNotification) => void): Disposable
  registerHandler(method: string, handler: HostRequestHandler): Disposable
}

export const StorageScopeSchema = z.enum(['global', 'workspace'])
export type StorageScope = z.infer<typeof StorageScopeSchema>

export const StorageEntrySchema = z.strictObject({
  key: z.string().min(1).max(256),
  value: JsonValueSchema,
  revision: z.number().int().nonnegative()
})
export type StorageEntry = z.infer<typeof StorageEntrySchema>

export interface ScopedStorageApi {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>
  set(key: string, value: JsonValue): Promise<void>
  delete(key: string): Promise<boolean>
  keys(): Promise<string[]>
}

export interface StorageApi {
  readonly global: ScopedStorageApi
  readonly workspace: ScopedStorageApi
}

export const ConfigurationChangeEventSchema = z.strictObject({
  sectionId: z.string().min(1).max(64),
  key: z.string().min(1).max(256),
  scope: z.enum(['global', 'workspace']),
  value: JsonValueSchema
})
export type ConfigurationChangeEvent = z.infer<typeof ConfigurationChangeEventSchema>

export interface ConfigurationApi {
  readonly onDidChange: Event<ConfigurationChangeEvent>
  get<T extends JsonValue = JsonValue>(sectionId: string, key: string): Promise<T | undefined>
  update(sectionId: string, key: string, value: JsonValue): Promise<void>
  keys(sectionId: string): Promise<string[]>
}

export const NetworkRequestSchema = z.strictObject({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string().max(8192)).default({}),
  body: z.string().max(8 * 1024 * 1024).optional(),
  bodyEncoding: z.enum(['utf8', 'base64']).default('utf8'),
  timeoutMs: z.number().int().min(1).max(300_000).optional()
})
export type NetworkRequest = z.input<typeof NetworkRequestSchema>

export const NetworkResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  bodyEncoding: z.enum(['utf8', 'base64']),
  truncated: z.boolean().default(false)
})
export type NetworkResponse = z.infer<typeof NetworkResponseSchema>

export const ThemeSchema = z.strictObject({
  kind: z.enum(['light', 'dark', 'high-contrast']),
  tokens: z.record(z.string().min(1).max(128), z.string().max(256)),
  zoomFactor: z.number().positive().default(1),
  reducedMotion: z.boolean().default(false)
})
export type Theme = z.infer<typeof ThemeSchema>

export const LocaleSchema = z.strictObject({
  language: z.string().min(2).max(64),
  direction: z.enum(['ltr', 'rtl']),
  messages: z.record(z.string().min(1).max(256), z.string()).default({})
})
export type Locale = z.infer<typeof LocaleSchema>

export const HostMessageSchema = z.strictObject({
  channel: z.string().min(1).max(128),
  payload: JsonValueSchema,
  sequence: z.number().int().nonnegative().optional()
})
export type HostMessage = z.infer<typeof HostMessageSchema>

export const RESULT_PREVIEW_OPEN_CHANNEL = 'kun.resultPreview.open' as const

export const ResultPreviewSourceSchema = z.strictObject({
  sourceId: z.string().min(1).max(512),
  mimeType: z.string().min(3).max(128).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
  name: z.string().min(1).max(256).optional(),
  attachmentId: z.string().min(1).max(256).optional(),
  artifactId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  mediaHandleId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  relativePath: RelativePathSchema.optional(),
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  width: z.number().int().nonnegative().max(1_000_000).optional(),
  height: z.number().int().nonnegative().max(1_000_000).optional()
})
export type ResultPreviewSource = z.infer<typeof ResultPreviewSourceSchema>

export const ResultPreviewOpenPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  threadId: z.string().min(1).max(256).nullable(),
  turnId: z.string().min(1).max(256).nullable(),
  result: ResultPreviewSourceSchema
})
export type ResultPreviewOpenPayload = z.infer<typeof ResultPreviewOpenPayloadSchema>

export const NotificationOptionsSchema = z.strictObject({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(128),
  message: z.string().min(1).max(4096),
  severity: z.enum(['info', 'warning', 'error']).default('info'),
  actions: z.array(z.strictObject({ id: z.string().min(1).max(64), title: z.string().min(1).max(128) })).max(4).default([])
})
export type NotificationOptions = z.input<typeof NotificationOptionsSchema>

export interface CommandsApi {
  registerCommand(
    id: string,
    handler: (args: JsonValue | undefined) => JsonValue | Promise<JsonValue>
  ): Promise<Disposable>
  executeCommand<TResult extends JsonValue = JsonValue>(id: string, args?: JsonValue): Promise<TResult>
}

export interface NetworkApi {
  fetch(request: NetworkRequest, options?: HostRequestOptions): Promise<NetworkResponse>
}

export interface UiApi {
  readonly onDidChangeTheme: Event<Theme>
  readonly onDidChangeLocale: Event<Locale>
  readonly onDidReceiveMessage: Event<HostMessage>
  readonly onDidChangeProviderStatus: Event<ProviderStatus>
  getTheme(): Promise<Theme>
  getLocale(): Promise<Locale>
  getViewState<T extends JsonValue = JsonValue>(): Promise<T | undefined>
  setViewState(value: JsonValue): Promise<void>
  postMessage(message: HostMessage): Promise<void>
  showNotification(options: NotificationOptions): Promise<string | undefined>
  /**
   * From an authenticated Extension View, attach bounded, path-free extension
   * data to the main Kun composer. The Host supplies extension/View/workspace
   * provenance and consumes it once on the next main-conversation turn.
   */
  attachComposerContext(request: ComposerContextAttachmentRequest): Promise<ComposerContextAttachment>
}

export interface AgentRunSubscription extends Disposable {
  readonly onEvent: Event<AgentRunEvent>
}

export interface AgentApi {
  createRun(request: AgentCreateRunRequest): Promise<AgentCreateRunResponse>
  getRun(runId: string): Promise<AgentRun>
  subscribe(request: AgentSubscribeRequest): Promise<AgentRunSubscription>
  steer(request: AgentSteerRequest): Promise<AgentMutationResult>
  cancel(request: AgentCancelRequest): Promise<AgentMutationResult>
}

export interface ThreadsApi {
  listOwn(request?: ListOwnThreadsRequest): Promise<ListOwnThreadsResponse>
  getOwn(threadId: string): Promise<ExtensionThreadProjection>
}

export interface ToolsApi {
  registerTool<TInput extends JsonObject = JsonObject, TResult extends JsonValue = JsonValue>(
    declaration: ExtensionToolDeclarationInput,
    handler: ExtensionToolHandler<TInput, TResult>
  ): Promise<Disposable>
}

export interface ModelProvidersApi {
  registerProvider(
    declaration: ModelProviderDeclarationInput,
    adapter: ModelProviderAdapter
  ): Promise<Disposable>
  getStatus(providerId: string): Promise<ProviderStatus>
}

export interface AuthenticationApi {
  listAccounts(request?: ListAccountsRequest): Promise<Account[]>
  createSession(request: CreateAccountSessionRequest): Promise<AccountSession>
  getSession(sessionId: string): Promise<AccountSession>
  cancelSession(sessionId: string): Promise<void>
  deleteAccount(accountId: string): Promise<void>
  authenticatedFetch(request: AuthenticatedFetchRequest): Promise<NetworkResponse>
  revealSecret(request: RevealSecretRequest): Promise<string>
}

export interface MediaApi {
  pickFiles(request?: MediaPickFilesRequest): Promise<MediaPickFilesResult>
  pickSaveTarget(request?: MediaPickSaveTargetRequest): Promise<MediaPickSaveTargetResult>
  createCacheTarget(request: MediaCreateCacheTargetRequest): Promise<MediaCreateCacheTargetResult>
  stat(request: MediaStatRequest): Promise<MediaMetadata>
  readText(request: MediaReadTextRequest): Promise<MediaReadTextResult>
  release(request: MediaReleaseRequest): Promise<MediaReleaseResult>
  openViewResource(request: MediaOpenViewResourceRequest): Promise<MediaResourceLease>
  performArtifactAction(request: ArtifactHostActionRequest): Promise<ArtifactHostActionResult>
  getCapabilities(): Promise<MediaCapabilities>
  getAudioAnalysisCapabilities(): Promise<MediaAudioAnalysisCapabilities>
  getVisualModelStatus(): Promise<MediaVisualModelStatus>
  installVisualModel(request?: MediaInstallVisualModelRequest): Promise<MediaVisualModelStatus>
  analyzeVisualFrames(
    request: MediaAnalyzeVisualFramesRequest,
    options?: HostRequestOptions
  ): Promise<MediaAnalyzeVisualFramesResult>
  embedVisualQuery(
    request: MediaEmbedVisualQueryRequest,
    options?: HostRequestOptions
  ): Promise<MediaEmbedVisualQueryResult>
  probe(request: MediaProbeRequest): Promise<MediaProbeResult>
  startFfmpegJob(request: MediaStartFfmpegJobRequest): Promise<MediaStartFfmpegJobResult>
  startAudioAnalysisJob(
    request: MediaStartAudioAnalysisJobRequest
  ): Promise<MediaStartAudioAnalysisJobResult>
  startArchiveJob(request: MediaStartArchiveJobRequest): Promise<MediaStartArchiveJobResult>
}

export interface JobSubscription extends Disposable {
  readonly snapshot: JobSnapshot
  readonly replayGap: boolean
  readonly cursor: string
  readonly complete: boolean
  readonly onEvent: Event<JobEvent>
}

export interface JobsApi {
  get(jobId: string): Promise<JobSnapshot>
  list(request?: JobListRequest): Promise<JobPage>
  subscribe(request: JobSubscribeRequest): Promise<JobSubscription>
  cancel(request: JobCancelRequest): Promise<JobCancellationResult>
}

export const WorkspaceFileSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64'])
})
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>

export interface WorkspaceApi {
  readFile(path: string, encoding?: 'utf8' | 'base64'): Promise<WorkspaceFile>
  writeFile(file: WorkspaceFile): Promise<void>
  stat(path: string): Promise<JsonObject>
  list(path?: string): Promise<JsonObject[]>
}
