import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import {
  isWriteAssistantThread,
  readWriteThreadRegistry,
  writeWorkspaceKey
} from '../../write/write-thread-registry'
import { buildWorkSessions, workSessionDisplayTitle, type WorkSessionEntry } from '../../write/work-sessions-model'
import { recoverWorkTitle, type RecoveredWorkTitle } from '../../write/work-session-title-recovery'
import { useWorkSessionStore } from '../../write/work-session-store'
import { usePaperBatchInterpret } from '../../paper/paper-batch-interpret'

const PAGE_LIMIT = 80
const TITLE_RECOVERY_CONCURRENCY = 4

function applyRecoveredTitle(thread: NormalizedThread, originalTitle: string, result: RecoveredWorkTitle): NormalizedThread {
  if (thread.title !== originalTitle || thread.titleAuto === false ||
    workSessionDisplayTitle(thread.title, thread.titleAuto, thread.id)) return thread
  return { ...thread, ...result }
}

/**
 * The shared thread list only carries the most recent page across every
 * workspace, so the current space also lists its own Work threads.
 */
async function listSpaceWriteThreads(root: string): Promise<NormalizedThread[]> {
  const provider = getProvider()
  if (typeof provider.listThreadsPage !== 'function') return []
  const page = await provider.listThreadsPage({
    workspace: root,
    includeArchived: false,
    workspaceMode: 'code',
    lean: true,
    limit: PAGE_LIMIT
  })
  const registry = readWriteThreadRegistry()
  return page.threads.filter((thread) => isWriteAssistantThread(thread, registry))
}

/** The sessions of the current space, newest first. */
export function useWorkSessions(query: string): {
  root: string
  sessions: WorkSessionEntry[]
  loading: boolean
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
  const [listed, setListed] = useState<{ key: string; threads: NormalizedThread[] }>({ key: '', threads: [] })
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  // Latest request wins: a slower, older listing never overwrites a newer one.
  const sequence = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const key = writeWorkspaceKey(root)
  useEffect(() => {
    if (!runtimeReady || !key) return
    const request = ++sequence.current
    const current = (): boolean => mounted.current && sequence.current === request
    setLoading(true)
    void listSpaceWriteThreads(root)
      .then((result) => { if (current()) setListed({ key, threads: result }) })
      .catch(() => undefined)
      .finally(() => { if (current()) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, runtimeReady, reloads])

  const reload = useCallback((): void => setReloads((count) => count + 1), [])

  // Sessions created in the background (a batch interpretation) only pass
  // through the shared list, whose next refresh may page them out. List the
  // space again once for every such session the listing does not have yet.
  const requested = useRef(new Set<string>())
  useEffect(() => {
    if (!runtimeReady || !key || listed.key !== key) return
    const have = new Set(listed.threads.map((thread) => thread.id))
    const missing = buildWorkSessions({ root, threads, registry: readWriteThreadRegistry() })
      .map((session) => session.id)
      .filter((id) => !have.has(id) && !requested.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) requested.current.add(id)
    reload()
  }, [key, listed, reload, root, runtimeReady, threads])

  // A finished batch moved its sessions forward; list them in their new order.
  const batchRunning = usePaperBatchInterpret((state) => Boolean(state.job?.running))
  const wasRunning = useRef(batchRunning)
  useEffect(() => {
    if (wasRunning.current && !batchRunning) reload()
    wasRunning.current = batchRunning
  }, [batchRunning, reload])
  const patchThread = useCallback((threadId: string, patch: Partial<NormalizedThread>): void => {
    setListed((current) => ({
      ...current,
      threads: current.threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread))
    }))
  }, [])
  const forgetThread = useCallback((threadId: string): void => {
    setListed((current) => ({ ...current, threads: current.threads.filter((thread) => thread.id !== threadId) }))
  }, [])

  const sourceThreads = useMemo(() => {
    const known = new Set(threads.map((thread) => thread.id))
    const extra = listed.key === key ? listed.threads.filter((thread) => !known.has(thread.id)) : []
    return [...threads, ...extra]
  }, [key, listed, threads])
  const boards = useMemo(() => Object.values(whiteboards).map((board) => ({
    id: board.id,
    workspaceRoot: board.workspaceRoot,
    threadIds: workWhiteboardThreadIds(board)
  })), [whiteboards])
  const allSessions = useMemo(() => buildWorkSessions({
    root, threads: sourceThreads, registry: readWriteThreadRegistry(), boards
  }), [root, sourceThreads, boards])
  const sessions = useMemo(() => query.trim() ? buildWorkSessions({
    root, threads: sourceThreads, registry: readWriteThreadRegistry(), boards, query
  }) : allSessions, [allSessions, boards, query, root, sourceThreads])

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
          setListed((current) => current.key !== key ? current : {
            ...current,
            threads: current.threads.map((thread) => thread.id === candidate.id
              ? applyRecoveredTitle(thread, candidate.originalTitle, listedResult)
              : thread)
          })
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

  return { root, sessions, loading: loading && listed.key !== key, patchThread, forgetThread, reload }
}
