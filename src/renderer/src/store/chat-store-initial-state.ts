import {
  mergeComposerPickList,
  readStoredComposerFastMode,
  readStoredComposerPersonaId,
  readStoredComposerMode
} from './chat-store-helpers'
import { defaultConversationWorkspaceRoot } from '../lib/workspace-path'
import { readRemovedCodeWorkspaces } from '../lib/removed-code-workspaces'
import { readProtectedSurfaceRestore } from '../extensions/protected-surface-session'

import { readUnreadCompletions } from './unread-completions'

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
    // Hydrate hidden projects at store creation so the first sidebar render
    // already excludes them (no flash from the local thread cache).
    removedCodeWorkspaces: readRemovedCodeWorkspaces(),
    threads: [],
    threadListStatus: 'idle' as const,
    threadListError: null,
    threadListCursorByWorkspace: {},
    knowledgeBaseStatuses: {},
    threadSearch: '',
    showArchivedThreads: false,
    activeThreadId: null,
    threadLoadingId: null,
    threadRefreshingId: null,
    threadHistoryCursor: null,
    threadHasMoreHistory: false,
    threadHistoryLoading: false,
    lastCodeThreadId: null,
    activeThreadRelation: null,
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    lastContextSnapshot: null,
    lastDelegatedRuntimeState: null,
    lastTurnUsage: null,
    turnTimingMetrics: new Map(),
    busy: false,
    busyUnconfirmed: false,
    error: null,
    runtimeErrorDetail: null,
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    currentTurnStartedAtMs: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    composerMode: readStoredComposerMode(),
    // The workbench execution-settings hook mirrors runtime settings here
    // once loaded; null keeps sends on the runtime defaults until then.
    composerExecutionSettings: null,
    composerOrchestration: 'direct' as const,
    graphEnabled: false,
    composerModel: '',
    composerProviderId: '',
    composerReasoningEffort: 'max' as const,
    composerFastMode: readStoredComposerFastMode(),
    composerAgentId: '',
    composerPersonaId: readStoredComposerPersonaId(),
    composerPersonaEnabled: true,
    composerPickList: mergeComposerPickList(false, []),
    composerModelGroups: [],
    disabledSkillIds: [],
    codeAgentPresets: [],
    queuedMessages: [],
    extensionComposerContexts: [],
    watchTurnCompletion: {},
    awaitingUserInputThreadIds: {},
    unreadThreadIds: readUnreadCompletions(),
    scheduledThreadActivities: {},
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    clawChannels: [],
    activeClawChannelId: ''
  }
}
