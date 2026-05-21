import type {
  AppSettingsPatch,
  AppSettingsV1,
  ClawRunResult,
  ClawTaskFromTextResult,
  ClawRuntimeStatus
} from './app-settings'
import type { DeepseekUpdateInfo, DeepseekUpdateInstallResult } from './deepseek-update'
import type { EditorListResult, EditorOpenResult, OpenEditorPathOptions } from './editor'
import type { GitBranchesResult } from './git-branches'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from './gui-update'
import type {
  TerminalCreateOptions,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalInputPayload,
  TerminalLifecyclePayload,
  TerminalResizePayload
} from './terminal-session'
import type {
  WorkspaceFileReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget
} from './workspace-file'

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }
export type WorkspacePickResult = { canceled: boolean; path: string | null }
export type PathOpenResult = { ok: boolean; message?: string }
export type SkillSaveResult = { ok: true; path: string } | { ok: false; message: string }
export type DeepseekConfigFileResult = { path: string; content: string; exists: boolean }
export type DeepseekConfigSaveResult = { ok: true; path: string }
export type DeepseekRuntimeDiagnosticIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  title: string
  message: string
  path?: string
  line?: number
}
export type DeepseekRuntimeDiagnosticsResult = {
  checkedAt: string
  settings: {
    port: number
    autoStart: boolean
    binaryPath: string
    baseUrl: string
    approvalPolicy: string
    sandboxMode: string
    hasApiKey: boolean
    hasRuntimeToken: boolean
  }
  binary: { ok: true; path: string } | { ok: false; message: string }
  config: {
    path: string
    exists: boolean
    content: string
    issues: DeepseekRuntimeDiagnosticIssue[]
  }
  runtime: {
    baseUrl: string
    portOwner: {
      pid: number
      command: string
      parentPid: number | null
      parentCommand: string | null
    } | null
    health: { ok: boolean; status: number; body: string; message?: string }
    threadApi: { ok: boolean; status: number; body: string; message?: string } | null
  }
  issues: DeepseekRuntimeDiagnosticIssue[]
}
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
  | { ok: true; modelIds: string[] }
  | { ok: false; message: string }
export type ClawImInstallQrResult =
  | { ok: true; url: string; deviceCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }
export type ClawImInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: false; error?: string }
export type DeepseekSpawnResult = {
  started: boolean
  healthy: boolean
  pid?: boolean
  error?: string
  message?: string
}
export type SseEventPayload = { streamId: string; data: unknown }
export type SseEndPayload = { streamId: string }
export type SseErrorPayload = { streamId: string; status?: number; message?: string }

export type DsGuiApi = {
  platform: string
  getSettings: () => Promise<AppSettingsV1>
  setSettings: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  runtimeRequest: (path: string, method?: string, body?: string) => Promise<RuntimeRequestResult>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawStatus: () => Promise<ClawRuntimeStatus>
  runClawTask: (taskId: string) => Promise<ClawRunResult>
  startClawImInstallQr: (
    provider: 'feishu',
    options?: { isLark?: boolean }
  ) => Promise<ClawImInstallQrResult>
  pollClawImInstall: (
    provider: 'feishu',
    deviceCode: string
  ) => Promise<ClawImInstallPollResult>
  deepseekSpawnIfNeeded: () => Promise<DeepseekSpawnResult>
  prepareDeepseekBinary: () => Promise<{ ok: true; path: string } | { ok: false; message: string }>
  checkDeepseekUpdate: () => Promise<DeepseekUpdateInfo>
  installDeepseekUpdate: () => Promise<DeepseekUpdateInstallResult>
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  saveSkillFile: (rootPath: string, skillName: string, content: string) => Promise<SkillSaveResult>
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  getDeepseekConfigFile: () => Promise<DeepseekConfigFileResult>
  setDeepseekConfigFile: (content: string) => Promise<DeepseekConfigSaveResult>
  openDeepseekConfigDir: () => Promise<PathOpenResult>
  diagnoseDeepseekRuntime: () => Promise<DeepseekRuntimeDiagnosticsResult>
  getGitBranches: (workspaceRoot: string) => Promise<GitBranchesResult>
  switchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  listEditors: () => Promise<EditorListResult>
  openEditorPath: (options: OpenEditorPathOptions) => Promise<EditorOpenResult>
  createTerminalSession: (options: TerminalCreateOptions) => Promise<TerminalCreateResult>
  writeTerminalSession: (payload: TerminalInputPayload) => Promise<boolean>
  resizeTerminalSession: (payload: TerminalResizePayload) => Promise<boolean>
  closeTerminalSession: (payload: TerminalLifecyclePayload) => Promise<boolean>
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => () => void
  onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => () => void
  resolveWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  startSse: (threadId: string, sinceSeq: number, streamId?: string) => Promise<{ streamId: string }>
  stopSse: (streamId: string) => Promise<boolean>
  onSseEvent: (handler: (payload: SseEventPayload) => void) => () => void
  onSseEnd: (handler: (payload: SseEndPayload) => void) => () => void
  onSseError: (handler: (payload: SseErrorPayload) => void) => () => void
  onClawChannelActivity: (handler: (payload: ClawChannelActivityPayload) => void) => () => void
  mirrorClawChannelMessageToFeishu: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<ClawChannelMirrorResult>
  createClawTaskFromText: (
    text: string,
    options?: { channelId?: string; modelHint?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ClawTaskFromTextResult>
  openExternal: (url: string) => Promise<void>
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
}
