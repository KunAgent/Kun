import type {
  AppSettingsPatch,
  AppSettingsV1,
  ClawRunResult,
  ClawTaskFromTextResult,
  ClawRuntimeStatus,
  ModelEndpointFormat,
  ModelProviderModelProfileV1,
  ModelReasoningEffort,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult,
  WorkflowApprovalDecision,
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowNodeTestResult,
  WorkflowRunResult,
  WorkflowRuntimeStatus
} from './app-settings'
import type { EditorListResult, EditorOpenResult, OpenEditorPathOptions } from './editor'
import type { GitBranchesResult, GitBranchWorktreesResult, GitWorktreeCheckoutResult } from './git-branches'
import type { GitCheckpointCreateResult, GitCheckpointRestoreResult } from './git-checkpoint'
import type {
  MergeResult,
  SyncResult,
  WorktreeChanges,
  WorktreeInfo,
  WorktreePoolStatus
} from './worktree'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from './gui-update'
import type {
  BrowserUseControlInput,
  BrowserUseDecisionInput,
  BrowserUseMountInput,
  BrowserUseNavigationInput,
  BrowserUseViewState
} from './browser-use'
import type { StorageRelocationApi } from './storage-relocation'
import type {
  ClipboardImageReadResult,
  LocalPdfTextReadResult,
  LocalPdfTextTarget,
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  WorkspaceImageBytesSavePayload,
  WorkspaceImageBytesSaveResult,
  WorkspaceImagePickPayload,
  WorkspaceImagePickResult,
  WorkspaceFileReadResult,
  WorkspaceFileSaveAsPayload,
  WorkspaceFileSaveAsResult,
  WorkspaceImageReadResult,
  WorkspacePdfReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceFileChangePayload,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileOpenResult,
  WorkspaceFileRevealTarget,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspacePreviewLeaseReleasePayload,
  WorkspacePreviewLeaseReleaseResult,
  WorkspacePreviewLeaseResult,
  WorkspacePreviewLeaseTarget
} from './workspace-file'
import type {
  LocalOfficeDocumentReadResult,
  LocalOfficeDocumentTarget
} from './office-document'

export type ExtensionArtifactActionPayload = {
  artifactId: string
  ownerExtensionId: string
  ownerExtensionVersion: string
  workspaceId: string
  workspaceRoot: string
  action: 'open' | 'reveal'
}

export type ExtensionArtifactActionResult = {
  ok: boolean
  message?: string
}
import type { ProjectDesignMdOfficialLintResult } from './project-design-md'
import type {
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from './write-inline-completion'
import type {
  WriteInfographicRequest,
  WriteInfographicResult
} from './write-infographic'
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from './speech-to-text'
import type {
  LocalWhisperModelDeleteResult,
  LocalWhisperDownloadSourceId,
  LocalWhisperDownloadSourceStatusResult,
  LocalWhisperModelDownloadResult,
  LocalWhisperModelId,
  LocalWhisperModelProgress,
  LocalWhisperModelStatus
} from './local-whisper'
import type {
  UiPluginListItem,
  UiPluginManifestV1,
  UiPluginRuntimeBackgrounds,
  UiPluginRuntimeFigures,
  UiPluginRuntimeSceneAssets
} from './ui-plugin'
import type {
  WriteRetrievalRequest,
  WriteRetrievalResult
} from './write-retrieval'
import type {
  WriteExportPayload,
  WriteExportResult,
  WriteRichClipboardPayload,
  WriteRichClipboardResult
} from './write-export'
import type {
  ConversationExportPayload,
  ConversationExportResult
} from './conversation-export'
import type { PptMasterEnsureResult } from './ppt-master'
import type { DesignExportPayload, DesignExportResult } from './design-export'
import type {
  MemoryMarkdownExportSavePayload,
  MemoryMarkdownExportSaveResult
} from './memory-import-export'
import type {
  TerminalCreatePayload,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalResizePayload,
  TerminalWritePayload
} from './terminal'
import type { ExtensionIpcApi } from './extension-ipc'
import type {
  DataMigrationEstimate,
  DataMigrationExportOptions,
  DataMigrationImportOptions,
  DataMigrationImportPlan,
  DataMigrationInspectionSummary,
  DataMigrationOperationStatus,
  DataMigrationPathPickResult,
  DataMigrationProgress,
  DataMigrationRendererRequest,
  DataMigrationRendererResponse,
  DataMigrationReport,
  DataMigrationWorkspaceConflictStrategy
} from './data-migration'
import type {
  RuntimeImageAttachmentUploadRequest,
  RuntimeImageAttachmentUploadResult
} from './runtime-image-attachment'
import type { CliInstallAction, CliInstallResult, CliInstallStatus } from './cli-install'
import type { ProviderQuotaListResult } from './provider-quota'

export type KunRuntimeStatusPayload = {
  state: 'starting' | 'running' | 'restarting' | 'crashed' | 'failed' | 'stopped'
  source: string
  message?: string
  stderrTail?: string
  attempt?: number
  maxAttempts?: number
  rolledBack?: boolean
  at: string
}

export type KunRuntimeSettingsSyncStatusPayload = {
  state: 'idle' | 'syncing' | 'synced' | 'unavailable' | 'failed'
  generation: number
  message?: string
  at: string
}

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }
export type WorkspacePickResult = { canceled: boolean; path: string | null }
export type LocalFilesPickResult = { canceled: boolean; paths: string[] }
export type ConversationWorkspaceCreateResult = { ok: boolean; path: string; error?: string }
export type PathOpenResult = { ok: boolean; message?: string }
export const DESKTOP_COMMANDS = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'reload',
  'zoomIn',
  'zoomOut',
  'resetZoom',
  'toggleDevTools',
  'minimize',
  'toggleMaximize',
  'close',
  'quit'
] as const
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]
export type SkillSaveResult = { ok: true; path: string } | { ok: false; message: string }
export type SkillGithubImportResult =
  | { ok: true; count: number; names: string[]; paths: string[] }
  | { ok: false; message: string }
export type SkillListItem = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: 'project' | 'global'
  legacy: boolean
}
export type SkillListResult =
  | { ok: true; skills: SkillListItem[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }
export type SkillRootListItem = {
  id: string
  disableKey: string
  path: string
  scope: 'project' | 'global'
  source: 'common' | 'extra'
  labelKey?: string
  exists: boolean
  enabled: boolean
  skillCount: number
}
export type SkillRootListResult =
  | { ok: true; roots: SkillRootListItem[] }
  | { ok: false; message: string }
export type { PptMasterEnsureResult } from './ppt-master'
export type UiPluginListIpcResult = { plugins: UiPluginListItem[] }
export type UiPluginInstallIpcResult =
  | { canceled: true }
  | { canceled: false; ok: true; plugin: UiPluginListItem }
  | { canceled: false; ok: false; errors: string[] }
export type UiPluginLoadIpcResult =
  | {
      ok: true
      manifest: UiPluginManifestV1
      figures: UiPluginRuntimeFigures
      backgrounds: UiPluginRuntimeBackgrounds
      sceneAssets: UiPluginRuntimeSceneAssets
    }
  | { ok: false; error: string }
export type UiPluginThemeActivateIpcResult =
  | {
      ok: true
      manifest: UiPluginManifestV1
      figures: UiPluginRuntimeFigures
      sceneAssets: UiPluginRuntimeSceneAssets
    }
  | { ok: false; error: string }
export type UiPluginThemeDeactivateIpcResult =
  | { ok: true }
  | { ok: false; error: string }
export type DeepseekConfigFileResult = { path: string; content: string; exists: boolean }
export type DeepseekConfigSaveResult = { ok: true; path: string }
export type KunProjectConfigServerSummary = {
  id: string
  transport: 'stdio' | 'streamable-http' | 'sse'
  target: string
  enabled: boolean
}
export type KunProjectConfigFileResult = {
  workspaceRoot: string
  path: string
  content: string
  exists: boolean
  status: 'missing' | 'invalid' | 'valid'
  trust: 'untrusted' | 'trusted' | 'stale'
  message?: string
  digest?: string
  serverSummaries: KunProjectConfigServerSummary[]
  skillRootCount: number
  disabledSkillCount: number
}
export type TurnCompleteNotificationSource = 'main-agent' | 'subagent'

export type TurnCompleteNotificationPayload = {
  threadId?: string
  source: TurnCompleteNotificationSource
  title: string
  body: string
}
export type SystemNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }
export type ClawChannelActivityPayload = {
  channelId: string
  threadId: string
}
export type ClawChannelMirrorResult =
  | { ok: true }
  | { ok: false; message: string }
export type UpstreamModelsResult =
  | {
      ok: true
      modelIds: string[]
      /** @deprecated Use defaultModel so the provider binding is not ambiguous. */
      defaultModelId?: string
      defaultModel?: ModelProviderModelSelection
      modelGroups?: ModelProviderModelGroup[]
    }
  | { ok: false; message: string }
export type ModelProviderModelSelection = {
  providerId: string
  modelId: string
}
export type ModelProviderModelGroup = {
  providerId: string
  /** Stable built-in preset identity; survives multi-account ids such as codex-2. */
  presetSource?: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  /** Opaque account reference used only for an acknowledged extension binding. */
  accountId?: string
  extensionProvider?: {
    extensionId: string
    extensionVersion: string
    localProviderId: string
  }
}
export type ModelProviderProbeRequest = {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
}
export type ModelProviderProbeResult =
  | { ok: true; latencyMs: number; modelIds: string[] }
  | { ok: false; message: string }
export type ProviderModelCatalogSource = 'provider-api' | 'models-dev'
export type ModelsDevCatalogModality = 'text' | 'audio' | 'image' | 'video' | 'pdf'
export type CursorSubscriptionModelParameterValue = {
  value: string
  displayName?: string
}
export type CursorSubscriptionModelParameter = {
  id: string
  displayName?: string
  values: CursorSubscriptionModelParameterValue[]
}
export type CursorSubscriptionModelVariant = {
  displayName: string
  description?: string
  isDefault?: boolean
  params: Array<{ id: string; value: string }>
}
export type CursorSubscriptionModel = {
  id: string
  displayName: string
  description?: string
  aliases?: string[]
  parameters?: CursorSubscriptionModelParameter[]
  variants?: CursorSubscriptionModelVariant[]
}
export type ModelsDevCatalogModelHint = {
  id: string
  aliases?: string[]
}
export type ModelsDevCatalogModel = {
  id: string
  providerKey?: string
  name?: string
  description?: string
  inputModalities: ModelsDevCatalogModality[]
  outputModalities: ModelsDevCatalogModality[]
  reasoning?: boolean
  toolCalling?: boolean
  contextWindowTokens?: number
  maxOutputTokens?: number
}
export type ModelsDevCatalogRequest = {
  providerId: string
  baseUrl: string
  forceRefresh?: boolean
  modelHints?: ModelsDevCatalogModelHint[]
}
export type ModelsDevCatalogMatchMode = 'catalog' | 'enrichment-only'
export type ModelsDevCatalogResult =
  | {
      status: 'ok'
      providerKey: string
      providerName: string
      matchMode: ModelsDevCatalogMatchMode
      stale: boolean
      models: ModelsDevCatalogModel[]
    }
  | { status: 'unmapped'; models: [] }
  | { status: 'error'; message: string; models: [] }
export type PromptOptimizationRequest = {
  text: string
}
export type PromptOptimizationResult =
  | { ok: true; text: string; model: string; providerId: string }
  | { ok: false; message: string }
export type ClawImInstallQrResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }
export type ClawImInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: true; kind: 'weixin'; accountId: string; sessionKey: string }
  | { done: false; error?: string }
export type CodexAuthStartResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number }
  | { ok: false; message: string }
export type CodexOAuthCredentials = {
  kind: 'codex-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId: string
  email?: string
}
export type CodexAuthPollResult =
  | { done: true; credentials: CodexOAuthCredentials }
  | { done: false; error?: string }
export type CodexBrowserAuthErrorCode = 'port_in_use'
export type CodexBrowserAuthResult =
  | { ok: true; credentials: CodexOAuthCredentials }
  | { ok: false; message: string; code?: CodexBrowserAuthErrorCode }
export type GrokOAuthCredentials = {
  kind: 'grok-oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  userId?: string
  issuer?: string
  clientId?: string
}
export type GrokBrowserAuthErrorCode = 'port_in_use'
export type GrokBrowserAuthResult =
  | { ok: true; credentials: GrokOAuthCredentials }
  | { ok: false; message: string; code?: GrokBrowserAuthErrorCode }
export type GrokBrowserAuthCancelResult = { ok: true }
export type ClawImTelegramConnectErrorCode = 'invalid_format' | 'rejected' | 'network' | 'unknown'
export type ClawImTelegramConnectResult =
  | { ok: true; botId: number; botUsername: string; botFirstName: string }
  | { ok: false; code: ClawImTelegramConnectErrorCode; message: string }
export type ConfirmDialogOptions = {
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
}
export type AlertDialogOptions = {
  message: string
  detail?: string
  buttonLabel?: string
}
/** Which legacy install a set of importable conversations came from. */
export type LegacySessionSourceKind = 'kun' | 'coreagent' | 'custom'
export type LegacySessionDetectedSource = {
  id: string
  kind: LegacySessionSourceKind
  /** Absolute path to the legacy threads directory. */
  path: string
  /** Conversation folders found in this source. */
  threadCount: number
  /** Folders not already present in the destination (would be newly imported). */
  newCount: number
}
export type LegacySessionDetectResult = {
  /** Destination threads directory (current Kun data dir + /threads). */
  destDir: string
  sources: LegacySessionDetectedSource[]
}
export type LegacySessionImportSourceSummary = {
  path: string
  total: number
  imported: number
  skipped: number
}
export type LegacySessionImportSummary = {
  destDir: string
  /** Conversation folders seen across all sources. */
  total: number
  /** Folders copied into the destination this run. */
  imported: number
  /** Folders skipped because they already existed (or failed to copy). */
  skipped: number
  sources: LegacySessionImportSourceSummary[]
}
export type LegacySessionImportResult =
  | ({ ok: true } & LegacySessionImportSummary)
  | { ok: false; message: string }
/** One IPC message carries every SSE event parsed from a network chunk. */
export type SseEventPayload = { streamId: string; events: unknown[]; batchId?: string }
export type SseEndPayload = { streamId: string }
export type SseErrorPayload = { streamId: string; status?: number; message?: string }
export type TrayActionPayload =
  | { type: 'new-chat' }
  | { type: 'open-thread'; threadId: string }

export type ComputerUsePermissionKind = 'accessibility' | 'screenRecording'
export type ComputerUsePermissionState = 'granted' | 'denied' | 'unknown'
export type ComputerUsePermissions = {
  platform: string
  supported: boolean
  needsPermission: boolean
  accessibility: ComputerUsePermissionState
  screenRecording: ComputerUsePermissionState
  /** Accessibility is enabled in System Settings but needs an app relaunch to take effect. */
  accessibilityNeedsRestart: boolean
}

export type ClaudeSubscriptionStatus = {
  loggedIn: boolean
  /** The official CLI is authoritative; file is an older-CLI compatibility fallback. */
  source: 'cli' | 'credentials-file' | 'none'
  /** Bounded diagnostic code only. Never contains account identity or credential values. */
  message?: string
}
export type ClaudeSubscriptionLoginResult =
  | { ok: true; mode: 'ambient' }
  | { ok: false; message: string }
export type ClaudeSubscriptionProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; message: string }

export type SdkDownloadState = {
  status: 'downloading' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  message?: string
}

export type AntigravityReasoningEffort = Extract<ModelReasoningEffort, 'low' | 'medium' | 'high'>
export type AntigravitySubscriptionModel = {
  id: string
  supportedEfforts: AntigravityReasoningEffort[]
  defaultEffort: AntigravityReasoningEffort
}
export type AntigravitySubscriptionModelCatalog = {
  models: AntigravitySubscriptionModel[]
}

export const UNREADABLE_CREDENTIAL_KEY_ERROR_CODE = 'credential_key_unreadable'

export type CredentialRecoveryResetResult =
  | { reset: false }
  | { reset: true; backupPath: string; movedItems: string[] }

export type KunGuiApi = ExtensionIpcApi & {
  platform: string
  homeDir: string
  /** Immutable process identity selected before Electron profile locking. */
  appEnvironment: import('./app-environment').AppEnvironmentInfo
  /** Manager-backed durable mappings shared by Kun and kun-dv profiles. */
  sharedClientState: {
    read: () => Promise<import('./app-environment').RevisionedSnapshot<Record<string, string>>>
    write: (
      expectedRevision: number,
      entries: Record<string, string>
    ) => Promise<import('./app-environment').RevisionedSnapshot<Record<string, string>>>
  }
  /** Windows production storage-root relocation and recovery surface. */
  storageRelocation: StorageRelocationApi
  dataMigration: {
    pickExportPackage: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    pickImportPackage: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    pickDestinationDirectory: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    estimateExport: (input: Pick<DataMigrationExportOptions,
      'operationId' | 'selectedWorkspaceIds' | 'categories' | 'preset' | 'sensitiveContentAcknowledged'
    >) => Promise<DataMigrationEstimate>
    inspectPackage: (input: { packagePath: string; passphrase?: string }) => Promise<DataMigrationInspectionSummary>
    planImport: (input: {
      operationId: string
      inspectionId: string
      destinationBaseRoot: string
      destinationRoots?: Record<string, string>
      strategies?: Record<string, DataMigrationWorkspaceConflictStrategy>
      skippedWorkspaceIds?: string[]
    }) => Promise<DataMigrationImportPlan>
    startExport: (input: DataMigrationExportOptions) => Promise<{ packagePath: string; report: DataMigrationReport }>
    startImport: (input: DataMigrationImportOptions) => Promise<{ report: DataMigrationReport; refreshRequired: boolean }>
    cancel: (operationId: string) => Promise<DataMigrationOperationStatus>
    recover: (operationId: string, action: 'resume' | 'rollback') => Promise<DataMigrationOperationStatus>
    getStatus: () => Promise<DataMigrationOperationStatus>
    listReports: () => Promise<DataMigrationReport[]>
    getReport: (operationId: string) => Promise<DataMigrationReport>
    deleteReport: (operationId: string) => Promise<void>
    onProgress: (handler: (progress: DataMigrationProgress) => void) => () => void
    onRendererRequest: (handler: (request: DataMigrationRendererRequest) => void) => () => void
    respondRendererRequest: (response: DataMigrationRendererResponse) => Promise<void>
  }
  getSettings: () => Promise<AppSettingsV1>
  resetUnreadableCredentials: () => Promise<CredentialRecoveryResetResult>
  cliInstallStatus: () => Promise<CliInstallStatus>
  cliInstallAction: (action: CliInstallAction) => Promise<CliInstallResult>
  /** Detect an existing local Claude Code login (subscription auth). */
  claudeSubscriptionStatus: () => Promise<ClaudeSubscriptionStatus>
  /** Run the official ambient Claude subscription login flow. */
  claudeSubscriptionLogin: () => Promise<ClaudeSubscriptionLoginResult>
  /** Make a bounded real request through the official Claude transport. */
  claudeSubscriptionProbe: (token?: string) => Promise<ClaudeSubscriptionProbeResult>
  /** List Claude models available to the subscription (via the SDK's supportedModels). */
  claudeSubscriptionModels: (token?: string) => Promise<string[]>
  /** Whether the on-demand Claude Code binary is present + any in-flight download. */
  claudeSubscriptionSdkStatus: () => Promise<{
    installed: boolean
    path?: string
    download?: SdkDownloadState | null
  }>
  /** Start (or resume) the background download; returns the live state immediately. */
  claudeSubscriptionSdkInstall: () => Promise<SdkDownloadState>
  /** Subscribe to background-download progress; returns an unsubscribe fn. */
  onClaudeSubscriptionSdkProgress: (handler: (state: SdkDownloadState) => void) => () => void
  /** Whether Google's official Antigravity CLI is available to Kun. */
  geminiSubscriptionCliStatus: () => Promise<{
    installed: boolean
    path?: string
    download?: SdkDownloadState | null
  }>
  /** Download the pinned official Antigravity CLI release on demand. */
  geminiSubscriptionCliInstall: () => Promise<SdkDownloadState>
  /** Subscribe to Antigravity CLI download progress. */
  onGeminiSubscriptionCliProgress: (handler: (state: SdkDownloadState) => void) => () => void
  /** Models and reasoning efforts exposed by the user's current `agy` subscription login. */
  geminiSubscriptionModels: () => Promise<AntigravitySubscriptionModelCatalog>
  /** Detect the official Gemini CLI binary and its local Google OAuth login. */
  geminiCliSubscriptionStatus: () => Promise<{
    installed: boolean
    authenticated: boolean
    path?: string
    credentialSource?: 'keychain' | 'file'
  }>
  /** Concrete models routed through the Gemini CLI Code Assist API contract. */
  geminiCliSubscriptionModels: () => Promise<string[]>
  /** Validate a Cursor API key and list models visible to that Cursor account. */
  cursorSubscriptionDiscover: (apiKey: string) => Promise<{
    account: {
      apiKeyName: string
      userEmail?: string
      userFirstName?: string
      userLastName?: string
    }
    models: CursorSubscriptionModel[]
  }>
  setSettings: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  saveSettingsSilent: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (path: string, method?: string, body?: string) => Promise<RuntimeRequestResult>
  getRuntimeSettingsSyncStatus: () => Promise<KunRuntimeSettingsSyncStatusPayload>
  uploadRuntimeImageAttachment: (
    request: RuntimeImageAttachmentUploadRequest
  ) => Promise<RuntimeImageAttachmentUploadResult>
  readLocalOfficeDocument: (
    options: LocalOfficeDocumentTarget
  ) => Promise<LocalOfficeDocumentReadResult>
  resolveKunApproval: (request: KunProtectedApprovalRequest) => Promise<KunProtectedApprovalResult>
  restartRuntime: () => Promise<void>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  probeModelProvider: (payload: ModelProviderProbeRequest) => Promise<ModelProviderProbeResult>
  listProviderQuotas: () => Promise<ProviderQuotaListResult>
  fetchModelsDevCatalog: (payload: ModelsDevCatalogRequest) => Promise<ModelsDevCatalogResult>
  optimizePrompt: (payload: PromptOptimizationRequest) => Promise<PromptOptimizationResult>
  getClawStatus: () => Promise<ClawRuntimeStatus>
  runClawTask: (taskId: string) => Promise<ClawRunResult>
  getScheduleStatus: () => Promise<ScheduleRuntimeStatus>
  runScheduleTask: (taskId: string) => Promise<ScheduleRunResult>
  getWorkflowStatus: () => Promise<WorkflowRuntimeStatus>
  runWorkflow: (workflowId: string, input?: unknown) => Promise<WorkflowRunResult>
  stopWorkflow: (workflowId: string) => Promise<WorkflowRunResult>
  runWorkflowNode: (workflowId: string, nodeId: string) => Promise<WorkflowRunResult>
  testWorkflowNode: (workflowId: string, nodeId: string, mockJson: string) => Promise<WorkflowNodeTestResult>
  resolveWorkflowApproval: (token: string, decision: WorkflowApprovalDecision) => Promise<{ ok: boolean }>
  checkWorkflowCode: (language: WorkflowCodeLanguage, code: string) => Promise<WorkflowCodeCheckResult>
  startClawImInstallQr: (
    provider: 'feishu' | 'weixin',
    options?: { isLark?: boolean }
  ) => Promise<ClawImInstallQrResult>
  pollClawImInstall: (
    provider: 'feishu' | 'weixin',
    deviceCode: string
  ) => Promise<ClawImInstallPollResult>
  connectTelegramBot: (
    botToken: string,
    allowedChatIds?: string
  ) => Promise<ClawImTelegramConnectResult>
  startCodexAuth: () => Promise<CodexAuthStartResult>
  pollCodexAuth: (deviceCode: string, userCode: string) => Promise<CodexAuthPollResult>
  startCodexBrowserAuth: () => Promise<CodexBrowserAuthResult>
  startGrokBrowserAuth: () => Promise<GrokBrowserAuthResult>
  /** Paste the authorization code (or callback URL) from accounts.x.ai. */
  submitGrokBrowserAuthCode: (code: string) => Promise<GrokBrowserAuthResult>
  cancelGrokBrowserAuth: () => Promise<GrokBrowserAuthCancelResult>
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  workspaceDirectoryExists: (workspaceRoot: string) => Promise<boolean>
  pickLocalFiles: (defaultPath?: string) => Promise<LocalFilesPickResult>
  /** 在对话工作目录根下创建一个时间戳子目录作为新对话的工作目录。 */
  createConversationWorkspace: (root?: string) => Promise<ConversationWorkspaceCreateResult>
  alertDialog: (options: AlertDialogOptions) => Promise<void>
  confirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>
  /** Detect importable conversations from a previous DeepSeek GUI install. */
  detectLegacySessions: () => Promise<LegacySessionDetectResult>
  /** Import legacy conversations; omit sourceDir to import all auto-detected sources. */
  importLegacySessions: (sourceDir?: string) => Promise<LegacySessionImportResult>
  /** Open a directory picker for choosing a legacy conversations folder. */
  pickLegacySessionDir: () => Promise<WorkspacePickResult>
  listSkills: (workspaceRoot?: string) => Promise<SkillListResult>
  listSkillRoots: (workspaceRoot?: string) => Promise<SkillRootListResult>
  saveSkillFile: (
    rootPath: string,
    skillName: string,
    content: string,
    manifestContent?: string
  ) => Promise<SkillSaveResult>
  importSkillsFromGitHub: (rootPath: string, url: string) => Promise<SkillGithubImportResult>
  /** Install/repair the managed PPT Master skill and its isolated Python environment. */
  ensurePptMaster: () => Promise<PptMasterEnsureResult>
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  listUiPlugins: () => Promise<UiPluginListIpcResult>
  installUiPlugin: () => Promise<UiPluginInstallIpcResult>
  removeUiPlugin: (id: string) => Promise<{ ok: boolean }>
  loadUiPlugin: (id: string) => Promise<UiPluginLoadIpcResult>
  activateUiPluginTheme: (id: string) => Promise<UiPluginThemeActivateIpcResult>
  deactivateUiPluginTheme: () => Promise<UiPluginThemeDeactivateIpcResult>
  getKunConfigFile: () => Promise<DeepseekConfigFileResult>
  setKunConfigFile: (content: string) => Promise<DeepseekConfigSaveResult>
  openKunConfigDir: () => Promise<PathOpenResult>
  getKunProjectConfigFile: (workspaceRoot: string) => Promise<KunProjectConfigFileResult>
  setKunProjectConfigFile: (workspaceRoot: string, content: string) => Promise<KunProjectConfigFileResult>
  setKunProjectConfigTrust: (
    workspaceRoot: string,
    trusted: boolean,
    expectedDigest?: string
  ) => Promise<KunProjectConfigFileResult>
  openKunProjectConfigDir: (workspaceRoot: string) => Promise<PathOpenResult>
  getGitBranches: (workspaceRoot: string) => Promise<GitBranchesResult>
  switchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createGitCheckpoint: (params: {
    workspaceRoot: string
    threadId: string
    checkpointId?: string
  }) => Promise<GitCheckpointCreateResult>
  restoreGitCheckpoint: (params: {
    checkpointId: string
    allowPartialRestore?: boolean
    expectedThreadId?: string
    expectedWorkspaceRoot?: string
  }) => Promise<GitCheckpointRestoreResult>
  checkoutGitBranchWorktree: (workspaceRoot: string, branch: string) => Promise<GitWorktreeCheckoutResult>
  createGitBranchWorktree: (workspaceRoot: string, branch: string) => Promise<GitWorktreeCheckoutResult>
  listGitBranchWorktrees: (params: {
    projectPath: string
    worktreeRoot?: string
  }) => Promise<GitBranchWorktreesResult>
  removeGitBranchWorktree: (params: { workspaceRoot: string; worktreePath: string }) => Promise<void>
  acquireWorktree: (params: {
    projectPath: string
    poolIndex: number
    taskId: string
    force?: boolean
    worktreeRoot?: string
  }) => Promise<WorktreeInfo>
  releaseWorktree: (params: { projectPath: string; poolIndex: number }) => Promise<void>
  listWorktrees: (params: { projectPath: string; worktreeRoot?: string }) => Promise<WorktreePoolStatus>
  removeWorktree: (params: {
    projectPath: string
    poolIndex: number
    worktreeRoot?: string
  }) => Promise<void>
  getWorktreeChanges: (params: { worktreePath: string }) => Promise<WorktreeChanges>
  commitWorktree: (params: { worktreePath: string; message: string }) => Promise<string>
  mergeWorktree: (params: {
    projectPath: string
    poolIndex: number
    commitMessage?: string
    worktreeRoot?: string
  }) => Promise<MergeResult>
  abortWorktreeMerge: (params: { projectPath: string }) => Promise<void>
  continueWorktreeMerge: (params: { projectPath: string; message?: string }) => Promise<MergeResult>
  syncWorktreeFromMain: (params: {
    projectPath: string
    poolIndex: number
    worktreeRoot?: string
  }) => Promise<SyncResult>
  abortWorktreeRebase: (params: { worktreePath: string }) => Promise<void>
  cleanupWorktrees: (params: { projectPath: string; worktreeRoot?: string }) => Promise<void>
  findAvailableWorktreePoolIndex: (params: {
    projectPath: string
    worktreeRoot?: string
  }) => Promise<number | null>
  listEditors: () => Promise<EditorListResult>
  openEditorPath: (options: OpenEditorPathOptions) => Promise<EditorOpenResult>
  listWorkspaceDirectory: (options: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  resolveWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>
  openWorkspaceFileInSystem: (options: WorkspaceFileTarget) => Promise<WorkspaceFileOpenResult>
  revealWorkspaceFileInFolder: (options: WorkspaceFileRevealTarget) => Promise<WorkspaceFileOpenResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  lintProjectDesignMd: (content: string) => Promise<ProjectDesignMdOfficialLintResult>
  readWorkspaceImage: (options: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>
  readWorkspacePdf: (options: WorkspaceFileTarget) => Promise<WorkspacePdfReadResult>
  openWorkspacePreviewResource: (
    options: WorkspacePreviewLeaseTarget
  ) => Promise<WorkspacePreviewLeaseResult>
  releaseWorkspacePreviewResource: (
    payload: WorkspacePreviewLeaseReleasePayload
  ) => Promise<WorkspacePreviewLeaseReleaseResult>
  readLocalPdfText: (options: LocalPdfTextTarget) => Promise<LocalPdfTextReadResult>
  saveWorkspaceFileAs: (payload: WorkspaceFileSaveAsPayload) => Promise<WorkspaceFileSaveAsResult>
  openExtensionArtifact: (
    payload: ExtensionArtifactActionPayload
  ) => Promise<ExtensionArtifactActionResult>
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  createWorkspaceFile: (payload: WorkspaceFileCreatePayload) => Promise<WorkspaceFileCreateResult>
  createWorkspaceDirectory: (
    payload: WorkspaceDirectoryCreatePayload
  ) => Promise<WorkspaceDirectoryCreateResult>
  saveWorkspaceClipboardImage: (
    payload: WorkspaceClipboardImageSavePayload
  ) => Promise<WorkspaceClipboardImageSaveResult>
  pickWorkspaceImage: (payload: WorkspaceImagePickPayload) => Promise<WorkspaceImagePickResult>
  saveWorkspaceImageBytes: (
    payload: WorkspaceImageBytesSavePayload
  ) => Promise<WorkspaceImageBytesSaveResult>
  readClipboardImage: () => Promise<ClipboardImageReadResult>
  getPathForFile: (file: File) => string
  renameWorkspaceEntry: (
    payload: WorkspaceEntryRenamePayload
  ) => Promise<WorkspaceEntryRenameResult>
  deleteWorkspaceEntry: (
    payload: WorkspaceEntryDeletePayload
  ) => Promise<WorkspaceEntryDeleteResult>
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
  requestWriteInlineCompletion: (
    payload: WriteInlineCompletionRequest
  ) => Promise<WriteInlineCompletionResult>
  retrieveWriteContext: (
    payload: WriteRetrievalRequest
  ) => Promise<WriteRetrievalResult>
  generateWriteInfographic: (
    payload: WriteInfographicRequest
  ) => Promise<WriteInfographicResult>
  authorizeWritePrototype: (payload: {
    path: string
    workspaceRoot: string
  }) => Promise<
    { ok: true; absolutePath: string; fileUrl: string } | { ok: false; message: string }
  >
  openWritePrototype: (payload: {
    path: string
    workspaceRoot: string
  }) => Promise<{ ok: boolean; message?: string }>
  transcribeSpeech: (
    payload: SpeechTranscriptionRequest
  ) => Promise<SpeechTranscriptionResult>
  getLocalWhisperModelStatus: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelStatus>
  downloadLocalWhisperModel: (payload?: {
    modelId?: LocalWhisperModelId
    sourceId?: LocalWhisperDownloadSourceId
  }) => Promise<LocalWhisperModelDownloadResult>
  cancelLocalWhisperModel: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelDownloadResult>
  checkLocalWhisperDownloadSources: (payload?: {
    modelId?: LocalWhisperModelId
  }) => Promise<LocalWhisperDownloadSourceStatusResult>
  deleteLocalWhisperModel: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelDeleteResult>
  onLocalWhisperModelProgress: (handler: (payload: LocalWhisperModelProgress) => void) => () => void
  listWriteInlineCompletionDebugEntries: () => Promise<WriteInlineCompletionDebugEntry[]>
  clearWriteInlineCompletionDebugEntries: () => Promise<boolean>
  exportWriteDocument: (payload: WriteExportPayload) => Promise<WriteExportResult>
  exportConversation: (payload: ConversationExportPayload) => Promise<ConversationExportResult>
  exportMemoryMarkdown: (payload: MemoryMarkdownExportSavePayload) => Promise<MemoryMarkdownExportSaveResult>
  exportDesignPrototype: (payload: DesignExportPayload) => Promise<DesignExportResult>
  copyWriteDocumentAsRichText: (
    payload: WriteRichClipboardPayload
  ) => Promise<WriteRichClipboardResult>
  startSse: (
    threadId: string,
    sinceSeq: number,
    streamId?: string,
    options?: { acknowledgedBatches?: boolean }
  ) => Promise<{ streamId: string }>
  stopSse: (streamId: string) => Promise<boolean>
  ackSse: (streamId: string, batchId: string) => Promise<boolean>
  onSseEvent: (handler: (payload: SseEventPayload) => void) => () => void
  onSseEnd: (handler: (payload: SseEndPayload) => void) => () => void
  onSseError: (handler: (payload: SseErrorPayload) => void) => () => void
  onClawChannelActivity: (handler: (payload: ClawChannelActivityPayload) => void) => () => void
  onTrayAction: (handler: (payload: TrayActionPayload) => void) => () => void
  onRuntimeStatus: (handler: (payload: KunRuntimeStatusPayload) => void) => () => void
  onRuntimeSettingsSyncStatus: (
    handler: (payload: KunRuntimeSettingsSyncStatusPayload) => void
  ) => () => void
  mirrorClawChannelMessage: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<ClawChannelMirrorResult>
  mirrorClawChannelMessageToFeishu: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<ClawChannelMirrorResult>
  createClawTaskFromText: (
    text: string,
    options?: { channelId?: string; providerId?: string; modelHint?: string; reasoningEffort?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ClawTaskFromTextResult>
  createScheduleTaskFromText: (
    text: string,
    options?: { workspaceRoot?: string; clawChannelId?: string; providerId?: string; modelHint?: string; reasoningEffort?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ScheduleTaskFromTextResult>
  runDesktopCommand: (command: DesktopCommand) => Promise<void>
  openExternal: (url: string) => Promise<void>
  getComputerUsePermissions: () => Promise<ComputerUsePermissions>
  requestComputerUsePermission: (
    kind: ComputerUsePermissionKind
  ) => Promise<ComputerUsePermissions>
  getBrowserUseState: (threadId: string) => Promise<BrowserUseViewState>
  mountBrowserUse: (input: BrowserUseMountInput) => Promise<BrowserUseViewState>
  decideBrowserUseOrigin: (input: BrowserUseDecisionInput) => Promise<BrowserUseViewState>
  decideBrowserUseAction: (input: BrowserUseDecisionInput) => Promise<BrowserUseViewState>
  setBrowserUseControl: (input: BrowserUseControlInput) => Promise<BrowserUseViewState>
  navigateBrowserUse: (input: BrowserUseNavigationInput) => Promise<BrowserUseViewState>
  stopBrowserUse: (threadId: string) => Promise<BrowserUseViewState>
  clearBrowserUse: (threadId: string) => Promise<BrowserUseViewState>
  onBrowserUseState: (handler: (state: BrowserUseViewState) => void) => () => void
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => Promise<string>
  getGuiUpdateState: () => Promise<GuiUpdateState>
  checkGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateInfo>
  downloadGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateDownloadResult>
  installGuiUpdate: () => Promise<GuiUpdateInstallResult>
  onGuiUpdateState: (handler: (payload: GuiUpdateState) => void) => () => void
  logError: (category: string, message: string, detail?: unknown) => Promise<void>
  getLogPath: () => Promise<string>
  openLogDir: () => Promise<{ ok: boolean; message?: string }>
  createTerminal: (payload: TerminalCreatePayload) => Promise<TerminalCreateResult>
  writeToTerminal: (payload: TerminalWritePayload) => Promise<boolean>
  resizeTerminal: (payload: TerminalResizePayload) => Promise<boolean>
  disposeTerminal: (sessionId: string) => Promise<boolean>
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => () => void
  onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => () => void
}

export type KunProtectedApprovalRequest = {
  approvalId: string
  decision: 'allow' | 'deny'
  /** Policy decisions are generated by Kun; user decisions require a protected native confirmation. */
  source: 'policy' | 'user'
}

export type KunProtectedApprovalResult =
  | { confirmed: false }
  | { confirmed: true; response: RuntimeRequestResult }
