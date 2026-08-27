import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { getProvider } from '../agent/registry'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../lib/workspace-path'

/**
 * Paginated sidebar thread loading. `refreshThreads` (in the workspace actions
 * file) owns the first-page load; this module owns the "show more" pages that
 * append older threads per workspace using the runtime's keyset cursor.
 */

export const THREAD_LIST_FIRST_PAGE_SIZE = 100
export const THREAD_LIST_PAGE_SIZE = 50

function mergeThreadPages(
  existing: NormalizedThread[],
  incoming: NormalizedThread[]
): NormalizedThread[] {
  const byId = new Map(existing.map((thread) => [thread.id, thread]))
  for (const thread of incoming) {
    // Incoming pages are ordered newest-first; keep the first occurrence so a
    // later refresh does not downgrade a locally-confirmed running state.
    if (!byId.has(thread.id)) byId.set(thread.id, thread)
  }
  return [...byId.values()].sort((a, b) => {
    const timeDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (timeDelta !== 0) return timeDelta
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export type WorkspaceThreadPageMeta = {
  workspaceKey: string
  nextCursor?: string
  hasMore: boolean
  total?: number
}

export function initialWorkspaceThreadPages(
  workspaces: Array<string | undefined>
): Record<string, WorkspaceThreadPageMeta> {
  return Object.fromEntries(
    [...new Set(workspaces)]
      .map((workspace) => normalizeWorkspaceRoot(workspace))
      .filter(Boolean)
      .map((workspace) => {
        const workspaceKey = workspaceRootIdentityKey(workspace)
        return [workspaceKey, { workspaceKey, hasMore: true }]
      })
  )
}

export async function loadMoreThreads(
  workspacePath: string,
  set: ChatStoreSet,
  get: ChatStoreGet
): Promise<void> {
  if (get().runtimeConnection !== 'ready') return
  const normalizedWorkspace = normalizeWorkspaceRoot(workspacePath)
  const workspaceKey = workspaceRootIdentityKey(normalizedWorkspace)
  if (!workspaceKey) return
  const scope = get().threadListCursorByWorkspace[workspaceKey]
  if (!scope || scope.hasMore !== true) return

  try {
    const p = getProvider()
    if (typeof p.listThreadsPage !== 'function') {
      // Older runtime without cursor support: nothing more to load.
      set((s) => ({
        threadListCursorByWorkspace: {
          ...s.threadListCursorByWorkspace,
          [workspaceKey]: { workspaceKey, hasMore: false }
        }
      }))
      return
    }
    const page = await p.listThreadsPage({
      ...(scope.nextCursor ? { cursor: scope.nextCursor } : {}),
      limit: THREAD_LIST_PAGE_SIZE,
      workspace: normalizedWorkspace,
      includeArchived: get().showArchivedThreads,
      includeSide: true,
      lean: true
    })
    const filtered = page.threads.filter((thread) => thread.relation !== 'side')
    set((s) => ({
      threads: mergeThreadPages(s.threads, filtered),
      threadListCursorByWorkspace: {
        ...s.threadListCursorByWorkspace,
        [workspaceKey]: {
          workspaceKey,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          ...(page.total != null ? { total: page.total } : scope.total != null ? { total: scope.total } : {})
        }
      }
    }))
  } catch {
    // Keep the existing cursor so the user can retry "show more" later.
  }
}
