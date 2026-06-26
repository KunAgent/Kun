import type {
  AppSettingsPatch,
  AppSettingsV1,
  ClawRunResult,
  ClawTaskFromTextResult,
  ClawRuntimeStatus,
  ModelEndpointFormat,
  ModelProviderModelProfileV1,
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
  ClipboardImageReadResult,
  LocalPdfTextReadResult,
  LocalPdfTextTarget,
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
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
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult
} from './workspace-file'
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
  UiPluginRuntimeFigures
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
import type { DesignExportPayload, DesignExportResult } from './design-export'
import type {
  TerminalCreatePayload,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalResizePayload,
  TerminalWritePayload
} from './terminal'

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

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }
export type WorkspacePickResult = { canceled: boolean; path: string | null }
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
export type UiPluginListIpcResult = { plugins: UiPluginListItem[] }
export type UiPluginInstallIpcResult =
  | { canceled: true }
  | { canceled: false; ok: true; plugin: UiPluginListItem }
  | { canceled: false; ok: false; errors: string[] }
export type UiPluginLoadIpcResult =
  | { ok: true; manifest: UiPluginManifestV1; figures: UiPluginRuntimeFigures }
  | { ok: false; error: string }
export type DeepseekConfigFileResult = { path: string; content: string; exists: boolean }
export type DeepseekConfigSaveResult = { ok: true; path: string }
export type TurnCompleteNotificationPayload = {
  threadId?: string
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
  | { ok: true; modelIds: string[]; defaultModelId?: string; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }
export type ModelProviderModelGroup = {
  providerId: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
}
export type ModelProviderProbeRequest = {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
}
export type ModelProviderProbeResult =
  | { ok: true; latencyMs: number; modelIds: string[] }
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
export type CodexBrowserAuthResult =
  | { ok: true; credentials: CodexOAuthCredentials }
  | { ok: false; message: string }
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
export type SseEventPayload = { streamId: string; events: unknown[] }
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
  /** A Claude Code credentials file is present (positive signal; macOS Keychain absence is only a hint). */
  loggedIn: boolean
}
export type ClaudeSubscriptionLoginResult =
  | { ok: true; token: string }
  | { ok: false; message: string }

export type KunGuiApi = {
  platform: string
  homeDir: string
  getSettings: () => Promise<AppSettingsV1>
  /** Detect an existing local Claude Code login (subscription auth). */
  claudeSubscriptionStatus: () => Promise<ClaudeSubscriptionStatus>
  /** Run `claude setup-token` (opens browser) and capture the OAuth token. */
  claudeSubscriptionLogin: () => Promise<ClaudeSubscriptionLoginResult>
  /** List Claude models available to the subscription (via the SDK's supportedModels). */
  claudeSubscriptionModels: (token?: string) => Promise<string[]>
  /** Whether the on-demand Claude Code binary is present (download not needed). */
  claudeSubscriptionSdkStatus: () => Promise<{ installed: boolean; path?: string }>
  /** Download + install the Claude Code binary into the user-data dir. */
  claudeSubscriptionSdkInstall: () => Promise<
    { ok: true; path: string } | { ok: false; message: string }
  >
  setSettings: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  saveSettingsSilent: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (path: string, method?: string, body?: string) => Promise<RuntimeRequestResult>
  restartRuntime: () => Promise<void>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  probeModelProvider: (payload: ModelProviderProbeRequest) => Promise<ModelProviderProbeResult>
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
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  /** 在对话工作目录根下创建一个时间戳子目录作为新对话的工作目录。 */
  createConversationWorkspace: (root?: string) => Promise<ConversationWorkspaceCreateResult>
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
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  listUiPlugins: () => Promise<UiPluginListIpcResult>
  installUiPlugin: () => Promise<UiPluginInstallIpcResult>
  removeUiPlugin: (id: string) => Promise<{ ok: boolean }>
  loadUiPlugin: (id: string) => Promise<UiPluginLoadIpcResult>
  getKunConfigFile: () => Promise<DeepseekConfigFileResult>
  setKunConfigFile: (content: string) => Promise<DeepseekConfigSaveResult>
  openKunConfigDir: () => Promise<PathOpenResult>
  getGitBranches: (workspaceRoot: string) => Promise<GitBranchesResult>
  switchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createGitCheckpoint: (params: {
    workspaceRoot: string
    threadId: string
  }) => Promise<GitCheckpointCreateResult>
  restoreGitCheckpoint: (params: {
    checkpointId: string
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
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  readWorkspaceImage: (options: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>
  readWorkspacePdf: (options: WorkspaceFileTarget) => Promise<WorkspacePdfReadResult>
  readLocalPdfText: (options: LocalPdfTextTarget) => Promise<LocalPdfTextReadResult>
  saveWorkspaceFileAs: (payload: WorkspaceFileSaveAsPayload) => Promise<WorkspaceFileSaveAsResult>
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  createWorkspaceFile: (payload: WorkspaceFileCreatePayload) => Promise<WorkspaceFileCreateResult>
  createWorkspaceDirectory: (
    payload: WorkspaceDirectoryCreatePayload
  ) => Promise<WorkspaceDirectoryCreateResult>
  saveWorkspaceClipboardImage: (
    payload: WorkspaceClipboardImageSavePayload
  ) => Promise<WorkspaceClipboardImageSaveResult>
  pickWorkspaceImage: (payload: WorkspaceImagePickPayload) => Promise<WorkspaceImagePickResult>
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
  exportDesignPrototype: (payload: DesignExportPayload) => Promise<DesignExportResult>
  copyWriteDocumentAsRichText: (
    payload: WriteRichClipboardPayload
  ) => Promise<WriteRichClipboardResult>
  startSse: (threadId: string, sinceSeq: number, streamId?: string) => Promise<{ streamId: string }>
  stopSse: (streamId: string) => Promise<boolean>
  onSseEvent: (handler: (payload: SseEventPayload) => void) => () => void
  onSseEnd: (handler: (payload: SseEndPayload) => void) => () => void
  onSseError: (handler: (payload: SseErrorPayload) => void) => () => void
  onClawChannelActivity: (handler: (payload: ClawChannelActivityPayload) => void) => () => void
  onTrayAction: (handler: (payload: TrayActionPayload) => void) => () => void
  onRuntimeStatus: (handler: (payload: KunRuntimeStatusPayload) => void) => () => void
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
