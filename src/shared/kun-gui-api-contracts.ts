import type {
  AppSettingsPatch,
  AppSettingsV1,
  ClawRunResult,
  ClawTaskFromTextResult,
  ClawRuntimeStatus,
  DaemonActionResult,
  DaemonLogPage,
  DaemonRuntimeStatus,
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
import type { UninstallApi } from './uninstall'
import type { RuntimeDataRecoveryApi } from './runtime-data-recovery'
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
import type {
  DevPreviewCaptureRequest,
  DevPreviewCaptureResult
} from './dev-preview-capture'

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
export type GatewayCredentialStatus = { configured: boolean; createdAt?: string; rotatedAt?: string }
export type GatewayCredentialResult = { ok: boolean; status: number; credential: GatewayCredentialStatus; copied?: boolean }
export type WorkspacePickResult = { canceled: boolean; path: string | null }
export type WorkspaceCreationTimeEntry = { path: string; createdAtMs: number | null }

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
  'toggleMini',
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
  builtin?: boolean
  legacy: boolean
}
export type SkillListResult = { ok: true; skills: SkillListItem[]; validationErrors: Array<{ root: string; message: string }> }
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

export const MAX_APP_BADGE_COUNT = 999

export type AppBadgeCountResult = {
  applied: boolean
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
  providerId: string
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
  useProxy: boolean
}

export type ModelProviderProbeResult =
  | { ok: true; latencyMs: number; modelIds: string[]; modelProfiles?: Record<string, ModelProviderModelProfileV1> }
  | { ok: false; message: string; suggestedProxyUrl?: string }

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

export type ModelsDevCatalogMetadataIssue = {
  field: 'contextWindowTokens' | 'maxOutputTokens'
  code: 'out_of_range'
  rawValue: number
  maxAllowed: number
}

export type ModelsDevCatalogPricing = {
  /** USD per million input tokens (non-cache). */
  inputUsdPerMillion: number
  /** USD per million output tokens. */
  outputUsdPerMillion: number
  /** Cache-read/write USD per million tokens; omitted falls back to input. */
  cacheReadUsdPerMillion?: number
  cacheWriteUsdPerMillion?: number
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
  /** True only when models.dev reports both input and output cost as zero. */
  free?: boolean
  pricing?: ModelsDevCatalogPricing
  contextWindowTokens?: number
  maxOutputTokens?: number
  /** Import-only diagnostics for catalog fields omitted by the sanitizer. */
  metadataIssues?: ModelsDevCatalogMetadataIssue[]
}

export type ModelsDevCatalogRequest = {
  providerId: string
  baseUrl: string
  forceRefresh?: boolean
  modelHints?: ModelsDevCatalogModelHint[]
}

export type ModelsDevCatalogMatchMode = 'catalog' | 'enrichment-only'

export type ModelsDevCatalogSource = 'models.dev' | 'kun-agent'

export type ModelsDevCatalogResult =
  | {
      status: 'ok'
      providerKey: string
      providerName: string
      matchMode: ModelsDevCatalogMatchMode
      stale: boolean
      /** Which catalog source produced the model data (for diagnostics/UI). */
      source?: ModelsDevCatalogSource
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

export type ProviderAuthProxySelection = { providerId: string; useProxy: boolean }

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

export type GrokBrowserAuthErrorCode =
  | 'port_in_use'
  | 'discovery_failed'
  | 'callback_failed'
  | 'browser_open_failed'
  | 'token_exchange_failed'
  | 'timeout'
  | 'cancelled'

export type GrokBrowserAuthResult =
  | { ok: true; credentials: GrokOAuthCredentials }
  | {
      ok: false
      message: string
      code?: GrokBrowserAuthErrorCode
    }

export type GrokBrowserAuthCancelResult = { ok: true }

export type ClawImTelegramConnectErrorCode =
  | 'invalid_format'
  | 'invalid_proxy'
  | 'rejected'
  | 'network'
  | 'unknown'

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

export type { SseEventPayload, SseOpenPayload, SseEndPayload, SseErrorPayload, KunGuiSseSurface } from './kun-gui-sse-contracts'

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
  status: 'downloading' | 'restarting' | 'done' | 'error'
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

export type ModelProviderCredentialRevealResult = {
  providerId: string
  credential: string
}
