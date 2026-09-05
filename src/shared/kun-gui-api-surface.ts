import type {
  AppSettingsPatch,
  AppSettingsV1,
  ClawRunResult,
  ClawImTelegramProxyV1,
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
  ScheduleTaskCreateInput,
  ScheduleTaskDeleteResult,
  ScheduleTaskMutationResult,
  ScheduleTaskUpdateInput,
  ScheduleTaskFromTextResult,
  WorkflowApprovalDecision,
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowNodeTestResult,
  WorkflowRunResult,
  WorkflowRuntimeStatus
} from './app-settings'
import type { DesktopTitleBarMode } from './desktop-title-bar'
import type {
  BuiltinGitHubMcpAuthorizationConfirmation,
  BuiltinGitHubMcpAuthorizationPreflight,
  BuiltinGitHubMcpAuthorizationResult,
  BuiltinGitHubMcpLoginResult
} from './github-mcp-authorization'
import type { DesktopStartupStatePayload } from './desktop-startup-state'
import type { EditorListResult, EditorOpenResult, OpenEditorPathOptions } from './editor'
import type { GitBranchesResult, GitBranchWorktreesResult, GitWorktreeCheckoutResult } from './git-branches'
import type { GitCheckpointCreateResult, GitCheckpointRestoreResult } from './git-checkpoint'
import type { MergeResult, SyncResult, WorktreeChanges, WorktreeInfo, WorktreePoolStatus } from './worktree'
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
import type { RuntimeRequestIpcApi } from './kun-gui-api-runtime-request'
import type { RuntimeDataRecoveryApi } from './runtime-data-recovery'
import type { ProviderAuthApi } from './kun-gui-api-provider-auth'
import type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from './kun-gui-api-protected-approval'
import type { ProviderMutationFlushRequestHandler } from './provider-mutation-barrier'
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
  LocalOfficeDocumentTarget,
  WorkspaceOfficePreviewResult,
  WorkspaceOfficePreviewTarget,
  WorkspaceOfficeSemanticResult,
  WorkspaceOfficeSemanticTarget
} from './office-document'
import type {
  WorkspaceSpreadsheetConvertPayload,
  WorkspaceSpreadsheetConvertResult,
  WorkspaceSpreadsheetSavePayload,
  WorkspaceSpreadsheetSaveResult
} from './workspace-spreadsheet'
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
import type { WriteDocumentSha256Request, WriteDocumentSha256Result } from './write-document-sha256'
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
import type { RemoteSshApi } from './remote-ssh'
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
import type { RuntimeDocumentAttachmentUploadRequest, RuntimeDocumentAttachmentUploadResult } from './runtime-document-attachment'
import type { CliInstallAction, CliInstallResult, CliInstallStatus } from './cli-install'
import type { ProviderQuotaListResult } from './provider-quota'
import type {
  DevPreviewCaptureRequest,
  DevPreviewCaptureResult
} from './dev-preview-capture'
import {
  AlertDialogOptions,
  AntigravitySubscriptionModelCatalog,
  AppBadgeCountResult,
  ClaudeSubscriptionLoginResult,
  ClaudeSubscriptionProbeResult,
  ClaudeSubscriptionStatus,
  ClawChannelActivityPayload,
  ClawChannelMirrorResult,
  ClawImInstallPollResult,
  ClawImInstallQrResult,
  ClawImTelegramConnectResult,
  ComputerUsePermissionKind,
  ComputerUsePermissions,
  ConfirmDialogOptions,
  ConversationWorkspaceCreateResult,
  CredentialRecoveryResetResult,
  CursorSubscriptionModel,
  DeepseekConfigFileResult,
  DeepseekConfigSaveResult,
  DesktopCommand,
  ExtensionArtifactActionPayload,
  ExtensionArtifactActionResult,
  GrokBrowserAuthCancelResult,
  GrokBrowserAuthResult,
  KunProjectConfigFileResult,
  KunRuntimeSettingsSyncStatusPayload,
  KunRuntimeStatusPayload,
  LegacySessionDetectResult,
  LegacySessionImportResult,
  LocalFilesPickResult,
  ModelProviderCredentialRevealResult,
  ModelProviderProbeRequest,
  ModelProviderProbeResult,
  ModelsDevCatalogRequest,
  ModelsDevCatalogResult,
  PathOpenResult,
  PromptOptimizationRequest,
  PromptOptimizationResult,
  GatewayCredentialResult,
  SdkDownloadState,
  SkillGithubImportResult,
  SkillListResult,
  SkillRootListResult,
  SkillSaveResult,
  KunGuiSseSurface,
  SystemNotificationResult,
  TrayActionPayload,
  TurnCompleteNotificationPayload,
  UiPluginInstallIpcResult,
  UiPluginListIpcResult,
  UiPluginLoadIpcResult,
  UiPluginThemeActivateIpcResult,
  UiPluginThemeDeactivateIpcResult,
  UpstreamModelsResult,
  WorkspaceCreationTimeEntry,
  WorkspacePickResult
} from './kun-gui-api-contracts'
export type KunGuiApi = ExtensionIpcApi & RemoteSshApi & ProviderAuthApi & RuntimeRequestIpcApi & KunGuiSseSurface & {
  platform: string
  /** Immutable mode selected before the BrowserWindow and renderer are created. */
  desktopTitleBarMode: DesktopTitleBarMode
  homeDir: string
  /** Immutable process identity selected before Electron profile locking. */
  appEnvironment: import('./app-environment').AppEnvironmentInfo
  /** Desktop startup phase exposed only to the trusted workbench shell. */
  startup: {
    getState: () => Promise<DesktopStartupStatePayload>
    onState: (handler: (payload: DesktopStartupStatePayload) => void) => () => void
  }
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
  /** In-app uninstall: optional full local-data removal and app self-removal. */
  uninstall: UninstallApi
  /** One-time, path-opaque Runtime migration recovery surface. */
  runtimeDataRecovery: RuntimeDataRecoveryApi
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
  /** Opens the fixed Manager-owned settings document in the system editor. */
  openSettingsConfigFile: () => Promise<PathOpenResult>
  /** Reveal one protected provider credential after an explicit trusted-workbench action. */
  revealModelProviderCredential: (providerId: string) => Promise<ModelProviderCredentialRevealResult>
  resetUnreadableCredentials: () => Promise<CredentialRecoveryResetResult>
  cliInstallStatus: () => Promise<CliInstallStatus>
  cliInstallAction: (action: CliInstallAction) => Promise<CliInstallResult>
  /** Detect an existing local Claude Code login (subscription auth). */
  claudeSubscriptionStatus: () => Promise<ClaudeSubscriptionStatus>
  /** Run the official ambient Claude subscription login flow. */
  claudeSubscriptionLogin: () => Promise<ClaudeSubscriptionLoginResult>
  /** Make a bounded real request through the official Claude transport. */
  claudeSubscriptionProbe: (token?: string, providerId?: string) => Promise<ClaudeSubscriptionProbeResult>
  /** List Claude models available to the subscription (via the SDK's supportedModels). */
  claudeSubscriptionModels: (token?: string, providerId?: string) => Promise<string[]>
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
  cursorSubscriptionDiscover: (apiKey?: string, providerId?: string) => Promise<{
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
  gatewayCredential: (action: 'status' | 'ensure' | 'copy' | 'rotate' | 'revoke') => Promise<GatewayCredentialResult>
  getRuntimeSettingsSyncStatus: () => Promise<KunRuntimeSettingsSyncStatusPayload>
  uploadRuntimeImageAttachment: (
    request: RuntimeImageAttachmentUploadRequest
  ) => Promise<RuntimeImageAttachmentUploadResult>
  uploadRuntimeDocumentAttachment: (request: RuntimeDocumentAttachmentUploadRequest) => Promise<RuntimeDocumentAttachmentUploadResult>
  captureDevPreviewRegion: (
    request: DevPreviewCaptureRequest
  ) => Promise<DevPreviewCaptureResult>
  readLocalOfficeDocument: (
    options: LocalOfficeDocumentTarget
  ) => Promise<LocalOfficeDocumentReadResult>
  readWorkspaceOfficePreview: (
    options: WorkspaceOfficePreviewTarget
  ) => Promise<WorkspaceOfficePreviewResult>
  readWorkspaceOfficeSemantic: (
    options: WorkspaceOfficeSemanticTarget
  ) => Promise<WorkspaceOfficeSemanticResult>
  saveWorkspaceSpreadsheet: (
    payload: WorkspaceSpreadsheetSavePayload
  ) => Promise<WorkspaceSpreadsheetSaveResult>
  convertWorkspaceSpreadsheet: (
    payload: WorkspaceSpreadsheetConvertPayload
  ) => Promise<WorkspaceSpreadsheetConvertResult>
  resolveKunApproval: (request: KunProtectedApprovalRequest) => Promise<KunProtectedApprovalResult>
  restartRuntime: () => Promise<void>
  restartKunServe: () => Promise<{ accepted: boolean; error?: string }>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  probeModelProvider: (payload: ModelProviderProbeRequest) => Promise<ModelProviderProbeResult>
  listProviderQuotas: () => Promise<ProviderQuotaListResult>
  fetchModelsDevCatalog: (payload: ModelsDevCatalogRequest) => Promise<ModelsDevCatalogResult>
  optimizePrompt: (payload: PromptOptimizationRequest) => Promise<PromptOptimizationResult>
  getClawStatus: () => Promise<ClawRuntimeStatus>
  runClawTask: (taskId: string) => Promise<ClawRunResult>
  getScheduleStatus: () => Promise<ScheduleRuntimeStatus>
  onScheduleStatusChanged: (handler: (status: ScheduleRuntimeStatus) => void) => () => void
  createScheduleTask: (payload: ScheduleTaskCreateInput) => Promise<ScheduleTaskMutationResult>
  updateScheduleTask: (payload: ScheduleTaskUpdateInput) => Promise<ScheduleTaskMutationResult>
  deleteScheduleTask: (taskId: string) => Promise<ScheduleTaskDeleteResult>
  runScheduleTask: (taskId: string) => Promise<ScheduleRunResult>
  getDaemonStatus: () => Promise<DaemonRuntimeStatus>
  restartDaemon: (daemonId: string) => Promise<DaemonActionResult>
  readDaemonLogs: (payload: { id: string; cursor?: string; limit?: number }) => Promise<DaemonLogPage>
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
    allowedChatIds?: string,
    proxy?: ClawImTelegramProxyV1
  ) => Promise<ClawImTelegramConnectResult>
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
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  listUiPlugins: () => Promise<UiPluginListIpcResult>
  installUiPlugin: () => Promise<UiPluginInstallIpcResult>
  removeUiPlugin: (id: string) => Promise<{ ok: boolean }>
  loadUiPlugin: (id: string) => Promise<UiPluginLoadIpcResult>
  activateUiPluginTheme: (id: string) => Promise<UiPluginThemeActivateIpcResult>
  deactivateUiPluginTheme: () => Promise<UiPluginThemeDeactivateIpcResult>
  getKunConfigFile: () => Promise<DeepseekConfigFileResult>
  setKunConfigFile: (content: string) => Promise<DeepseekConfigSaveResult>
  preflightBuiltinGitHubMcpAuthorization: (host?: string) => Promise<BuiltinGitHubMcpAuthorizationPreflight>
  startBuiltinGitHubMcpLogin: (host?: string) => Promise<BuiltinGitHubMcpLoginResult>
  disableBuiltinGitHubMcp: () => Promise<{ disabled: true }>
  confirmBuiltinGitHubMcpAuthorization: (
    request: BuiltinGitHubMcpAuthorizationConfirmation
  ) => Promise<BuiltinGitHubMcpAuthorizationResult>
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
  getWorkspaceCreationTimes: (workspaceRoots: string[]) => Promise<WorkspaceCreationTimeEntry[]>
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
  readWriteDocumentSha256: (
    payload: WriteDocumentSha256Request
  ) => Promise<WriteDocumentSha256Result>
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
  getWindowMiniMode: () => Promise<boolean>
  onWindowMiniMode: (handler: (mini: boolean) => void) => () => void
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
  setAppBadgeCount: (count: number) => Promise<AppBadgeCountResult>
  getAppVersion: () => Promise<string>
  getGuiUpdateState: () => Promise<GuiUpdateState>
  checkGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateInfo>
  downloadGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateDownloadResult>
  installGuiUpdate: () => Promise<GuiUpdateInstallResult>
  onGuiUpdateState: (handler: (payload: GuiUpdateState) => void) => () => void
  onProviderMutationFlushRequest: (handler: ProviderMutationFlushRequestHandler) => () => void
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

export type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from './kun-gui-api-protected-approval'
