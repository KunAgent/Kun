import { getProvider } from '../agent/registry'
import type { NormalizedThread } from '../agent/types'
import {
  additionalWorkspacesEqual,
  additionalWorkspacesForThread,
  codeWorkspaceProjectFor,
  extraRootsForPrimary,
  forgetCodeWorkspaceFolderSet,
  saveCodeWorkspaceFolderSets,
  type CodeWorkspaceFolderSetsRegistry
} from '../lib/code-workspace-folder-sets'
import { folderSetPrimaryForWorkspace } from '../lib/code-workspace-folder-lookup'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'

export function commitCodeWorkspaceFolderSets(
  set: ChatStoreSet,
  registry: CodeWorkspaceFolderSetsRegistry
): CodeWorkspaceFolderSetsRegistry {
  const saved = saveCodeWorkspaceFolderSets(registry)
  set({ codeWorkspaceFolderSets: saved })
  return saved
}

export function forgetProjectFolderSet(
  set: ChatStoreSet,
  get: ChatStoreGet,
  primary: string
): void {
  commitCodeWorkspaceFolderSets(set, forgetCodeWorkspaceFolderSet(primary, get().codeWorkspaceFolderSets))
}

export function threadFolderSetPrimary(
  thread: Pick<NormalizedThread, 'id' | 'workspace'> | null | undefined,
  workspaceFallback = ''
): string {
  if (!thread) return folderSetPrimaryForWorkspace(workspaceFallback)
  const record = readThreadWorktreeRegistry().worktrees[thread.id]
  const projectPath = normalizeWorkspaceRoot(record?.projectPath ?? '')
  if (projectPath) return projectPath
  return folderSetPrimaryForWorkspace(thread.workspace || workspaceFallback)
}

export function retainThreadAdditionalWorkspaces(
  incoming: readonly NormalizedThread[],
  previous: readonly NormalizedThread[]
): NormalizedThread[] {
  const previousById = new Map(
    previous.map((thread) => [thread.id, thread.additionalWorkspaces] as const)
  )
  return incoming.map((thread) => {
    if (thread.additionalWorkspaces !== undefined) return thread
    const extras = previousById.get(thread.id)
    return extras?.length ? { ...thread, additionalWorkspaces: extras } : thread
  })
}

export async function syncThreadAdditionalWorkspaces(options: {
  set: ChatStoreSet
  get: ChatStoreGet
  threadId: string
}): Promise<boolean> {
  const { set, get, threadId } = options
  const thread = get().threads.find((candidate) => candidate.id === threadId) ??
    (get().adeThreads ?? []).find((candidate) => candidate.id === threadId)
  if (!thread) return false
  const primary = threadFolderSetPrimary(thread, get().workspaceRoot)
  if (!primary) return false

  // Project folders are authoritative here. Aging thread snapshots are not
  // merged back in, so a folder removed from a project stays removed.
  const registry = get().codeWorkspaceFolderSets
  // Without a project record there is nothing authoritative to sync from;
  // legacy thread snapshots keep their own extras.
  if (!codeWorkspaceProjectFor(registry, primary)) return false

  const extras = additionalWorkspacesForThread(thread.workspace ?? primary, extraRootsForPrimary(primary, registry))
  if (additionalWorkspacesEqual(thread.additionalWorkspaces, extras)) return false
  if (thread.status === 'running' || (get().activeThreadId === threadId && get().busy)) return false

  const update = getProvider().updateThreadAdditionalWorkspaces
  if (!update) return false
  try {
    const updated = await update.call(getProvider(), threadId, extras)
    set((state) => ({
      adeThreads: (state.adeThreads ?? []).map((candidate) =>
        candidate.id === threadId
          ? { ...candidate, ...updated, additionalWorkspaces: extras }
          : candidate
      ),
      threads: state.threads.map((candidate) =>
        candidate.id === threadId
          ? { ...candidate, ...updated, additionalWorkspaces: extras }
          : candidate
      )
    }))
    return true
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) })
    return false
  }
}
