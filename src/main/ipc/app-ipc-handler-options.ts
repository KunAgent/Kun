import type { BrowserWindow } from 'electron'
import type { AppSettingsPatch, AppSettingsV1 } from '../../shared/app-settings'
import type {
  ClawImInstallPollResult,
  ClawImInstallQrResult,
  CredentialRecoveryResetResult,
  KunRuntimeSettingsSyncStatusPayload,
  RuntimeRequestResult,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult
} from '../../shared/kun-gui-api'
import type { GuiUpdateState } from '../../shared/gui-update'
import type { JsonSettingsStore } from '../settings-store'
import type { ClawRuntime } from '../claw-runtime'
import type { ScheduleRuntime } from '../schedule-runtime'
import type { DaemonRuntime } from '../daemon-runtime'
import type { WorkflowRuntime } from '../workflow-runtime'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'
import type { WorkspacePreviewProtocolRegistry } from '../services/workspace-preview-protocol'

type GuiUpdaterModule = typeof import('../gui-updater')

export type ProtectedRuntimeRequestLease = Readonly<{
  runtimeToken: string
  request: (
    path: string,
    method?: string,
    body?: string,
    headers?: Record<string, string>
  ) => Promise<RuntimeRequestResult>
}>

export type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  withRegistryCredentials?: (
    settings: AppSettingsV1,
    providerIds?: readonly string[]
  ) => Promise<AppSettingsV1>
  getMainWindow: () => BrowserWindow | null
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  saveSettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  resetUnreadableCredentials: () => Promise<CredentialRecoveryResetResult>
  runtimeRequest: (
    path: string,
    method?: string,
    body?: string,
    headers?: Record<string, string>
  ) => Promise<RuntimeRequestResult>
  acquireRuntimeRequestLease: () => Promise<ProtectedRuntimeRequestLease>
  getRuntimeSettingsSyncStatus: () => KunRuntimeSettingsSyncStatusPayload
  restartRuntime: () => Promise<void>
  restartKunServe: () => Promise<void>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getClawRuntime: () => ClawRuntime | null
  getScheduleRuntime: () => ScheduleRuntime | null
  getDaemonRuntime: () => DaemonRuntime | null
  getWorkflowRuntime: () => WorkflowRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ClawImInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ClawImInstallPollResult>
  startWeixinInstallQrcode: (weixinBridgeUrl?: string) => Promise<ClawImInstallQrResult>
  pollWeixinInstall: (deviceCode: string, weixinBridgeUrl?: string) => Promise<ClawImInstallPollResult>
  resolveKunConfigPath: () => string
  resolveSettingsConfigPath: () => string
  onKunMcpConfigWritten?: (path: string, content: string) => Promise<void> | void
  onKunProjectConfigChanged?: (path: string, content: string) => Promise<void> | void
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  readGuiUpdateState: () => Promise<GuiUpdateState>
  loadGuiUpdaterModule: () => Promise<GuiUpdaterModule>
  resolveLogDirectory: () => string
  logError: (category: string, message: string, detail?: unknown) => void
  logInfo?: (category: string, message: string, detail?: unknown) => void
  nativeDialogs?: NativeDialogCoordinator
  workspacePreviewProtocols: WorkspacePreviewProtocolRegistry
}
