import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { getProvider } from '../../agent/registry'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { readRuntimeError, readRuntimeJson } from '../../agent/kun-runtime-services'
import { runtimeErrorToError } from '@shared/runtime-error'
import { useActivityStore } from '../../store/activity-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import { childAgentRows, mergeWorkerRows, type WorkerRowData } from './worker-row-data'

/**
 * Team rows for one manager thread: `GET /v1/teams/by-manager/:threadId`
 * merged with live ActivityStore rows. The overview refetches (debounced)
 * whenever a worker row's `updatedAt` advances, so the Collaboration list
 * and the worker tabs track ongoing work. Nothing loads while inactive.
 */
export function useTeamWorkers(managerThreadId: string | null, active: boolean, dispatchIds?: readonly string[]): {
  overview: AdeTeamOverview | null
  rows: WorkerRowData[]
  /** False until the first lookup settles; `null` overview then means no team. */
  loaded: boolean
  loadFailed: boolean
  reload: () => Promise<void>
} {
  const idsKey = dispatchIds === undefined ? '' : JSON.stringify([...new Set(dispatchIds)].sort())
  const scope = JSON.stringify([managerThreadId, idsKey, active])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const activityRows = useActivityStore((s) => s.rows)
  const workerRows = useMemo(
    () => (managerThreadId ? selectWorkerRowsForParent(activityRows, managerThreadId) : []),
    [activityRows, managerThreadId]
  )
  const [storedOverview, setOverview] = useState<AdeTeamOverview | null>(null)
  const [stateScope, setStateScope] = useState(scope)
  // Scope cached data synchronously: effects reset after render, too late to
  // prevent mounting another manager's transcript for a single frame.
  const currentScope = active && stateScope === scope
  const overview = currentScope && managerThreadId ? storedOverview : null
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const loadGeneration = useRef(0)
  const inFlight = useRef<{ scope: string; promise: Promise<void> } | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((threadId: string, requestScope: string, ids: string): Promise<void> => {
    if (inFlight.current?.scope === requestScope) return inFlight.current.promise
    const request = ++loadGeneration.current
    const current = (): boolean => scopeRef.current === requestScope && request === loadGeneration.current
    const run = async (): Promise<void> => {
      try {
        const provider = getProvider()
        if (!ids && !provider.getTeamOverview) {
          if (current()) setLoaded(true)
          return
        }
        let next: AdeTeamOverview | null
        if (ids) {
          const query = new URLSearchParams({ dispatchIds: ids })
          const response = await rendererRuntimeClient.runtimeRequest(`/v1/teams/by-manager/${encodeURIComponent(threadId)}?${query}`, 'GET')
          if (response.status === 404) next = null
          else {
            if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to load worker tasks'))
            next = readRuntimeJson<AdeTeamOverview>(response.body, 'Invalid worker tasks')
          }
        } else next = await provider.getTeamOverview!(threadId)
        if (!current()) return
        setOverview(next)
        setLoaded(true)
        setLoadFailed(false)
      } catch {
        if (current()) setLoadFailed(true)
      }
    }
    // Automatic refreshes share one request; slow responses must not be starved by the poll clock.
    const promise = run().finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null
    })
    inFlight.current = { scope: requestScope, promise }
    return promise
  }, [])

  useEffect(() => {
    if (!active) return
    setStateScope(scope)
    setOverview(null)
    setLoaded(!managerThreadId)
    setLoadFailed(false)
    if (managerThreadId) void load(managerThreadId, scope, idsKey)
    return () => { loadGeneration.current += 1; inFlight.current = null }
  }, [managerThreadId, active, scope, idsKey, load])

  // A thread without a team still refetches so a team created later shows
  // up, and a failed first lookup retries when activity moves.
  const rowStamp = workerRows.map((row) => `${row.unitId}:${row.updatedAt}`).join('|')
  useEffect(() => {
    if (!active || !managerThreadId || (!loaded && !loadFailed)) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void load(managerThreadId, scope, idsKey), 800)
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [rowStamp, managerThreadId, loaded, loadFailed, active, scope, idsKey, load])

  // Repair a missed completion/activity event without polling settled history.
  const unsettled = overview?.dispatches.some((entry) => !['completed', 'failed', 'cancelled'].includes(entry.state)) ?? false
  useEffect(() => {
    if (!active || !managerThreadId || !idsKey || !unsettled) return
    const timer = setInterval(() => void load(managerThreadId, scope, idsKey), 3_000)
    return () => clearInterval(timer)
  }, [active, managerThreadId, idsKey, unsettled, scope, load])

  // The composer's Workers pill counts every worker activity row, so child
  // agents outside a team (subagents, a PPT child) are listed after the team.
  const rows = useMemo(() => {
    const team = overview ? mergeWorkerRows(overview, workerRows) : []
    const teamIds = new Set(overview?.team.workers.map((worker) => worker.workerId) ?? [])
    return [...team, ...childAgentRows(workerRows, teamIds)]
  }, [overview, workerRows])

  const reload = useCallback(
    () => (active && managerThreadId ? load(managerThreadId, scope, idsKey) : Promise.resolve()),
    [load, managerThreadId, active, scope, idsKey]
  )
  return {
    overview, rows,
    loaded: !managerThreadId || (currentScope && loaded),
    loadFailed: currentScope && loadFailed,
    reload
  }
}
