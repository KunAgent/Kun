import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { loadThreadStates } from '../agent/thread-state-loader'
import type { ThreadRuntimeState } from '../agent/provider-types'
import i18n from '../i18n'
import {
  applyChatContentMaxWidth,
  applyCursorSpotlight,
  applyCursorSpotlightColor,
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
import { preserveListedDesignProfiles } from '../design/design-locked-profile'
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
import { withNativeDialog } from '../lib/native-dialog-activity'
import { pendingDesignDocumentClones } from '../design/design-document-clone-registry'
import { reconcilePendingDesignDocumentClones } from '../design/design-document-fork'
import {
  DESIGN_ASSISTANT_THREAD_TITLE,
  activeDesignThreadForWorkspace,
  designDocKey,
  forgetDesignThread,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from '../design/design-thread-registry'
import { isLegacyDesignWorkbenchThread } from '../design/design-task-classification'
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
import { saveThreadListCache } from './thread-list-cache'
import { scheduleRecentThreadPrewarm } from './thread-detail-prewarm'
import {
  loadMoreThreads as loadMoreThreadsAction,
  mergeThreadPages,
  reconcileWorkspaceThreadPages,
  threadPageMode,
  THREAD_LIST_FIRST_PAGE_SIZE
} from './chat-store-thread-pagination'
import {
  collectRunningWatchTargets,
  normalizeListedThreadActivity
} from './chat-store-thread-activity-reconcile'
import {
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
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
  completionOutcomeForTurnStatus,
  completionIsCurrentlyVisible,
  markUnreadCompletion,
  retainUnreadCompletions
} from './unread-completions'
import { threadRefreshSelection } from './chat-store-thread-refresh-selection'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

export function createNavigationWorkspaceActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'chooseWorkspace' | 'selectWorkspaceRoot' | 'clearWorkspace' | 'deleteWorkspace' | 'refreshThreads' | 'loadMoreThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  let refreshInFlight = false
  return {
  loadMoreThreads: (workspacePath) => loadMoreThreadsAction(workspacePath, set, get),
  chooseWorkspace: async ({ createThreadAfter = false, selectThreadAfter = true } = {}) => {
    try {
      const wasWriteRoute = get().route === 'write'
      if (typeof window.kunGui === 'undefined' || typeof window.kunGui.pickWorkspaceDirectory !== 'function') {
        throw new Error(i18n.t('common:workspacePickerUnavailable'))
      }
      const pickWorkspaceDirectory = window.kunGui.pickWorkspaceDirectory
      const picked = await withNativeDialog(() =>
        pickWorkspaceDirectory(get().workspaceRoot || undefined))
      if (picked.canceled || !picked.path) {
        if (createThreadAfter) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
        }
        return null
      }
      // 拒绝把对话工作目录下的文件夹当作项目加入:对话文件夹会被持续自动管理,
      // 建议用户先拷贝到其他位置再加入。
      const conversationRoot = get().conversationWorkspaceRoot
      if (isConversationWorkspacePath(picked.path, conversationRoot)) {
        set({ error: i18n.t('common:workspaceInsideConversationDir') })
        return null
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: picked.path })
      const workspaceRoot = normalizeWorkspaceRoot(next.workspaceRoot)
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])

      set({
        workspaceRoot,
        codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        error: null
      })
      await get().refreshThreads()
      if (workspaceRoot) {
        if (!selectThreadAfter) return workspaceRoot
        if (wasWriteRoute) {
          await get().openWrite()
          return workspaceRoot
        }
        const workspaceThreads = get().threads
          .filter((thread) => isCodeThread(thread, get().clawChannels))
          .filter((thread) => threadBelongsToWorkspace(thread, workspaceRoot))
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

        if (createThreadAfter || workspaceThreads.length === 0) {
          await get().createThread({ workspaceRoot })
        } else {
          const targetThreadId = workspaceThreads[0]?.id
          if (targetThreadId && get().activeThreadId !== targetThreadId) {
            await get().selectThread(targetThreadId)
          }
        }
      }
      return workspaceRoot
    } catch (e) {
      set({
        error: formatWorkspacePickerError(e)
      })
      return null
    }
  },

  // Switch the active working directory to an already-known workspace (no native
  // picker). Persists the choice and lands on a clean new-conversation state for
  // that directory — typing then starts a fresh thread there. This backs the
  // workspace picker shown beneath the composer.
  selectWorkspaceRoot: async (workspaceRoot) => {
    const normalized = normalizeWorkspaceRoot(workspaceRoot)
    if (!normalized) return null
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    // 拒绝把对话工作目录下的文件夹切换为当前项目目录(同 chooseWorkspace 守卫)。
    if (isConversationWorkspacePath(normalized, get().conversationWorkspaceRoot)) {
      set({ error: i18n.t('common:workspaceInsideConversationDir') })
      return null
    }
    // Already on this directory with an empty composer — nothing to switch.
    if (normalizeWorkspaceRoot(get().workspaceRoot) === normalized && !get().activeThreadId) {
      set({ route: 'chat', error: null })
      return normalized
    }
    try {
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: normalized })
      const persisted = normalizeWorkspaceRoot(next.workspaceRoot) || normalized
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      resetBusyRecoveryAttempts()
      set((s) => ({
        ...clearedThreadSelection(),
        route: 'chat',
        workspaceRoot: persisted,
        workspaceLabel: workspaceLabelFromPath(persisted),
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [persisted]),
        error: null
      }))
      await get().refreshThreads()
      return persisted
    } catch (e) {
      set({ error: formatRuntimeError(e) })
      return null
    }
  },

  clearWorkspace: async () => {
    try {
      if (typeof window.kunGui === 'undefined' || typeof window.kunGui.setSettings !== 'function') {
        return
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        codeWorkspaceRoots: get().codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(''),
        error: null
      })
      await get().refreshThreads()
    } catch {
      // silently ignore — the workspace will remain set
    }
  },

  deleteWorkspace: async (workspacePath) => {
    const normalizedPath = normalizeWorkspaceRoot(workspacePath)
    if (!normalizedPath) return
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const { activeThreadId } = get()
    const p = getProvider()
    const workspaceThreads = get().threads.filter((thread) =>
      threadBelongsToWorkspace(thread, normalizedPath)
    )
    const deletingActive = workspaceThreads.some((th) => th.id === activeThreadId)
    if (deletingActive) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    try {
      const deletedIds = typeof p.deleteThreadsByWorkspace === 'function'
        ? await p.deleteThreadsByWorkspace(normalizedPath)
        : await Promise.all(workspaceThreads.map(async (thread) => {
          await p.deleteThread(thread.id)
          return thread.id
        }))
      for (const threadId of deletedIds) invalidateThreadSnapshot(threadId)
      const removeIds = new Set(deletedIds)
      const codeWorkspaceRoots = forgetCodeWorkspaceRoot(get().codeWorkspaceRoots, normalizedPath)
      set((s) => {
        const w = { ...s.watchTurnCompletion }
        const u = { ...s.unreadThreadIds }
        for (const tid of removeIds) {
          delete w[tid]
          delete u[tid]
          clearWatchedCompletionNotification(tid)
        }
        return {
          threads: s.threads.filter(
            (thread) => !threadBelongsToWorkspace(thread, normalizedPath)
          ),
          codeWorkspaceRoots,
          watchTurnCompletion: w,
          unreadThreadIds: u,
          ...(deletingActive ? clearedThreadSelection() : {}),
          error: null
        }
      })
      // If the deleted workspace is the current workspaceRoot, clear it.
      if (normalizeWorkspaceRoot(get().workspaceRoot) === normalizedPath) {
        try {
          if (typeof window.kunGui?.setSettings === 'function') {
            const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
            set({
              workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
              codeWorkspaceRoots: get().codeWorkspaceRoots,
              workspaceLabel: workspaceLabelFromPath('')
            })
          }
        } catch {
          /* silently keep workspaceRoot if settings clear fails */
        }
      }
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
    }
  },

  refreshThreads: async () => {
    if (get().runtimeConnection !== 'ready') return
    if (refreshInFlight) return
    refreshInFlight = true
    // Surface loading/refreshing before the first inventory lands. A
    // background refresh must keep the previous list visible (never clears
    // `threads` early), so the sidebar only shows skeletons when there is
    // nothing to show yet.
    set((s) => ({
      threadListStatus: s.threads.length === 0 ? 'loading' : 'refreshing',
      threadListError: null
    }))
    try {
      const p = getProvider()
      let rawThreads: NormalizedThread[]
      let firstPageHasMore = false
      try {
        if (typeof p.listThreadsPage === 'function') {
          const page = await p.listThreadsPage({
            limit: THREAD_LIST_FIRST_PAGE_SIZE,
            ...(get().showArchivedThreads ? { archivedOnly: true } : {}),
            includeSide: true,
            lean: true
          })
          rawThreads = page.threads
          firstPageHasMore = page.hasMore
        } else {
          rawThreads = await p.listThreads({
            includeArchived: true,
            includeSide: true
          })
        }
      } catch {
        rawThreads = await p.listThreads()
      }
      rawThreads = rawThreads.filter((thread) => thread.relation !== 'side')
      if (pendingDesignDocumentClones().length > 0) {
        try {
          const lifecycleThreads = await p.listThreads({
            includeArchived: true,
            includeSide: true
          })
          await reconcilePendingDesignDocumentClones({ threads: lifecycleThreads })
        } catch {
          // Keep durable markers until a complete runtime inventory is available.
        }
      }
      let threads = rawThreads.map((thread) => ({
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace)
      }))
      const watchSnapshot = get().watchTurnCompletion
      const localThreadById = new Map(get().threads.map((thread) => [thread.id, thread]))
      threads = preserveListedDesignProfiles(threads, localThreadById)
      threads = normalizeListedThreadActivity(threads, localThreadById)
      const watchTokenByThread = new Map<string, string>()
      for (const id of Object.keys(watchSnapshot)) {
        const watchKey = currentCompletionWatchToken(id)
        if (watchKey) watchTokenByThread.set(id, watchKey)
      }
      const reconcileCandidates = threads.filter((thread) =>
        thread.status?.trim().toLowerCase() === 'running' ||
        threadLooksRunning(thread) ||
        watchSnapshot[thread.id] === true
      )
      const reconciledStateById = new Map<string, ThreadRuntimeState>()
      if (reconcileCandidates.length > 0 &&
          (typeof p.getThreadState === 'function' || typeof p.getThreadStates === 'function')) {
        // Bulk endpoint first (chunked + sequential inside the loader); bounded
        // single reads keep older runtimes compatible.
        const results = await loadThreadStates(p, reconcileCandidates.map((t) => t.id))
        for (const result of results) {
          if (!result.ok) continue
          const localThread = localThreadById.get(result.id)
          const latestTurnId = result.state.latestTurnId
          // Reject the response when the runtime reports a *newer* turn than
          // the one this refresh started from: the response is authoritative
          // for its own turn, but committing it here could regress local state
          // that already observed a later turn.
          if (
            latestTurnId &&
            localThread?.latestTurnId &&
            localThread.latestTurnId !== latestTurnId
          ) continue
          reconciledStateById.set(result.id, result.state)
        }
        threads = threads.map((thread) => {
          const runtimeState = reconciledStateById.get(thread.id)
          if (!runtimeState) return thread
          const running = threadLooksRunning(runtimeState)
          return {
            ...thread,
            status: thread.archived ? thread.status : running ? 'running' : 'idle',
            ...(runtimeState.latestTurnId ? { latestTurnId: runtimeState.latestTurnId } : {}),
            ...(runtimeState.latestTurnStatus ? { latestTurnStatus: runtimeState.latestTurnStatus } : {})
          }
        })
      }
      const sddThreadRegistry = readSddThreadRegistry()
      const designRegistry = readDesignThreadRegistry()
      const sidebarThreads = await filterThreadsForSidebar(threads, p)
      const forkRegistry = hydrateThreadForkRegistry(sidebarThreads, readThreadForkRegistry())
      saveThreadForkRegistry(forkRegistry)
      const enrichedThreads = enrichThreadsWithForkInfo(sidebarThreads, forkRegistry)
      // Preserve the active Kun thread when it is not in the listing yet.
      // A brand-new thread can be absent from `listThreads` until the first
      // message is written. Without this, the optimistic thread would be wiped
      // from the sidebar and its live turn aborted by the selection clearing
      // path below.
      const activeId = get().activeThreadId
      const activeRawThread = activeId
        ? threads.find((thread) => thread.id === activeId) ?? null
        : null
      const activeThreadIsSdd =
        isSddAssistantThread(activeRawThread, sddThreadRegistry) ||
        isSddAssistantThread(
          activeId ? get().threads.find((thread) => thread.id === activeId) ?? null : null,
          sddThreadRegistry
        )
      const activeThreadIsLegacyDesign = Boolean(activeId &&
        isLegacyDesignWorkbenchThread(activeId, activeRawThread, designRegistry))
      const activeThreadFilteredFromCodeSidebar =
        get().route === 'chat' &&
        activeId != null &&
        !activeThreadIsSdd &&
        !activeThreadIsLegacyDesign &&
        threads.some((thread) => thread.id === activeId) &&
        !sidebarThreads.some((thread) => thread.id === activeId)
      const preservedSddActiveThread =
        activeThreadIsSdd && activeId
          ? activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
      const preservedLegacyDesignActiveThread =
        activeThreadIsLegacyDesign && activeId
          ? activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
      const pendingActiveThread =
        activeId != null &&
        !activeThreadFilteredFromCodeSidebar &&
        !enrichedThreads.some((thread) => thread.id === activeId)
          ? get().threads.find((thread) => thread.id === activeId) ?? null
          : null
      let displayThreads = pendingActiveThread
        ? [pendingActiveThread, ...enrichedThreads]
        : enrichedThreads
      if (
        preservedSddActiveThread &&
        !displayThreads.some((thread) => thread.id === preservedSddActiveThread.id)
      ) {
        displayThreads = [preservedSddActiveThread, ...displayThreads]
      }
      if (
        preservedLegacyDesignActiveThread &&
        !displayThreads.some((thread) => thread.id === preservedLegacyDesignActiveThread.id)
      ) {
        displayThreads = [preservedLegacyDesignActiveThread, ...displayThreads]
      }
      const writeWorkspaceRoots = await readWriteWorkspaceRoots()
      const writeRegistry = hydrateWriteThreadRegistry(
        displayThreads,
        writeWorkspaceRoots,
        pruneWriteThreadRegistry(displayThreads, readWriteThreadRegistry())
      )
      saveWriteThreadRegistry(writeRegistry)
      displayThreads = displayThreads.map((thread) => {
        const writeWorkspace = writeWorkspaceForThreadId(thread.id, writeRegistry)
        return writeWorkspace ? { ...thread, workspace: writeWorkspace } : thread
      })
      const threadWorktreeRegistry = readThreadWorktreeRegistry().worktrees
      const workspaceCandidates = [
        get().workspaceRoot,
        ...get().codeWorkspaceRoots,
        ...threads.map((thread) => thread.workspace),
        ...displayThreads.map((thread) => thread.workspace)
      ].filter((path): path is string => Boolean(path))
      const codeThreadWorkspaceRoots = [
        ...threads,
        ...displayThreads
      ]
        .filter((thread) => isCodeThread(thread, get().clawChannels, writeRegistry, designRegistry))
        .map((thread) => {
          const record = threadWorktreeRegistry[thread.id]
          if (record?.projectPath?.trim()) return record.projectPath.trim()
          return resolveProjectWorkspacePath(thread.workspace ?? '', {
            threadWorktrees: threadWorktreeRegistry,
            candidateProjectPaths: workspaceCandidates
          })
        })
        .filter(Boolean)
      const codeWorkspaceRoots = reconcileCodeWorkspaceRoots({
        currentRoots: get().codeWorkspaceRoots,
        codeThreadWorkspaceRoots,
        writeWorkspaceRoots,
        preservedWorkspaceRoots: [get().workspaceRoot]
      })
      saveCodeWorkspaceRoots(codeWorkspaceRoots)
      const activeThreadId = get().activeThreadId
      const activeThread = activeThreadId
        ? displayThreads.find((thread) => thread.id === activeThreadId) ?? null
        : null
      const activeThreadIsManagedInCodeRoute =
        get().route === 'chat' &&
        activeThread != null &&
        (activeThread.agentSurface === 'write' ||
          isWriteAssistantThread(activeThread, writeRegistry) ||
          isClawThread(activeThread, get().clawChannels) ||
          isInternalDeepSeekGuiWorkspace(activeThread.workspace))
      const { shouldClearSelection } = threadRefreshSelection(get(), displayThreads)
      if (shouldClearSelection) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
      }
      // A newer local action may have changed the inventory while the request
      // was in flight; a queued trailing refresh will reconcile it afterwards.
      // 记忆中的 Code 会话被删除或归档后清理,避免长期保存悬空 ID。
      const rememberedCodeThreadId = get().lastCodeThreadId?.trim() ?? ''
      const staleCodeThreadMemory = Boolean(
        rememberedCodeThreadId &&
        !threads.some((thread) => thread.id === rememberedCodeThreadId && thread.archived !== true)
      )
      const { validIds } = threadRefreshSelection(get(), displayThreads)
      const reconciledCompletedWatchIds = new Set(
        [...reconciledStateById.entries()]
          .filter(([id, state]) => {
            if (!watchSnapshot[id]) return false
            if (threadLooksRunning(state)) return false
            // Claim only the watch generation that existed when this refresh
            // started. A watch removed and re-created for a newer turn carries a
            // fresh token; an old refresh must not clear that newer watch.
            const capturedToken = watchTokenByThread.get(id)
            if (capturedToken && currentCompletionWatchToken(id) !== capturedToken) return false
            return true
          })
          .map(([id]) => id)
      )
      const notificationState = get()
      for (const id of reconciledCompletedWatchIds) {
        notifyTurnComplete(
          id,
          notificationState,
          completionNotificationDedupeKeyForWatchedThread(id),
          turnCompleteNotificationSource(id, notificationState)
        )
        clearWatchedCompletionNotification(id)
        invalidateThreadSnapshot(id)
      }
      set((s) => {
        const w: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(s.watchTurnCompletion)) {
          if (v && validIds.has(k) && !reconciledCompletedWatchIds.has(k)) {
            w[k] = true
          } else {
            clearWatchedCompletionNotification(k)
          }
        }
        const addedWatchIds = collectRunningWatchTargets(displayThreads, {
          activeThreadId: s.activeThreadId,
          watchTurnCompletion: w,
          watchLimit: MAX_WATCHED_COMPLETION_NOTIFICATIONS
        })
        for (const id of addedWatchIds) {
          w[id] = true
          watchTurnCompletionNotification(id, Date.now(), turnCompleteNotificationSource(id, s))
        }
        let u = retainUnreadCompletions(s.unreadThreadIds, validIds)
        for (const id of reconciledCompletedWatchIds) {
          const outcome = completionOutcomeForTurnStatus(reconciledStateById.get(id)?.latestTurnStatus)
          u = !outcome || completionIsCurrentlyVisible(s, id)
            ? clearUnreadCompletion(u, id)
            : markUnreadCompletion(u, id, outcome)
        }
        const pageMode = threadPageMode(s.showArchivedThreads)
        const workspacePaths = [
          ...codeWorkspaceRoots,
          ...threads.map((thread) => thread.workspace)
        ]
        const pages = reconcileWorkspaceThreadPages(
          s.threadListCursorByWorkspace,
          workspacePaths,
          firstPageHasMore,
          pageMode
        )
        return {
          threads: firstPageHasMore ? mergeThreadPages(displayThreads, s.threads) : displayThreads,
          codeWorkspaceRoots,
          watchTurnCompletion: w,
          unreadThreadIds: u,
          threadListStatus: 'ready',
          threadListError: null,
          threadListCursorByWorkspace: pages,
          ...(staleCodeThreadMemory ? { lastCodeThreadId: null } : {}),
          ...(shouldClearSelection ? clearedThreadSelection() : {})
        }
      })
      syncTurnCompletionPoll(set, get)
      // Persist a lean summary cache after each successful refresh so the next
      // startup can paint the sidebar from local storage before the runtime
      // inventory arrives.
      saveThreadListCache(displayThreads)
      scheduleRecentThreadPrewarm(get().threads, get().activeThreadId)
      if (activeThreadIsManagedInCodeRoute) {
        await get().openCode()
      }
    } catch (e) {
      stopTurnCompletionPoll()
      set({
        runtimeConnection: 'offline',
        error: formatRuntimeError(e),
        threadListStatus: 'error',
        threadListError: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    } finally {
      refreshInFlight = false
    }
  },
  setThreadSearch: (query) => {
    set({ threadSearch: query })
  },

  setShowArchivedThreads: (show) => {
    set({ showArchivedThreads: show, threadListCursorByWorkspace: {} })
    if (get().runtimeConnection === 'ready') {
      void get().refreshThreads()
    }
  },
  }
}
