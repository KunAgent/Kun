import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import {
  applyChatContentMaxWidth,
  applyCursorSpotlight,
  applyCursorSpotlightColor,
  applyDarkUiColors,
  applyTheme,
  applyUiFontScale,
  applyWriteTypography
} from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import {
  showWorkspaceMissingDialog,
  workspaceDirectoryExists,
  workspaceMissingError
} from '../lib/workspace-availability'
import {
  isConversationWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../lib/workspace-path'
import { resolveProjectWorkspacePath } from '../lib/worktree-project-path'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import {
  codeRootsAfterRemoval,
  isCodeWorkspaceRemoved
} from './chat-store-navigation-workspace-removal'
import {
  effectiveCodeWorkspaceRoot,
  readRemovedCodeWorkspaces
} from '../lib/removed-code-workspaces'
import { buildClawRuntimePrompt } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import {
  activeClawChannel,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  rememberCodeWorkspaceRoots,
  rememberTurnModel,
  reconcileCodeWorkspaceRoots,
  saveCodeWorkspaceRoots
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  reconcileOptimisticUserBlock,
  threadLooksRunning,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteAssistantThread,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  DESIGN_ASSISTANT_THREAD_TITLE,
  activeDesignThreadForWorkspace,
  designDocKey,
  forgetDesignThread,
  isDesignThreadId,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
import { persistDesignChatMetaForDoc } from '../design/design-chat-transcript'
import {
  isSddAssistantThread,
  readSddThreadRegistry
} from '../sdd/sdd-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import { cacheEntriesToThreads, loadThreadListCache } from './thread-list-cache'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  completionNotificationDedupeKeyForWatchedThread,
  currentCompletionWatchToken,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeSidebarThread,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  notifyTurnComplete,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion,
  retainUnreadCompletions
} from './unread-completions'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let bootPromise: Promise<void> | null = null
let refreshThreadsGeneration = 0
let clawChannelActivityUnsubscribe: (() => void) | null = null
let runtimeStatusUnsubscribe: (() => void) | null = null
let trayActionUnsubscribe: (() => void) | null = null

export function createNavigationRuntimeActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'probeRuntime' | 'boot'> {
  return {
  probeRuntime: async (mode = 'user', options) => {
    const prev = get().runtimeConnection
    if (mode === 'user') {
      set((s) => ({
        runtimeConnection: 'checking',
        // While the runtime probe is in flight the thread inventory is
        // unknown; mark it loading so the sidebar never flashes the empty
        // state during the startup window.
        ...(s.threads.length === 0 ? { threadListStatus: 'loading' as const } : {})
      }))
    }
    try {
      if (typeof window.kunGui === 'undefined') {
        throw new Error(
          'Preload bridge missing (window.kunGui). Restart the app or check BrowserWindow preload path.'
        )
      }
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (options?.restart) {
        await rendererRuntimeClient.restartRuntime()
      }
      const p = getProvider()
      await p.connect()
      set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
      void get().loadComposerModels()
      if (prev !== 'ready' || mode === 'user') {
        try {
          await get().refreshThreads()
        } catch {
          /* refreshThreads sets state */
        }
      }
    } catch (e) {
      const msg = formatRuntimeError(e)
      const detail = runtimeErrorDetail(e)
      const needsSettings = shouldOpenSettingsForError(e)
      if (mode === 'user') {
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          threadListStatus: 'error',
          threadListError: msg,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      } else if (prev === 'ready') {
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          threadListStatus: 'error',
          threadListError: msg,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    }
  },

  boot: async () => {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      try {
        if (typeof window.kunGui === 'undefined') {
          set({
            error: formatRuntimeError(
              'Preload bridge missing (window.kunGui). Restart the app or check BrowserWindow preload path.'
            ),
            runtimeConnection: 'offline',
            runtimeErrorDetail: 'Preload bridge missing (window.kunGui). Restart the app or check BrowserWindow preload path.',
            initialSetupOpen: false,
            initialSetupMode: 'required'
          })
          return
        }
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        const removedRegistry = readRemovedCodeWorkspaces()
        const workspaceRoot = effectiveCodeWorkspaceRoot(settings.workspaceRoot, removedRegistry)
        if (settings.workspaceRoot && !workspaceRoot && typeof window.kunGui.setSettings === 'function') {
          void rendererRuntimeClient.setSettings({ workspaceRoot: '' }).catch(() => undefined)
        }
        const writeWorkspaceRoots = [
          settings.write.defaultWorkspaceRoot,
          settings.write.activeWorkspaceRoot,
          ...settings.write.workspaces
        ]
        // Load hidden projects before reconciling remembered roots: a removed
        // project must neither re-enter `codeWorkspaceRoots` nor keep its
        // persisted root through the preserved-root path.
        const codeWorkspaceRoots = codeRootsAfterRemoval(
          reconcileCodeWorkspaceRoots({
            currentRoots: readCodeWorkspaceRoots(),
            codeThreadWorkspaceRoots: [workspaceRoot],
            writeWorkspaceRoots,
            preservedWorkspaceRoots: workspaceRoot ? [workspaceRoot] : []
          }),
          removedRegistry
        )
        saveCodeWorkspaceRoots(codeWorkspaceRoots)
        const needsInitialSetup = settings.initialSetupCompleted !== true
        applyTheme(settings.theme)
        applyUiFontScale(settings.uiFontScale)
        applyChatContentMaxWidth(settings.chatContentMaxWidthPx)
        applyCursorSpotlight(settings.cursorSpotlight !== false)
        applyCursorSpotlightColor(settings.cursorSpotlightColor)
        applyDarkUiColors(settings.darkUiColors)
        if (settings.write?.typography) applyWriteTypography(settings.write.typography)
        await get().applyI18nFromSettings(settings.locale)
        if (!runtimeStatusUnsubscribe && typeof window.kunGui.onRuntimeStatus === 'function') {
          runtimeStatusUnsubscribe = window.kunGui.onRuntimeStatus((status) => {
            set({ runtimeStatus: status })
            if (status.state === 'restarting' || status.state === 'crashed') {
              set({ error: null, runtimeErrorDetail: null })
              return
            }
            if (status.state === 'failed' || status.state === 'stopped') {
              // Terminal states reuse the main error banner, which carries
              // the full diagnostics UI (details, log path, settings).
              set({ error: status.message ?? i18n.t('common:runtimeStatusFailed') })
              void get().probeRuntime('background')
              return
            }
            if (status.state === 'running') {
              void get().probeRuntime('background')
              if (status.rolledBack) {
                // On-disk settings were restored by the rollback; refresh the cache.
                void rendererRuntimeClient.getSettings({ forceRefresh: true }).catch(() => null)
              }
            }
          })
        }
        if (!trayActionUnsubscribe && typeof window.kunGui.onTrayAction === 'function') {
          trayActionUnsubscribe = window.kunGui.onTrayAction((action) => {
            set({ route: 'chat' })
            if (action.type === 'open-thread') {
              void get().selectThread(action.threadId)
            } else {
              void get().createThread({ forceNew: true })
            }
          })
        }
        if (!clawChannelActivityUnsubscribe && typeof window.kunGui.onClawChannelActivity === 'function') {
          clawChannelActivityUnsubscribe = window.kunGui.onClawChannelActivity(({ channelId, threadId }) => {
            void (async () => {
              const state = get()
              if (typeof window.kunGui === 'undefined') return
              const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
              const channels = settings.claw.channels
              const activeChannelId = channels.some(
                (channel) => channel.id === state.activeClawChannelId && channel.enabled
              )
                ? state.activeClawChannelId
                : channels.find((channel) => channel.enabled)?.id ?? ''
              set({
                disabledSkillIds: settings.disabledSkillIds,
                codeAgentPresets: settings.codeAgentPresets,
                clawChannels: channels,
                activeClawChannelId: activeChannelId
              })
              void get().refreshThreads()
              if (state.route === 'claw' && state.activeClawChannelId === channelId) {
                if (state.activeThreadId !== threadId) {
                  // Live-only SSE: skip the HTTP getThreadDetail fetch so the
                  // chat view sees the Feishu bot's deltas as they arrive.
                  // The first explicit click on this thread will fall through
                  // to selectThread and pull the persisted blocks.
                  await get().subscribeThreadEventsLive(threadId)
                } else {
                  await get().recoverActiveTurn()
                }
              }
            })()
          })
        }
        const stateBeforeBootCommit = get()
        set({
          route: stateBeforeBootCommit.route === 'settings' ? 'settings' : 'chat',
          initialSetupOpen: needsInitialSetup || stateBeforeBootCommit.initialSetupOpen,
          initialSetupMode: 'required',
          workspaceRoot,
          codeWorkspaceRoots,
          removedCodeWorkspaces: removedRegistry,
          workspaceLabel: workspaceLabelFromPath(workspaceRoot),
          conversationWorkspaceRoot: settings.conversationWorkspaceRoot || '',
          disabledSkillIds: settings.disabledSkillIds,
          codeAgentPresets: settings.codeAgentPresets,
          graphEnabled: settings.agents.kun.graph?.enabled === true,
          composerOrchestration:
            settings.agents.kun.graph?.enabled === true &&
            settings.agents.kun.graph.defaultStrategy === 'graph'
              ? 'graph'
              : 'direct',
          clawChannels: settings.claw.channels,
          activeClawChannelId: settings.claw.channels.find((channel) => channel.enabled)?.id ?? '',
          runtimeConnection: needsInitialSetup ? 'idle' : get().runtimeConnection,
          error: needsInitialSetup ? null : get().error,
          runtimeErrorDetail: needsInitialSetup ? null : get().runtimeErrorDetail
        })
        if (needsInitialSetup) return
        // First-paint placeholder: hydrate the sidebar from the local summary
        // cache immediately so it never shows an empty state while the runtime
        // probe + first inventory refresh are still in flight. The status stays
        // `refreshing` (never `ready`) until the authoritative refresh commits.
        if (get().threads.length === 0) {
          const cached = loadThreadListCache()
          if (cached.length > 0) {
            set((s) => ({
              ...(s.threads.length === 0 ? { threads: cacheEntriesToThreads(cached) } : {}),
              threadListStatus: s.threads.length === 0 ? 'refreshing' : s.threadListStatus
            }))
          }
        }
        scheduleStartupRuntimeProbe(get)
      } catch (e) {
        set({
          error: formatRuntimeError(e),
          runtimeErrorDetail: runtimeErrorDetail(e),
          runtimeConnection: 'offline',
          initialSetupOpen: false,
          initialSetupMode: 'required',
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    })().finally(() => {
      bootPromise = null
    })
    return bootPromise
  },
  }
}
