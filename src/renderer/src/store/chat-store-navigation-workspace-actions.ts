import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import { resolveProjectWorkspacePath } from '../lib/worktree-project-path'
import {
  isClawWorkspacePath,
  isConversationWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../lib/workspace-path'
import { withNativeDialog } from '../lib/native-dialog-activity'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  codeRootsAfterRemoval,
  createRemoveWorkspaceAction,
  rememberRootForRestore,
  removedRegistryAfterRestore
} from './chat-store-navigation-workspace-removal'
import {
  clearedThreadSelection,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts
} from './chat-store-schedulers'
import { loadMoreThreads as loadMoreThreadsAction } from './chat-store-thread-pagination'
import { isCodeThread } from './chat-store-runtime'
import { createRefreshThreadsAction } from './chat-store-thread-refresh'
import { threadWorkspacePreparing, useTaskWorkspaceStore } from './task-workspace-store'
import { useReviewStore } from './review-store'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

export function createNavigationWorkspaceActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'chooseWorkspace' | 'selectWorkspaceRoot' | 'chooseAdeWorkspace' | 'selectAdeWorkspaceRoot' | 'setComposerIsolationForWorkspace' | 'clearWorkspace' | 'removeWorkspace' | 'refreshThreads' | 'loadMoreThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  let adeSelectionPending = false

  const isManagedContext = (state: ChatState): boolean => {
    if (state.route === 'ade') return true
    if (state.route !== 'chat') return false
    const thread = [...state.threads, ...state.adeThreads].find((entry) => entry.id === state.activeThreadId)
    return state.adeDraftOpen || Boolean(thread?.taskWorkspaceId) || thread?.workspaceMode === 'ade'
  }


  const adeSelectionBlocked = (state: ChatState): boolean =>
    state.busy || state.queuedMessages.length > 0 ||
    Boolean(state.threadLoadingId) || threadWorkspacePreparing(state.activeThreadId)

  const currentAdeProjectRoot = (state: ChatState): string => {
    if (!state.activeThreadId) return normalizeWorkspaceRoot(state.workspaceRoot)
    const thread = [...state.threads, ...state.adeThreads].find((item) => item.id === state.activeThreadId)
    if (!thread) return normalizeWorkspaceRoot(state.workspaceRoot)
    if (!thread.taskWorkspaceId) return normalizeWorkspaceRoot(thread.workspace)
    const preparedSource = useTaskWorkspaceStore.getState().prepByThread[thread.id]?.sourceRoot
    if (preparedSource) return normalizeWorkspaceRoot(preparedSource)
    const boundSource = useReviewStore.getState().bindings[thread.id]?.sourceRoot
    if (boundSource) return normalizeWorkspaceRoot(boundSource)
    const worktrees = readThreadWorktreeRegistry().worktrees
    return resolveProjectWorkspacePath(thread.workspace ?? '', {
      threadWorktrees: worktrees,
      candidateProjectPaths: state.codeWorkspaceRoots
    })
  }

  const adeSelectionContext = () => {
    const state = get()
    return { route: state.route, activeThreadId: state.activeThreadId, workspaceRoot: state.workspaceRoot }
  }

  const contextIsCurrent = (context: ReturnType<typeof adeSelectionContext>): boolean => {
    const state = get()
    return isManagedContext(state) && state.route === context.route &&
      state.activeThreadId === context.activeThreadId &&
      state.workspaceRoot === context.workspaceRoot && !adeSelectionBlocked(state)
  }

  const applyAdeWorkspaceSelection = async (
    workspacePath: string,
    context: ReturnType<typeof adeSelectionContext>
  ): Promise<string | null> => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!contextIsCurrent(context)) return null
    if (
      !normalized ||
      isConversationWorkspacePath(normalized, get().conversationWorkspaceRoot) ||
      isInternalDeepSeekGuiWorkspace(normalized) || isClawWorkspacePath(normalized)
    ) {
      set({ error: i18n.t('common:adeWorkspaceInvalidProject', {
        defaultValue: 'Choose a regular project folder outside Kun-managed directories.'
      }) })
      return null
    }
    // Re-selecting the current project must leave the draft's isolation,
    // branch starting point, and any composer-local text untouched.
    const state = get()
    const sameSelectedProject = workspaceRootIdentityKey(state.workspaceRoot) ===
      workspaceRootIdentityKey(normalized)
    const sameActiveProject = workspaceRootIdentityKey(currentAdeProjectRoot(state)) ===
      workspaceRootIdentityKey(normalized)
    if (sameSelectedProject && sameActiveProject && !state.workspaceRootLocal) {
      set({
        error: null,
        ...(state.activeThreadId ? {} : {
          adeDraftOpen: true,
          ...(!state.adeDraftOpen ? { adeDraftRevision: state.adeDraftRevision + 1 } : {})
        })
      })
      return normalized
    }
    try {
      const persistedSettings = await rendererRuntimeClient.setSettings({ workspaceRoot: normalized })
      if (!contextIsCurrent(context)) return null
      const persisted = normalizeWorkspaceRoot(persistedSettings.workspaceRoot) || normalized
      const projectChanged = workspaceRootIdentityKey(currentAdeProjectRoot(state)) !==
        workspaceRootIdentityKey(persisted)
      const removedCodeWorkspaces = removedRegistryAfterRestore(persisted, get().removedCodeWorkspaces)
      if (projectChanged) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
        resetBusyRecoveryAttempts()
      }
      set((current) => ({
        ...(projectChanged ? clearedThreadSelection() : {}),
        route: 'chat',
        adeDraftOpen: projectChanged || !current.activeThreadId ? true : current.adeDraftOpen,
        adeDraftRevision: projectChanged || (!current.activeThreadId && !current.adeDraftOpen)
          ? current.adeDraftRevision + 1
          : current.adeDraftRevision,
        workspaceRoot: persisted,
        workspaceRootLocal: false,
        workspaceLabel: workspaceLabelFromPath(persisted),
        codeWorkspaceRoots: rememberRootForRestore(
          codeRootsAfterRemoval(current.codeWorkspaceRoots, removedCodeWorkspaces),
          persisted
        ),
        removedCodeWorkspaces,
        ...(projectChanged ? { extensionComposerContexts: [] } : {}),
        ...(projectChanged ? { composerWorktreeStartFrom: undefined } : {}),
        ...(projectChanged ? {
          composerProjectDefaults: null,
          composerRouteExplicitWorkspaceRoot: '',
          composerProjectCollaborationExplicitWorkspaceRoot: ''
        } : {}),
        error: null
      }))
      void get().refreshThreads().catch(() => undefined)
      return persisted
    } catch (error) {
      if (contextIsCurrent(context)) set({ error: formatRuntimeError(error) })
      return null
    }
  }

  return {
  loadMoreThreads: (workspacePath) => loadMoreThreadsAction(workspacePath, set, get),
  chooseWorkspace: async ({ createThreadAfter = false, selectThreadAfter = true, persist = true } = {}) => {
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
      // Remote/mobile callers pass persist: false so browsing a project on a
      // phone never rewrites the host's current workspaceRoot setting.
      const next = persist
        ? await rendererRuntimeClient.setSettings({ workspaceRoot: picked.path })
        : null
      const workspaceRoot = normalizeWorkspaceRoot(next?.workspaceRoot ?? picked.path)
      // Re-picking a previously removed directory is an explicit re-add: clear
      // the hidden marker so the retained history reappears with this project.
      const removedCodeWorkspaces = removedRegistryAfterRestore(workspaceRoot, get().removedCodeWorkspaces)
      const codeWorkspaceRoots = rememberRootForRestore(
        codeRootsAfterRemoval(get().codeWorkspaceRoots, removedCodeWorkspaces),
        workspaceRoot
      )

      set({
        workspaceRoot,
        workspaceRootLocal: !persist,
        codeWorkspaceRoots,
        removedCodeWorkspaces,
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
  selectWorkspaceRoot: async (workspaceRoot, options) => {
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
    // A persisted pick of the root that is only held renderer-locally must
    // still reach the host settings, so it takes the full path below.
    const persistRequested = options?.persist !== false
    if (
      normalizeWorkspaceRoot(get().workspaceRoot) === normalized &&
      !get().activeThreadId &&
      !(persistRequested && get().workspaceRootLocal)
    ) {
      set({ route: 'chat', error: null })
      return normalized
    }
    try {
      // persist: false keeps the switch renderer-local; Remote mobile browsing
      // must not move the desktop host's current project.
      const next = options?.persist === false
        ? null
        : await rendererRuntimeClient.setSettings({ workspaceRoot: normalized })
      const persisted = normalizeWorkspaceRoot(next?.workspaceRoot ?? '') || normalized
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      resetBusyRecoveryAttempts()
      // Selecting a removed project from the picker is an explicit re-add.
      const restoredRegistry = removedRegistryAfterRestore(persisted, get().removedCodeWorkspaces)
      set((s) => ({
        ...clearedThreadSelection(),
        route: 'chat',
        workspaceRoot: persisted,
        workspaceRootLocal: options?.persist === false,
        workspaceLabel: workspaceLabelFromPath(persisted),
        removedCodeWorkspaces: restoredRegistry,
        codeWorkspaceRoots: rememberRootForRestore(
          codeRootsAfterRemoval(s.codeWorkspaceRoots, restoredRegistry),
          persisted
        ),
        error: null
      }))
      await get().refreshThreads()
      return persisted
    } catch (e) {
      set({ error: formatRuntimeError(e) })
      return null
    }
  },

  chooseAdeWorkspace: async () => {
    if (adeSelectionPending) return null
    adeSelectionPending = true
    const context = adeSelectionContext()
    try {
      if (!isManagedContext(get())) return null
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return null
      }
      if (adeSelectionBlocked(get())) {
        set({ error: i18n.t('common:adeWorkspaceSwitchBusy', {
          defaultValue: 'Wait for the current run, queued messages, or worktree preparation before changing projects.'
        }) })
        return null
      }
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error(i18n.t('common:workspacePickerUnavailable'))
      }
      const picked = await withNativeDialog(() =>
        window.kunGui.pickWorkspaceDirectory(context.workspaceRoot || undefined))
      if (picked.canceled || !picked.path) return null
      return await applyAdeWorkspaceSelection(picked.path, context)
    } catch (error) {
      if (contextIsCurrent(context)) set({ error: formatWorkspacePickerError(error) })
      return null
    } finally {
      adeSelectionPending = false
    }
  },

  selectAdeWorkspaceRoot: async (workspaceRoot) => {
    if (adeSelectionPending) return null
    adeSelectionPending = true
    const context = adeSelectionContext()
    try {
      if (!isManagedContext(get())) return null
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return null
      }
      if (adeSelectionBlocked(get())) {
        set({ error: i18n.t('common:adeWorkspaceSwitchBusy', {
          defaultValue: 'Wait for the current run, queued messages, or worktree preparation before changing projects.'
        }) })
        return null
      }
      return await applyAdeWorkspaceSelection(workspaceRoot, context)
    } finally {
      adeSelectionPending = false
    }
  },

  setComposerIsolationForWorkspace: () => {
    if (!isManagedContext(get()) || get().activeThreadId) return
    set({ composerIsolation: 'local', composerWorktreeStartFrom: undefined })
  },

  clearWorkspace: async () => {
    try {
      if (typeof window.kunGui === 'undefined' || typeof window.kunGui.setSettings !== 'function') {
        return
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        workspaceRootLocal: false,
        codeWorkspaceRoots: get().codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(''),
        error: null
      })
      await get().refreshThreads()
    } catch {
      // silently ignore — the workspace will remain set
    }
  },

  removeWorkspace: createRemoveWorkspaceAction({ set, get, sseAbortRef, clearBusyWatchdog }),

  refreshThreads: createRefreshThreadsAction({ set, get, sseAbortRef }),
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
