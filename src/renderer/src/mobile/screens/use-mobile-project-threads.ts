import { useEffect, useMemo, useRef, useState } from 'react'
import { getProvider } from '../../agent/registry'
import type { NormalizedThread } from '../../agent/types'
import {
  selectCodeProjectThreads,
  sortSidebarThreads
} from '../../components/chat/sidebar-project-selectors'
import { worktreePathsForProject } from '../../lib/worktree-project-path'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { useThreadClassificationRegistries } from '../../lib/thread-classification-registries'
import {
  threadPageMode,
  type WorkspaceThreadPageStatus
} from '../../store/chat-store-thread-pagination'
import { useChatStore } from '../../store/chat-store'
import { useShallow } from 'zustand/react/shallow'

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_PAGE_SIZE = 50

export type MobileProjectThreads = {
  /** Threads shown for the project: server search hits while searching, else the paged list. */
  threads: NormalizedThread[]
  /** True while the project first page or a server search is in flight. */
  loading: boolean
  hasMore: boolean
  pageStatus: WorkspaceThreadPageStatus
  /** First page was requested but the store left the scope `unknown` — offer retry. */
  loadFailed: boolean
  loadMore: () => void
  /** Full inventory refresh, then re-prime the project page. */
  reload: () => void
}

/**
 * Project-scoped thread list for the Remote mobile Code home. The desktop
 * sidebar relies on `useSidebarWorkspaceAutoLoad`; this hook applies the same
 * contract for a single selected project: a cold project (outside the global
 * first page) fetches its first page on entry, and search delegates to the
 * server's `workspace` + `search` filter instead of only scanning local rows.
 */
export function useMobileProjectThreads(
  project: string | null,
  search: string
): MobileProjectThreads {
  const chat = useChatStore(useShallow((s) => ({
    threads: s.threads,
    cursors: s.threadListCursorByWorkspace,
    status: s.threadListStatus,
    runtimeConnection: s.runtimeConnection,
    workspaceRoots: s.codeWorkspaceRoots,
    clawChannels: s.clawChannels
  })))
  const loadMoreThreads = useChatStore((s) => s.loadMoreThreads)
  const refreshThreads = useChatStore((s) => s.refreshThreads)

  // Registries live in profile storage, not the store; re-check them whenever
  // the thread inventory changes. The shared reader keeps the parsed values
  // identity-stable while their stored strings are unchanged, so ordinary
  // thread updates neither re-parse four registries nor rerun search below.
  const classification = useThreadClassificationRegistries(chat.threads)

  const normalizedProject = project ? normalizeWorkspaceRoot(project) : ''
  const projectKey = workspaceRootIdentityKey(normalizedProject)
  const mode = threadPageMode(false)
  const page = projectKey ? chat.cursors[projectKey] : undefined
  const pageStatus: WorkspaceThreadPageStatus =
    page && page.mode === mode ? page.status : 'unknown'

  const projectThreads = useMemo(() => {
    if (!normalizedProject) return []
    return sortSidebarThreads(selectCodeProjectThreads({
      threads: chat.threads,
      projectRoot: normalizedProject,
      workspaceRoots: chat.workspaceRoots,
      threadWorktrees: classification.threadWorktrees,
      clawChannels: chat.clawChannels,
      writeRegistry: classification.writeRegistry,
      designRegistry: classification.designRegistry,
      sddRegistry: classification.sddRegistry
    }))
  }, [chat.clawChannels, chat.threads, chat.workspaceRoots, classification, normalizedProject])

  // Auto-load the project's first page once the runtime is ready. A page that
  // failed back to `unknown` is not retried here — `reload` is the explicit
  // retry path — so a flaky runtime cannot spin the effect.
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!normalizedProject || !projectKey) return
    const ready = chat.runtimeConnection === 'ready' &&
      (chat.status === 'ready' || chat.status === 'refreshing')
    if (!ready) return
    if (page && page.mode === mode && page.status !== 'unknown') return
    const attemptKey = `${projectKey}:${mode}`
    if (attempted.current.has(attemptKey)) return
    attempted.current.add(attemptKey)
    void loadMoreThreads(normalizedProject)
  }, [chat.runtimeConnection, chat.status, loadMoreThreads, mode, normalizedProject, page, projectKey])

  // Server-side search so sessions outside every loaded page are findable.
  const [searchResult, setSearchResult] = useState<{
    projectKey: string
    query: string
    threads: NormalizedThread[]
  } | null>(null)
  const [searching, setSearching] = useState(false)
  const searchGeneration = useRef(0)
  const query = search.trim()
  // A stable string key keeps the search effect from re-firing on every
  // thread-list update; the workspaces list is rebuilt inside the effect.
  const worktreeKey = normalizedProject
    ? worktreePathsForProject(normalizedProject, classification.threadWorktrees).join('\n')
    : ''
  useEffect(() => {
    if (!normalizedProject || !query) {
      searchGeneration.current += 1
      setSearchResult(null)
      setSearching(false)
      return
    }
    const generation = ++searchGeneration.current
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const provider = getProvider()
          const workspaces = worktreeKey ? worktreeKey.split('\n') : []
          const pageResult = typeof provider.listThreadsPage === 'function'
            ? await provider.listThreadsPage({
                workspace: normalizedProject,
                ...(workspaces.length ? { workspaces } : {}),
                search: query,
                limit: SEARCH_PAGE_SIZE,
                includeSide: false,
                lean: true
              })
            : { threads: [] as NormalizedThread[], hasMore: false }
          if (searchGeneration.current !== generation) return
          setSearchResult({
            projectKey: workspaceRootIdentityKey(normalizedProject),
            query,
            // Match pagination: thread workspaces arrive raw and are
            // normalized before they join the project-scoped list.
            threads: pageResult.threads.map((thread) => ({
              ...thread,
              workspace: normalizeWorkspaceRoot(thread.workspace)
            }))
          })
        } catch {
          if (searchGeneration.current === generation) {
            setSearchResult({
              projectKey: workspaceRootIdentityKey(normalizedProject),
              query,
              threads: []
            })
          }
        } finally {
          if (searchGeneration.current === generation) setSearching(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [normalizedProject, query, worktreeKey])

  const searchThreads = useMemo(() => {
    if (!query || !searchResult || searchResult.projectKey !== projectKey ||
      searchResult.query !== query) return null
    return sortSidebarThreads(selectCodeProjectThreads({
      threads: searchResult.threads,
      projectRoot: normalizedProject,
      workspaceRoots: chat.workspaceRoots,
      threadWorktrees: classification.threadWorktrees,
      clawChannels: chat.clawChannels,
      writeRegistry: classification.writeRegistry,
      designRegistry: classification.designRegistry,
      sddRegistry: classification.sddRegistry
    }))
  }, [chat.clawChannels, chat.workspaceRoots, classification, normalizedProject, projectKey, query, searchResult])

  // A scope entry that stayed `unknown` after the auto-load attempt means the
  // first page failed; without an error surface the pane would spin forever.
  const attemptKey = `${projectKey}:${mode}`
  const loadFailed = !query && chat.status !== 'loading' &&
    attempted.current.has(attemptKey) && pageStatus === 'unknown'
  return {
    threads: query ? searchThreads ?? [] : projectThreads,
    loading: (query ? searching
      : pageStatus === 'loading' || (pageStatus === 'unknown' && !loadFailed)) &&
      chat.status !== 'error',
    loadFailed,
    hasMore: !query && page?.mode === mode && page.hasMore === true,
    pageStatus,
    loadMore: () => {
      if (normalizedProject) void loadMoreThreads(normalizedProject)
    },
    reload: () => {
      if (!normalizedProject) return
      if (projectKey) attempted.current.delete(`${projectKey}:${mode}`)
      void refreshThreads().finally(() => {
        void loadMoreThreads(normalizedProject)
      })
    }
  }
}
