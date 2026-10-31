import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { NormalizedThread } from '../../agent/types'
import type { ThreadListPage } from '../../agent/provider-types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import {
  readWriteThreadRegistry,
  writeWorkspaceKey
} from '../../write/write-thread-registry'
import { buildWorkSessions, workSessionDisplayTitle, type WorkSessionEntry } from '../../write/work-sessions-model'
import { recoverWorkTitle, type RecoveredWorkTitle } from '../../write/work-session-title-recovery'
import { useWorkSessionStore } from '../../write/work-session-store'
import { usePaperBatchInterpret } from '../../paper/paper-batch-interpret'

const PAGE_LIMIT = 80
const SEARCH_DELAY_MS = 200
const TITLE_RECOVERY_CONCURRENCY = 4

type Listing = {
  key: string
  search: string
  threads: NormalizedThread[]
  nextCursor?: string
  hasMore: boolean
}
const EMPTY_LISTING: Listing = { key: '', search: '', threads: [], hasMore: false }

function appendThreads(current: NormalizedThread[], incoming: NormalizedThread[]): NormalizedThread[] {
  const seen = new Set(current.map((thread) => thread.id))
  return [...current, ...incoming.filter((thread) => !seen.has(thread.id) && (seen.add(thread.id), true))]
}

function applyThreadMutations(
  threads: NormalizedThread[],
  changes: Array<{ id: string; patch: Partial<NormalizedThread> | null }>
): NormalizedThread[] {
  let result = threads
  for (const change of changes) {
    result = change.patch === null ? result.filter((thread) => thread.id !== change.id)
      : result.map((thread) => thread.id === change.id ? { ...thread, ...change.patch } : thread)
  }
  return result
}

function applyRecoveredTitle(thread: NormalizedThread, originalTitle: string, result: RecoveredWorkTitle): NormalizedThread {
  if (thread.title !== originalTitle || thread.titleAuto === false ||
    workSessionDisplayTitle(thread.title, thread.titleAuto, thread.id)) return thread
  return { ...thread, ...result }
}

/** Work owns its own server-side inventory, separate from the shared Code list. */
async function listSpaceWriteThreads(root: string, search: string, cursor?: string): Promise<ThreadListPage> {
  const provider = getProvider()
  if (typeof provider.listThreadsPage !== 'function') throw new Error('Paginated thread listing is unavailable')
  const page = await provider.listThreadsPage({
    workspace: root,
    includeArchived: false,
    workspaceMode: 'code',
    workbenchScope: 'work',
    lean: true,
    limit: PAGE_LIMIT,
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {})
  })
  if (page.workbenchScopeApplied !== true || (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))) {
    throw new Error('Work thread pagination is unavailable')
  }
  return page
}

/** The sessions of the current space, newest first. */
export function useWorkSessions(query: string): {
  root: string
  sessions: WorkSessionEntry[]
  loading: boolean
  hasMore: boolean
  error: 'initial' | 'more' | null
  loadMore: () => void
  /** Mirror a rename/archive/delete into the listing right away. */
  patchThread: (threadId: string, patch: Partial<NormalizedThread>) => void
  forgetThread: (threadId: string) => void
  /** List the space again, e.g. after a session came back from the archive. */
  reload: () => void
} {
  const { root, whiteboards } = useWriteWorkspaceStore(useShallow((state) => ({
    root: state.workspaceRoot,
    whiteboards: state.whiteboards
  })))
  const threads = useChatStore((state) => state.threads)
  const runtimeReady = useChatStore((state) => state.runtimeConnection === 'ready')
  const [listed, setListed] = useState<Listing>(EMPTY_LISTING)
  const [normal, setNormal] = useState<Listing>(EMPTY_LISTING)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<'initial' | 'more' | null>(null)
  const [reloads, setReloads] = useState(0)
  // Latest request wins: a slower, older listing never overwrites a newer one.
  const sequence = useRef(0)
  const loadingMore = useRef<number | null>(null)
  const mutations = useRef<Array<{ id: string; patch: Partial<NormalizedThread> | null }>>([])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const key = writeWorkspaceKey(root)
  const search = query.trim()
  useEffect(() => {
    const request = ++sequence.current
    loadingMore.current = null
    if (!runtimeReady || !key) {
      setLoading(false)
      return
    }
    const current = (): boolean => mounted.current && sequence.current === request
    setLoading(true)
    setError(null)
    const run = (): void => {
      // Starting a new first-page request invalidates all older requests.
      mutations.current = []
      const mutationStart = 0
      void listSpaceWriteThreads(root, search)
        .then((page) => {
          if (!current()) return
          const changes = mutations.current.slice(mutationStart)
          const updated = applyThreadMutations(page.threads, changes)
          const result = { key, search, threads: updated, nextCursor: page.nextCursor, hasMore: page.hasMore }
          setListed(result)
          if (!search) setNormal((previous) => previous.key !== key ? result : {
            ...result, threads: appendThreads(updated, previous.threads)
          })
        })
        .catch(() => { if (current()) setError('initial') })
        .finally(() => { if (current()) setLoading(false) })
    }
    const timer = search ? setTimeout(run, SEARCH_DELAY_MS) : undefined
    if (!search) run()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      sequence.current += 1
    }
  }, [key, root, runtimeReady, reloads, search])

  const reload = useCallback((): void => setReloads((count) => count + 1), [])
  const loadMore = useCallback((): void => {
    if (loading || loadingMore.current === sequence.current || listed.key !== key || listed.search !== search ||
      !listed.hasMore || !listed.nextCursor) return
    const request = sequence.current
    const cursor = listed.nextCursor
    const mutationStart = mutations.current.length
    loadingMore.current = request
    setLoading(true)
    setError(null)
    void listSpaceWriteThreads(root, search, cursor)
      .then((page) => {
        if (!mounted.current || sequence.current !== request) return
        const updated = applyThreadMutations(page.threads, mutations.current.slice(mutationStart))
        setListed((current) => {
          if (current.key !== key || current.search !== search || current.nextCursor !== cursor) return current
          return { ...current, threads: appendThreads(current.threads, updated),
            nextCursor: page.nextCursor, hasMore: page.hasMore }
        })
        if (!search) setNormal((current) => current.key !== key ? current : {
          ...current, threads: appendThreads(current.threads, updated),
          nextCursor: page.nextCursor, hasMore: page.hasMore
        })
      })
      .catch(() => { if (mounted.current && sequence.current === request) setError('more') })
      .finally(() => {
        if (loadingMore.current === request) loadingMore.current = null
        if (mounted.current && sequence.current === request) setLoading(false)
      })
  }, [key, listed, loading, root, search])

  // Sessions created in the background (a batch interpretation) only pass
  // through the shared list, whose next refresh may page them out. List the
  // space again once for every such session the listing does not have yet.
  const requested = useRef(new Set<string>())
  useEffect(() => {
    if (!runtimeReady || !key || search || listed.key !== key || listed.search) return
    const have = new Set(listed.threads.map((thread) => thread.id))
    const missing = buildWorkSessions({ root, threads, registry: readWriteThreadRegistry() })
      .map((session) => session.id)
      .filter((id) => !have.has(id) && !requested.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) requested.current.add(id)
    reload()
  }, [key, listed, reload, root, runtimeReady, search, threads])

  // A finished batch moved its sessions forward; list them in their new order.
  const batchRunning = usePaperBatchInterpret((state) => Boolean(state.job?.running))
  const wasRunning = useRef(batchRunning)
  useEffect(() => {
    if (wasRunning.current && !batchRunning) reload()
    wasRunning.current = batchRunning
  }, [batchRunning, reload])
  const patchThread = useCallback((threadId: string, patch: Partial<NormalizedThread>): void => {
    mutations.current.push({ id: threadId, patch })
    const apply = (current: Listing): Listing => ({
      ...current,
      threads: current.threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread))
    })
    setListed(apply)
    setNormal(apply)
  }, [])
  const forgetThread = useCallback((threadId: string): void => {
    mutations.current.push({ id: threadId, patch: null })
    const remove = (current: Listing): Listing => ({
      ...current, threads: current.threads.filter((thread) => thread.id !== threadId)
    })
    setListed(remove)
    setNormal(remove)
  }, [])

  const sourceThreads = useMemo(() => {
    const cached = normal.key === key ? normal.threads : []
    const current = listed.key === key && listed.search === search ? listed.threads : []
    return appendThreads(appendThreads(threads, cached), current)
  }, [key, listed, normal, search, threads])
  const boards = useMemo(() => Object.values(whiteboards).map((board) => ({
    id: board.id,
    workspaceRoot: board.workspaceRoot,
    threadIds: workWhiteboardThreadIds(board)
  })), [whiteboards])
  const allSessions = useMemo(() => buildWorkSessions({
    root, threads: sourceThreads, registry: readWriteThreadRegistry(), boards
  }), [root, sourceThreads, boards])
  const sessions = useMemo(() => {
    if (!search) return allSessions
    const remote = listed.key === key && listed.search === search ? buildWorkSessions({
      root, threads: listed.threads, registry: readWriteThreadRegistry(), boards
    }) : []
    const local = buildWorkSessions({ root, threads: sourceThreads, registry: readWriteThreadRegistry(), boards, query: search })
    const ids = new Set(remote.map((session) => session.id))
    return [...remote, ...local.filter((session) => !ids.has(session.id))]
      .sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
  }, [allSessions, boards, key, listed, root, search, sourceThreads])

  // Recover older placeholders without loading every timeline into the renderer.
  const titleRequests = useRef(new Set<string>())
  useEffect(() => {
    if (!runtimeReady || !key || listed.key !== key) return
    const sources = new Map(sourceThreads.map((thread) => [thread.id, thread]))
    const pending = allSessions.flatMap((session) => {
      const thread = sources.get(session.id)
      if (session.title || !thread || thread.titleAuto === false || thread.turnCount === 0 ||
        titleRequests.current.has(thread.id)) return []
      titleRequests.current.add(thread.id)
      return [{ id: thread.id, originalTitle: thread.title }]
    })
    let next = 0
    const drain = async (): Promise<void> => {
      while (next < pending.length) {
        const candidate = pending[next++]!
        try {
          const result = await recoverWorkTitle(candidate.id)
          if (!mounted.current || writeWorkspaceKey(useWriteWorkspaceStore.getState().workspaceRoot) !== key) {
            titleRequests.current.delete(candidate.id)
            continue
          }
          if (!result || !workSessionDisplayTitle(result.title, result.titleAuto, candidate.id)) {
            // A later listing or newly available history can make recovery possible.
            titleRequests.current.delete(candidate.id)
            continue
          }
          const live = useChatStore.getState().threads.find((thread) => thread.id === candidate.id)
          const liveTitle = live && workSessionDisplayTitle(live.title, live.titleAuto, live.id)
          const listedResult = liveTitle ? { title: liveTitle, titleAuto: live.titleAuto, agentSurface: live.agentSurface === 'write' ? 'write' as const : undefined } : result
          const updateTitle = (current: Listing): Listing => current.key !== key ? current : {
            ...current,
            threads: current.threads.map((thread) => thread.id === candidate.id
              ? applyRecoveredTitle(thread, candidate.originalTitle, listedResult)
              : thread)
          }
          setListed(updateTitle)
          setNormal(updateTitle)
          useChatStore.setState((current) => ({
            threads: current.threads.map((thread) => thread.id === candidate.id
              ? applyRecoveredTitle(thread, candidate.originalTitle, result)
              : thread)
          }))
        } catch {
          titleRequests.current.delete(candidate.id)
        }
      }
    }
    for (let index = 0; index < Math.min(TITLE_RECOVERY_CONCURRENCY, pending.length); index += 1) void drain()
  }, [allSessions, key, listed.key, runtimeReady, sourceThreads])

  // The assistant panel and tabs name sessions even while the list is filtered.
  useEffect(() => {
    useWorkSessionStore.getState().rememberTitles(allSessions)
  }, [allSessions])

  return { root, sessions, loading, error, loadMore,
    hasMore: listed.key === key && listed.search === search && listed.hasMore,
    patchThread, forgetThread, reload }
}
