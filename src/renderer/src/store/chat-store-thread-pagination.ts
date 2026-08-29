import type { NormalizedThread } from '../agent/types'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { getProvider } from '../agent/registry'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../lib/workspace-path'

/** Project-scoped pagination for the sidebar. Global inventory cursors are never reused here. */
export const THREAD_LIST_FIRST_PAGE_SIZE = 100
export const THREAD_LIST_PAGE_SIZE = 50

export type WorkspaceThreadPageMode = 'active' | 'archived'
export type WorkspaceThreadPageStatus = 'unknown' | 'loading' | 'ready' | 'complete'

export type WorkspaceThreadPageMeta = {
  workspaceKey: string
  mode: WorkspaceThreadPageMode
  status: WorkspaceThreadPageStatus
  nextCursor?: string
  hasMore: boolean
  total?: number
}

const paginationRequests = new WeakMap<ChatStoreGet, Map<string, Promise<void>>>()

export function threadPageMode(showArchived: boolean): WorkspaceThreadPageMode {
  return showArchived ? 'archived' : 'active'
}

export function initialWorkspaceThreadPages(
  workspaces: Array<string | undefined>,
  globalHasMore: boolean,
  mode: WorkspaceThreadPageMode
): Record<string, WorkspaceThreadPageMeta> {
  const pages: Record<string, WorkspaceThreadPageMeta> = {}
  for (const workspace of workspaces) {
    const normalized = normalizeWorkspaceRoot(workspace)
    const workspaceKey = workspaceRootIdentityKey(normalized)
    if (!workspaceKey || pages[workspaceKey]) continue
    pages[workspaceKey] = {
      workspaceKey,
      mode,
      status: globalHasMore ? 'unknown' : 'complete',
      hasMore: globalHasMore
    }
  }
  return pages
}

export function reconcileWorkspaceThreadPages(
  existing: Record<string, WorkspaceThreadPageMeta> | undefined,
  workspaces: Array<string | undefined>,
  globalHasMore: boolean,
  mode: WorkspaceThreadPageMode
): Record<string, WorkspaceThreadPageMeta> {
  const initial = initialWorkspaceThreadPages(workspaces, globalHasMore, mode)
  if (!globalHasMore) return initial
  return {
    ...initial,
    ...Object.fromEntries(Object.entries(existing ?? {}).filter(([, page]) =>
      page.mode === mode && page.status !== 'unknown'
    ))
  }
}

export function mergeThreadPages(
  existing: NormalizedThread[],
  incoming: NormalizedThread[]
): NormalizedThread[] {
  const byId = new Map(existing.map((thread) => [thread.id, thread]))
  for (const thread of incoming) {
    if (!byId.has(thread.id)) byId.set(thread.id, thread)
  }
  return [...byId.values()].sort((a, b) => {
    const timeDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (timeDelta !== 0) return timeDelta
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

export function loadMoreThreads(
  workspacePath: string,
  set: ChatStoreSet,
  get: ChatStoreGet
): Promise<void> {
  if (get().runtimeConnection !== 'ready') return Promise.resolve()
  const normalizedWorkspace = normalizeWorkspaceRoot(workspacePath)
  const workspaceKey = workspaceRootIdentityKey(normalizedWorkspace)
  if (!workspaceKey) return Promise.resolve()
  const mode = threadPageMode(get().showArchivedThreads)
  const scope = get().threadListCursorByWorkspace[workspaceKey]
  if (!scope || scope.mode !== mode || scope.status === 'complete') return Promise.resolve()

  let requests = paginationRequests.get(get)
  if (!requests) {
    requests = new Map()
    paginationRequests.set(get, requests)
  }
  const requestKey = `${workspaceKey}:${mode}:${scope.nextCursor ?? 'first'}`
  const existingRequest = requests.get(requestKey)
  if (existingRequest) return existingRequest

  const request = (async () => {
    set((state) => ({
      threadListCursorByWorkspace: {
        ...state.threadListCursorByWorkspace,
        [workspaceKey]: { ...scope, status: 'loading' }
      }
    }))
    try {
      const provider = getProvider()
      if (typeof provider.listThreadsPage !== 'function') {
        setPageComplete(set, workspaceKey, scope)
        return
      }
      const page = await provider.listThreadsPage({
        ...(scope.nextCursor ? { cursor: scope.nextCursor } : {}),
        limit: THREAD_LIST_PAGE_SIZE,
        workspace: normalizedWorkspace,
        ...(mode === 'archived' ? { archivedOnly: true } : {}),
        includeSide: false,
        lean: true
      })
      const visible = await filterThreadsForSidebar(
        page.threads.map((thread) => ({
          ...thread,
          workspace: normalizeWorkspaceRoot(thread.workspace)
        })),
        provider
      )
      const hasMore = page.hasMore === true && Boolean(page.nextCursor)
      set((state) => {
        if (threadPageMode(state.showArchivedThreads) !== mode) return {}
        return {
          threads: mergeThreadPages(state.threads, visible),
          threadListCursorByWorkspace: {
            ...state.threadListCursorByWorkspace,
            [workspaceKey]: {
              workspaceKey,
              mode,
              status: hasMore ? 'ready' : 'complete',
              hasMore,
              ...(hasMore ? { nextCursor: page.nextCursor } : {}),
              ...(page.total != null ? { total: page.total } : scope.total != null ? { total: scope.total } : {})
            }
          }
        }
      })
    } catch {
      set((state) => {
        if (threadPageMode(state.showArchivedThreads) !== mode) return {}
        return {
          threadListCursorByWorkspace: {
            ...state.threadListCursorByWorkspace,
            [workspaceKey]: { ...scope, status: scope.nextCursor ? 'ready' : 'unknown' }
          }
        }
      })
    }
  })().finally(() => {
    requests?.delete(requestKey)
  })
  requests.set(requestKey, request)
  return request
}

function setPageComplete(
  set: ChatStoreSet,
  workspaceKey: string,
  scope: WorkspaceThreadPageMeta
): void {
  set((state) => ({
    threadListCursorByWorkspace: {
      ...state.threadListCursorByWorkspace,
      [workspaceKey]: { ...scope, status: 'complete', hasMore: false, nextCursor: undefined }
    }
  }))
}
