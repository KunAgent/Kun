import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'
import { useActivityStore } from '../../store/activity-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import { childAgentRows, mergeWorkerRows, type WorkerRowData } from './worker-row-data'

/**
 * Team rows for one manager thread: `GET /v1/teams/by-manager/:threadId`
 * merged with live ActivityStore rows. The overview refetches (debounced)
 * whenever a worker row's `updatedAt` advances, so the Collaboration list
 * and the worker tabs track ongoing work. Nothing loads while inactive.
 */
export function useTeamWorkers(managerThreadId: string | null, active: boolean): {
  overview: AdeTeamOverview | null
  rows: WorkerRowData[]
  /** False until the first lookup settles; `null` overview then means no team. */
  loaded: boolean
  loadFailed: boolean
  reload: () => Promise<void>
} {
  const managerThreadRef = useRef(managerThreadId)
  managerThreadRef.current = managerThreadId
  const activityRows = useActivityStore((s) => s.rows)
  const workerRows = useMemo(
    () => (managerThreadId ? selectWorkerRowsForParent(activityRows, managerThreadId) : []),
    [activityRows, managerThreadId]
  )
  const [overview, setOverview] = useState<AdeTeamOverview | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const loadGeneration = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (threadId: string): Promise<void> => {
    const request = ++loadGeneration.current
    const current = (): boolean => managerThreadRef.current === threadId && request === loadGeneration.current
    const provider = getProvider()
    if (!provider.getTeamOverview) {
      if (current()) setLoaded(true)
      return
    }
    try {
      const next = await provider.getTeamOverview(threadId)
      if (!current()) return
      setOverview(next)
      setLoaded(true)
      setLoadFailed(false)
    } catch {
      if (current()) setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    setOverview(null)
    setLoaded(false)
    setLoadFailed(false)
    if (managerThreadId) void load(managerThreadId)
    return () => { loadGeneration.current += 1 }
  }, [managerThreadId, active, load])

  // A thread without a team still refetches so a team created later shows
  // up, and a failed first lookup retries when activity moves.
  const rowStamp = workerRows.map((row) => `${row.unitId}:${row.updatedAt}`).join('|')
  useEffect(() => {
    if (!active || !managerThreadId || (!loaded && !loadFailed)) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void load(managerThreadId), 800)
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [rowStamp, managerThreadId, loaded, loadFailed, active, load])

  // The composer's Workers pill counts every worker activity row, so child
  // agents outside a team (subagents, a PPT child) are listed after the team.
  const rows = useMemo(() => {
    const team = overview ? mergeWorkerRows(overview, workerRows) : []
    const teamIds = new Set(overview?.team.workers.map((worker) => worker.workerId) ?? [])
    return [...team, ...childAgentRows(workerRows, teamIds)]
  }, [overview, workerRows])

  const reload = useCallback(
    () => (managerThreadId ? load(managerThreadId) : Promise.resolve()),
    [load, managerThreadId]
  )
  return { overview, rows, loaded, loadFailed, reload }
}
