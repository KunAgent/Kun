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
import { buildWorkSessionGroups, type WorkSessionGroup } from '../../write/work-sessions-model'

const PAGE_LIMIT = 80

/**
 * The shared thread list only carries the most recent page across every
 * workspace, so each expanded space also lists its own Work threads once.
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

export function useWorkSessionGroups({ query, expandedRoots }: {
  query: string
  expandedRoots: ReadonlySet<string>
}): {
  groups: WorkSessionGroup[]
  loadingRoots: ReadonlySet<string>
  /** Mirror a rename/archive/delete into the per-space listings right away. */
  patchThread: (threadId: string, patch: Partial<NormalizedThread>) => void
  forgetThread: (threadId: string) => void
  /** List a space again, e.g. after a session came back from the archive. */
  reloadRoot: (root: string) => void
} {
  const { spaces, libraries, whiteboards } = useWriteWorkspaceStore(useShallow((state) => ({
    spaces: state.workspaceRoots,
    libraries: state.paperMode.libraries,
    whiteboards: state.whiteboards
  })))
  const threads = useChatStore((state) => state.threads)
  const runtimeReady = useChatStore((state) => state.runtimeConnection === 'ready')
  const [extra, setExtra] = useState<Record<string, NormalizedThread[]>>({})
  const [loadingRoots, setLoadingRoots] = useState<ReadonlySet<string>>(() => new Set())
  const [reloads, setReloads] = useState(0)
  const requested = useRef(new Set<string>())
  // Latest request per space: a slower, older listing never overwrites a newer one.
  const sequence = useRef(new Map<string, number>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const expandedKey = [...expandedRoots].map(writeWorkspaceKey).sort().join('\n')
  useEffect(() => {
    if (!runtimeReady) return
    for (const root of expandedRoots) {
      const key = writeWorkspaceKey(root)
      if (!key || requested.current.has(key)) continue
      requested.current.add(key)
      const request = (sequence.current.get(key) ?? 0) + 1
      sequence.current.set(key, request)
      const current = (): boolean => mounted.current && sequence.current.get(key) === request
      setLoadingRoots((loading) => new Set([...loading, key]))
      // Expanding another space re-runs this effect; in-flight listings keep
      // going rather than being dropped, so no space is left half loaded.
      void listSpaceWriteThreads(root)
        .then((listed) => {
          if (current()) setExtra((existing) => ({ ...existing, [key]: listed }))
        })
        .catch(() => {
          // The shared list still shows what it has; a later expand retries.
          if (current()) requested.current.delete(key)
        })
        .finally(() => {
          if (!current()) return
          setLoadingRoots((loading) => {
            const next = new Set(loading)
            next.delete(key)
            return next
          })
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey, runtimeReady, reloads])

  const reloadRoot = useCallback((root: string): void => {
    const key = writeWorkspaceKey(root)
    if (!key) return
    requested.current.delete(key)
    setReloads((count) => count + 1)
  }, [])

  const patchThread = useCallback((threadId: string, patch: Partial<NormalizedThread>): void => {
    setExtra((current) => Object.fromEntries(Object.entries(current).map(([key, listed]) => [
      key,
      listed.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread))
    ])))
  }, [])
  const forgetThread = useCallback((threadId: string): void => {
    setExtra((current) => Object.fromEntries(Object.entries(current).map(([key, listed]) => [
      key,
      listed.filter((thread) => thread.id !== threadId)
    ])))
  }, [])

  const groups = useMemo(() => {
    const known = new Set(threads.map((thread) => thread.id))
    const merged = [
      ...threads,
      ...Object.values(extra).flat().filter((thread) => !known.has(thread.id))
    ]
    const boards = Object.values(whiteboards).map((board) => ({
      id: board.id,
      workspaceRoot: board.workspaceRoot,
      threadIds: workWhiteboardThreadIds(board)
    }))
    return buildWorkSessionGroups({
      spaces,
      libraries,
      threads: merged,
      registry: readWriteThreadRegistry(),
      boards,
      query
    })
  }, [extra, libraries, query, spaces, threads, whiteboards])

  return { groups, loadingRoots, patchThread, forgetThread, reloadRoot }
}
