import {
  mergeComposerPickList,
  readStoredComposerMode
} from './chat-store-helpers'
import { defaultConversationWorkspaceRoot } from '../lib/workspace-path'
import { readProtectedSurfaceRestore } from '../extensions/protected-surface-session'

export function createInitialChatStoreState(workingDirectoryLabel: string) {
  const protectedSurfaceRestore = readProtectedSurfaceRestore()
  return {
    route: (protectedSurfaceRestore === 'settings' ? 'settings' : 'chat') as 'settings' | 'chat',
    settingsReturnRoute: 'chat' as const,
    pluginHostRoute: 'chat' as const,
    settingsSection: 'general' as const,
    initialSetupOpen: protectedSurfaceRestore === 'initial-setup',
    initialSetupMode: 'required' as const,
    workspaceRoot: '',
    conversationWorkspaceRoot: defaultConversationWorkspaceRoot(),
    workspaceLabel: workingDirectoryLabel,
    runtimeConnection: 'idle' as const,
    runtimeStatus: null,
    codeWorkspaceRoots: [],
    threads: [],
    threadSearch: '',
    showArchivedThreads: false,
    activeThreadId: null,
    activeThreadRelation: null,
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    lastTurnUsage: null,
    busy: false,
    error: null,
    runtimeErrorDetail: null,
    currentTurnId: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    composerMode: readStoredComposerMode(),
    composerModel: '',
    composerProviderId: '',
    composerAgentId: '',
    composerPickList: mergeComposerPickList(false, []),
    composerModelGroups: [],
    disabledSkillIds: [],
    queuedMessages: [],
    extensionComposerContexts: [],
    watchTurnCompletion: {},
    unreadThreadIds: {},
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    clawChannels: [],
    activeClawChannelId: ''
  }
}
