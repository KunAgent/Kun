import {
  filterRemovedCodeWorkspaceRoots,
  isCodeWorkspaceRemoved,
  rememberRemovedCodeWorkspace,
  removedProjectKeyForPaths,
  restoreRemovedCodeWorkspace,
  type RemovedCodeWorkspacesRegistry
} from '../lib/removed-code-workspaces'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { describeRuntimeError } from '../lib/format-runtime-error'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { readThreadWorktreeRegistry, type ThreadWorktreeRecord } from '../lib/thread-worktree-registry'
import {
  rememberCodeWorkspaceRoots,
  saveCodeWorkspaceRoots
} from './chat-store-helpers'
import { clearedThreadSelection } from './chat-store-runtime-helpers'

export function threadBelongsToRemovedCodeProject(
  thread: Pick<NormalizedThread, 'workspace'> | null | undefined,
  registry: RemovedCodeWorkspacesRegistry | null | undefined,
  worktreeRecord?: Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'>
): boolean {
  if (!thread) return false
  return Boolean(removedProjectKeyForPaths([
    thread.workspace,
    worktreeRecord?.projectPath,
    worktreeRecord?.worktreePath
  ], registry))
}

export function threadIdBelongsToRemovedCodeProject(
  threadId: string,
  state: Pick<ChatState, 'threads' | 'removedCodeWorkspaces'>
): boolean {
  const thread = state.threads.find((item) => item.id === threadId) ?? null
  const worktreeRecord = readThreadWorktreeRegistry().worktrees[threadId]
  return threadBelongsToRemovedCodeProject(
    thread,
    state.removedCodeWorkspaces,
    worktreeRecord
  )
}

export function removedRegistryAfterRemove(
  options: { projectPath: string; aliases: readonly (string | undefined | null)[] },
  registry: RemovedCodeWorkspacesRegistry
): RemovedCodeWorkspacesRegistry {
  return rememberRemovedCodeWorkspace(options, registry)
}

export function removedRegistryAfterRestore(
  projectPath: string,
  registry: RemovedCodeWorkspacesRegistry
): RemovedCodeWorkspacesRegistry {
  return restoreRemovedCodeWorkspace(projectPath, registry)
}

/** Remove every remembered root that now belongs to a removed project. */
export function codeRootsAfterRemoval(
  currentRoots: readonly string[],
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): string[] {
  if (!registry) return [...currentRoots]
  return filterRemovedCodeWorkspaceRoots(currentRoots, registry)
}

/**
 * Preserved roots handed to `reconcileCodeWorkspaceRoots`. The currently
 * selected root keeps its normal protection unless the user removed that
 * project — otherwise the reconcile pass would re-add it on every refresh.
 */
export function preservedRootsForReconcile(
  state: { workspaceRoot: string },
  registry: RemovedCodeWorkspacesRegistry | null | undefined
): string[] {
  const current = normalizeWorkspaceRoot(state.workspaceRoot)
  if (!current) return []
  if (isCodeWorkspaceRemoved(current, registry)) return []
  return [current]
}

/** Restore a project into remembered roots and persist the merged list. */
export function rememberRootForRestore(
  currentRoots: readonly string[],
  workspacePath: string
): string[] {
  return rememberCodeWorkspaceRoots(currentRoots, [workspacePath])
}

export { isCodeWorkspaceRemoved, saveCodeWorkspaceRoots }

export type RemovedWorkspaceVisibilityResult = {
  patch: Partial<ChatState>
  selectedWorkspaceRemoved: boolean
  activeThreadRemoved: boolean
}

export function removedWorkspaceVisibilityForState(
  state: ChatState,
  registry: RemovedCodeWorkspacesRegistry
): RemovedWorkspaceVisibilityResult {
  const worktrees = readThreadWorktreeRegistry().worktrees
  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
    : null
  const rememberedThread = state.lastCodeThreadId
    ? state.threads.find((thread) => thread.id === state.lastCodeThreadId) ?? null
    : null
  const selectedWorkspaceRemoved = isCodeWorkspaceRemoved(state.workspaceRoot, registry)
  const activeThreadRemoved = activeThread != null && threadBelongsToRemovedCodeProject(
    activeThread,
    registry,
    worktrees[activeThread.id]
  )
  const rememberedThreadRemoved = rememberedThread != null && threadBelongsToRemovedCodeProject(
    rememberedThread,
    registry,
    worktrees[rememberedThread.id]
  )
  return {
    selectedWorkspaceRemoved,
    activeThreadRemoved,
    patch: {
      removedCodeWorkspaces: registry,
      codeWorkspaceRoots: codeRootsAfterRemoval(state.codeWorkspaceRoots, registry),
      ...(selectedWorkspaceRemoved
        ? { workspaceRoot: '', workspaceLabel: workspaceLabelFromPath('') }
        : {}),
      ...(activeThreadRemoved ? clearedThreadSelection() : {}),
      ...(rememberedThreadRemoved ? { lastCodeThreadId: null } : {})
    }
  }
}

type RemoveActionDeps = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: { current: AbortController | null }
  clearBusyWatchdog: () => void
}

/**
 * The store's `removeWorkspace` action. Hiding a project is local-only
 * bookkeeping (no runtime/threads deletion), so it also works while the
 * runtime is offline; only the optional settings sync needs the bridge.
 */
export function createRemoveWorkspaceAction(
  { set, get, sseAbortRef, clearBusyWatchdog }: RemoveActionDeps
): ChatState['removeWorkspace'] {
  return async (workspacePath, relatedPaths = []) => {
    const normalizedPath = normalizeWorkspaceRoot(workspacePath)
    if (!normalizedPath) return
    const state = get()
    // Aliases were resolved by the sidebar while it had both persisted and
    // transient Git-discovery metadata. They are authoritative here: normalize
    // and merge them without applying a Kun-worktree-only heuristic again.
    const removedRegistry = removedRegistryAfterRemove(
      { projectPath: normalizedPath, aliases: [normalizedPath, ...relatedPaths] },
      state.removedCodeWorkspaces ?? { version: 1, removed: [] }
    )
    const visibility = removedWorkspaceVisibilityForState(state, removedRegistry)
    if (visibility.activeThreadRemoved) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    const codeWorkspaceRoots = visibility.patch.codeWorkspaceRoots ?? []
    saveCodeWorkspaceRoots(codeWorkspaceRoots)
    // Local state is authoritative for UX and is committed before any IPC.
    // Settings persistence is best-effort and can never resurrect this root.
    set({ ...visibility.patch, error: null })
    if (!visibility.selectedWorkspaceRemoved) return
    try {
      if (typeof window.kunGui?.setSettings === 'function') {
        await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      }
    } catch (e) {
      set({ error: describeRuntimeError(e).message })
    }
  }
}
