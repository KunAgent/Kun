import type { NormalizedThread } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
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
import { primaryAgentAvailableOnSurface } from '../lib/subagent-profile-surface'
import { threadBelongsToRemovedCodeProject } from './chat-store-navigation-workspace-removal'
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

export function createNavigationModeActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'openCode' | 'openDesign' | 'clearActiveThreadSelection' | 'openWrite' | 'ensureWriteThreadForWorkspace' | 'createWriteThread' | 'selectWriteThread' | 'ensureDesignThreadForWorkspace' | 'createDesignThread'> {
  return {
  openCode: async (options) => {
    const activationAllowed = (): boolean => options?.activationGuard?.() !== false
    if (!activationAllowed()) return
    const state = get()
    const designRegistry = readDesignThreadRegistry()
    const writeRegistry = readWriteThreadRegistry()
    const sddRegistry = readSddThreadRegistry()
    const worktreeRegistry = readThreadWorktreeRegistry().worktrees
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    // 当前会话已经是 Code 工作台会话(含仍处于需求阶段的需求 AI 会话)时保持不动。
    if (
      activeThread &&
      activeThread.archived !== true &&
      !threadBelongsToRemovedCodeProject(
        activeThread,
        state.removedCodeWorkspaces,
        worktreeRegistry[activeThread.id]
      ) &&
      isCodeSidebarThread(activeThread, state.clawChannels, writeRegistry, designRegistry, sddRegistry)
    ) {
      if (activationAllowed()) set({ route: 'chat' })
      return
    }

    const codeThreads = state.threads.filter((thread) =>
      !threadBelongsToRemovedCodeProject(
        thread,
        state.removedCodeWorkspaces,
        worktreeRegistry[thread.id]
      ) &&
      isCodeThread(thread, state.clawChannels, writeRegistry, designRegistry, sddRegistry)
    )
    // 返回 Code 工作台时优先恢复上次选中的会话,而不是默认选择更新时间最新的会话。
    const rememberedId = state.lastCodeThreadId?.trim()
    const rememberedThread = rememberedId
      ? state.threads.find((thread) => thread.id === rememberedId) ?? null
      : null
    const rememberedIsCodeTarget = rememberedThread != null &&
      rememberedThread.archived !== true &&
      !threadBelongsToRemovedCodeProject(
        rememberedThread,
        state.removedCodeWorkspaces,
        worktreeRegistry[rememberedThread.id]
      ) &&
      isCodeSidebarThread(rememberedThread, state.clawChannels, writeRegistry, designRegistry, sddRegistry)

    if (!activationAllowed()) return
    set({ route: 'chat' })
    if (rememberedThread && rememberedIsCodeTarget && state.runtimeConnection === 'ready') {
      await get().selectThread(rememberedThread.id, {
        selectionGuard: activationAllowed
      })
      return
    }

    const selectedWorkspace = normalizeWorkspaceRoot(state.workspaceRoot)
    const target =
      latestThread(codeThreads.filter((thread) => threadBelongsToWorkspace(thread, selectedWorkspace))) ??
      latestThread(codeThreads)

    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id, { selectionGuard: activationAllowed })
      return
    }

    if (!activationAllowed()) return
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(
        state.activeThreadId,
        Date.now(),
        turnCompleteNotificationSource(state.activeThreadId, state)
      )
    }
    set({
      ...clearedThreadSelection(),
      route: 'chat',
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  openDesign: () => {
    // Standalone Design is a legacy route. Preserve the selected conversation
    // and expose it through the shared Code workbench instead.
    set({ route: 'chat' })
  },

  clearActiveThreadSelection: () => {
    const state = get()
    if (!state.activeThreadId && state.blocks.length === 0 && !state.busy) return
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(
        state.activeThreadId,
        Date.now(),
        turnCompleteNotificationSource(state.activeThreadId, state)
      )
    }
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({
      ...clearedThreadSelection(),
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  openWrite: async (options) => {
    const activationAllowed = (): boolean => options?.activationGuard?.() !== false
    if (!activationAllowed()) return
    const state = get()
    const selectedWorkspace = await readActiveWriteWorkspace(state.workspaceRoot)
    const writeWorkspaceRoots = await readWriteWorkspaceRoots()
    if (!activationAllowed()) return
    const registry = hydrateWriteThreadRegistry(
      state.threads,
      selectedWorkspace ? [selectedWorkspace, ...writeWorkspaceRoots] : writeWorkspaceRoots,
      pruneWriteThreadRegistry(state.threads, readWriteThreadRegistry())
    )
    saveWriteThreadRegistry(registry)
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (
      activeThread &&
      activeThread.archived !== true &&
      selectedWorkspace &&
      writeThreadBelongsToWorkspace(activeThread, selectedWorkspace, registry)
    ) {
      if (activationAllowed()) set({ route: 'write' })
      return
    }

    const target = activeWriteThreadForWorkspace(
      selectedWorkspace,
      state.threads.filter((thread) => thread.archived !== true),
      registry
    )

    if (!activationAllowed()) return
    set({ route: 'write' })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id, { selectionGuard: activationAllowed })
      return
    }

    if (!activationAllowed()) return
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(
        state.activeThreadId,
        Date.now(),
        turnCompleteNotificationSource(state.activeThreadId, state)
      )
    }
    set({
      ...clearedThreadSelection(),
      route: 'write',
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  ensureWriteThreadForWorkspace: async (workspaceRoot, activeFilePath) => {
    const state = get()
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) || (await readActiveWriteWorkspace(state.workspaceRoot))
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    const writeState = useWriteWorkspaceStore.getState()
    const targetFilePath = activeFilePath !== undefined
      ? activeFilePath.trim() || undefined
      : (
          workspaceRootIdentityKey(writeState.workspaceRoot) === workspaceRootIdentityKey(targetWorkspace)
            ? writeState.activeFilePath?.trim() || undefined
            : undefined
        )
    if (state.runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }

    const registry = hydrateWriteThreadRegistry(
      state.threads,
      [targetWorkspace],
      pruneWriteThreadRegistry(state.threads, readWriteThreadRegistry())
    )
    saveWriteThreadRegistry(registry)
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    const existing = activeWriteThreadForWorkspace(
      targetWorkspace,
      state.threads,
      registry,
      targetFilePath
    )
    if (activeThread && existing?.id === activeThread.id) {
      set({ route: 'write', error: null })
      return activeThread.id
    }

    if (existing) {
      set({ route: 'write' })
      await get().selectThread(existing.id)
      return existing.id
    }

    return get().createWriteThread(targetWorkspace, targetFilePath)
  },

  createWriteThread: async (workspaceRoot, activeFilePath, options = {}) => {
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) || (await readActiveWriteWorkspace(get().workspaceRoot))
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    if (!(await workspaceDirectoryExists(targetWorkspace))) {
      set({ error: workspaceMissingError() })
      await showWorkspaceMissingDialog(targetWorkspace)
      return null
    }
    try {
      const p = getProvider()
      const pickedAgentId = get().composerAgentId?.trim() ?? ''
      const personaProfile = pickedAgentId
        ? (await rendererRuntimeClient.getSettings()).agents?.kun?.subagents?.profiles?.find(
          (profile) => profile.id === pickedAgentId &&
            primaryAgentAvailableOnSurface(profile, 'write')
        )
        : undefined
      const thread = await p.createThread({
        workspace: targetWorkspace,
        title: options.title?.trim() || WRITE_ASSISTANT_THREAD_TITLE,
        // An explicit board title locks the session name so the backend titler
        // cannot overwrite the user-visible whiteboard name; otherwise keep the
        // provisional auto-title upgrade path for ordinary file threads.
        titleAuto: options.title?.trim() ? (options.titleAuto ?? false) : true,
        mode: 'agent',
        agentSurface: 'write',
        ...(personaProfile?.providerId?.trim()
          ? { providerId: personaProfile.providerId.trim() }
          : {}),
        ...(personaProfile?.model?.trim() ? { model: personaProfile.model.trim() } : {}),
        ...(personaProfile ? {
          agentId: personaProfile.id,
          ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
        } : {})
      })
      saveWriteThreadRegistry(markWriteThread(
        targetWorkspace,
        thread.id,
        readWriteThreadRegistry(),
        activeFilePath
      ))
      set((s) => ({
        route: 'write',
        ...(pickedAgentId ? { composerAgentId: '' } : {}),
        threads: s.threads.some((item) => item.id === thread.id) ? s.threads : [thread, ...s.threads],
        error: null
      }))
      await get().refreshThreads()
      await get().selectThread(thread.id)
      return thread.id
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },

  selectWriteThread: async (threadId, workspaceRoot, activeFilePath) => {
    const targetId = threadId.trim()
    if (!targetId) return
    const thread = get().threads.find((item) => item.id === targetId)
    const targetWorkspace = normalizeWorkspaceRoot(workspaceRoot) ||
      normalizeWorkspaceRoot(thread?.workspace) ||
      (await readActiveWriteWorkspace(get().workspaceRoot))
    if (targetWorkspace) {
      saveWriteThreadRegistry(markWriteThread(
        targetWorkspace,
        targetId,
        readWriteThreadRegistry(),
        activeFilePath
      ))
    }
    set({ route: 'write' })
    await get().selectThread(targetId)
  },

  ensureDesignThreadForWorkspace: async (workspaceRoot, docId) => {
    const state = get()
    const targetWorkspace =
      normalizeWorkspaceRoot(workspaceRoot) || normalizeWorkspaceRoot(state.workspaceRoot)
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    if (state.runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    const targetDoc = (docId ?? '').trim()
    const registry = readDesignThreadRegistry()
    const record = registry.workspaces[designDocKey(targetWorkspace, targetDoc)]
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    // Reuse the active thread only when it is THIS 设计稿's registered thread (a
    // thread id belongs to exactly one (workspace, 设计稿) scope).
    if (activeThread && record && record.threadIds.includes(activeThread.id)) {
      set({ route: 'chat', error: null })
      return activeThread.id
    }
    const existing = activeDesignThreadForWorkspace(targetWorkspace, targetDoc, state.threads, registry)
    if (existing) {
      set({ route: 'chat' })
      await get().selectThread(existing.id)
      return get().activeThreadId === existing.id ? existing.id : null
    }
    return get().createDesignThread(targetWorkspace, targetDoc)
  },

  createDesignThread: async (workspaceRoot, docId, options = {}) => {
    const activate = options.activate !== false
    const targetWorkspace =
      normalizeWorkspaceRoot(workspaceRoot) || normalizeWorkspaceRoot(get().workspaceRoot)
    if (!targetWorkspace) {
      set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
      return null
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return null
    }
    if (!(await workspaceDirectoryExists(targetWorkspace))) {
      set({ error: workspaceMissingError() })
      if (!options.suppressSettingsRedirect) {
        await showWorkspaceMissingDialog(targetWorkspace)
      }
      return null
    }
    const targetDoc = (docId ?? '').trim()
    try {
      const provider = getProvider()
      const pickedAgentId = get().composerAgentId?.trim() ?? ''
      const personaProfile = pickedAgentId
        ? (await rendererRuntimeClient.getSettings()).agents?.kun?.subagents?.profiles?.find(
          (profile) => profile.id === pickedAgentId &&
            primaryAgentAvailableOnSurface(profile, 'design')
        )
        : undefined
      const thread = await provider.createThread({
        workspace: targetWorkspace,
        title: DESIGN_ASSISTANT_THREAD_TITLE,
        titleAuto: true,
        mode: 'agent',
        agentSurface: 'design',
        ...(personaProfile?.providerId?.trim()
          ? { providerId: personaProfile.providerId.trim() }
          : {}),
        ...(personaProfile?.model?.trim() ? { model: personaProfile.model.trim() } : {}),
        ...(personaProfile ? {
          agentId: personaProfile.id,
          ...(personaProfile.systemPrompt ? { systemPrompt: personaProfile.systemPrompt } : {})
        } : {})
      })
      const nextRegistry = markDesignThread(targetWorkspace, targetDoc, thread.id)
      saveDesignThreadRegistry(nextRegistry)
      const record = nextRegistry.workspaces[designDocKey(targetWorkspace, targetDoc)]
      const bindingPersisted = Boolean(record) && await persistDesignChatMetaForDoc({
        workspaceRoot: targetWorkspace,
        docId: targetDoc,
        stampThreadId: thread.id,
        record
      })
      if (!bindingPersisted) {
        let cleanupError: unknown = null
        try {
          await provider.deleteThread(thread.id)
          invalidateThreadSnapshot(thread.id)
          saveDesignThreadRegistry(forgetDesignThread(thread.id, readDesignThreadRegistry()))
        } catch (error) {
          cleanupError = error
          // Keep a recoverable binding so the first-submit rollback can retry
          // deletion instead of losing the new runtime thread's identity.
          saveDesignThreadRegistry(markDesignThread(
            targetWorkspace,
            targetDoc,
            thread.id,
            readDesignThreadRegistry()
          ))
        }
        const cleanupDetail = cleanupError
          ? ` Runtime cleanup also failed: ${formatRuntimeError(cleanupError)}`
          : ''
        throw new Error(`Could not persist the Design drawing conversation binding.${cleanupDetail}`)
      }
      // If another renderer registry write raced the disk operation, restore
      // the live binding before exposing the thread to the Design controller.
      saveDesignThreadRegistry(markDesignThread(
        targetWorkspace,
        targetDoc,
        thread.id,
        readDesignThreadRegistry()
      ))
      if (activate) get().clearActiveThreadSelection?.()
      set((s) => ({
        ...(activate
          ? {
              ...clearedThreadSelection(),
              route: 'chat' as const,
              activeThreadId: thread.id,
              activeThreadRelation: 'primary' as const
            }
          : {}),
        ...(pickedAgentId ? { composerAgentId: '' } : {}),
        threads: s.threads.some((item) => item.id === thread.id) ? s.threads : [thread, ...s.threads],
        ...(activate ? { error: null } : {})
      }))
      // A new thread is known to be empty and is already present in the local
      // list. Do not refresh before its first turn: an eventually-consistent
      // list response could omit the fresh id and clear the atomic selection.
      // The accepted Design turn performs background list reconciliation.
      return thread.id
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(!options.suppressSettingsRedirect && shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return null
    }
  },
  }
}
