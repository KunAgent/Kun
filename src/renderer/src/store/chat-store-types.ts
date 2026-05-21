import type {
  AgentProviderId,
  ChatBlock,
  NormalizedThread,
  RuntimeConnectionStatus,
  UserInputAnswer
} from '../agent/types'
import type {
  ClawImAgentProfileV1,
  ClawImChannelV1,
  ClawImPlatformCredentialV1,
  ClawImProvider,
  ClawImSettingsV1,
  ClawModel
} from '@shared/app-settings'

export type QueuedUserMessage = {
  id: string
  text: string
  mode?: string
  model?: string
  modelLabel?: string
}

export type SendMessageOverrides = {
  queued?: QueuedUserMessage
}

export type InitialSetupMode = 'required' | 'preview'
export type SettingsRouteSection = 'general' | 'agents' | 'skill' | 'mcp' | 'claw'
export type AppRoute = 'chat' | 'settings' | 'plugins' | 'claw'
export type PluginHostRoute = 'chat' | 'claw'

export type ChatState = {
  route: AppRoute
  pluginHostRoute: PluginHostRoute
  settingsSection: SettingsRouteSection
  initialSetupOpen: boolean
  initialSetupMode: InitialSetupMode
  providerId: AgentProviderId
  workspaceRoot: string
  workspaceLabel: string
  runtimeConnection: RuntimeConnectionStatus
  threads: NormalizedThread[]
  activeThreadId: string | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  lastSeq: number
  busy: boolean
  error: string | null
  runtimeErrorDetail: string | null
  currentTurnId: string | null
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  inspectorSelectedId: string | null
  composerModel: string
  composerPickList: string[]
  queuedMessages: QueuedUserMessage[]
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  clawChannels: ClawImChannelV1[]
  activeClawChannelId: string
  appendLocalClawTurn: (userText: string, replyText: string) => void
  setError: (message: string | null) => void
  setComposerModel: (modelId: string) => void
  loadComposerModels: () => Promise<void>
  setRoute: (r: AppRoute) => void
  openSettings: (section?: SettingsRouteSection) => void
  openPlugins: (host?: PluginHostRoute) => void
  openClaw: () => void
  refreshClawChannels: () => Promise<void>
  addClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1,
    options?: {
      channelId?: string
      model?: ClawModel
      workspaceRoot?: string
      enabled?: boolean
      im?: Partial<ClawImSettingsV1>
    }
  ) => Promise<void>
  selectClawChannel: (channelId: string) => Promise<void>
  selectClawConversation: (channelId: string, threadId: string) => Promise<void>
  deleteClawChannel: (channelId: string) => Promise<void>
  resetClawChannelSession: (channelId: string) => Promise<void>
  setClawChannelModel: (channelId: string, model: string) => Promise<void>
  openInitialSetup: (mode?: InitialSetupMode) => void
  closeInitialSetup: () => void
  boot: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  chooseWorkspace: (options?: { createThreadAfter?: boolean }) => Promise<string | null>
  clearWorkspace: () => Promise<void>
  deleteWorkspace: (workspacePath: string) => Promise<void>
  refreshThreads: () => Promise<void>
  createThread: (options?: { workspaceRoot?: string }) => Promise<void>
  selectThread: (id: string) => Promise<void>
  recoverActiveTurn: () => Promise<boolean>
  sendMessage: (text: string, mode?: string, overrides?: SendMessageOverrides) => Promise<boolean>
  drainQueuedMessages: () => Promise<void>
  removeQueuedMessage: (id: string) => void
  rewindAndResend: (userBlockId: string, newText: string) => Promise<void>
  interrupt: () => Promise<void>
  renameActiveThread: (title: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  selectInspectorItem: (id: string | null) => void
  applyI18nFromSettings: (locale: 'en' | 'zh') => Promise<void>
  reloadUiSettings: () => Promise<void>
}

export type ChatStoreSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)
) => void

export type ChatStoreGet = () => ChatState
