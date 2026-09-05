import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchTrajectoryPage,
  fetchTrajectorySummary,
  type TrajectoryFilter,
  type TrajectoryRecord,
  type TrajectorySummary
} from '../../agent/trajectory'

const EMPTY_SUMMARY: TrajectorySummary = {
  schemaVersion: 2,
  requestCount: 0,
  toolCount: 0,
  runningCount: 0,
  failedCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheHitRate: null,
  avgTtftMs: null,
  avgTokensPerSecond: null,
  totalDurationMs: 0,
  costUsd: 0,
  costCny: 0,
  valueEstimateUsd: 0,
  valueEstimateCny: 0,
  lastStatus: null
}

export type TrajectoryData = {
  records: TrajectoryRecord[]
  summary: TrajectorySummary
  nextCursor?: string
  warnings: string[]
  historyIncomplete: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
  refresh: () => void
  loadOlder: () => void
}

export function useTrajectoryData(input: {
  threadId: string | null
  visible: boolean
  threadRunning: boolean
  filter: TrajectoryFilter
  query: string
}): TrajectoryData {
  const [records, setRecords] = useState<TrajectoryRecord[]>([])
  const [summary, setSummary] = useState<TrajectorySummary>(EMPTY_SUMMARY)
  const [nextCursor, setNextCursor] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  const [historyIncomplete, setHistoryIncomplete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const currentThreadId = useRef(input.threadId)
  const summaryInFlight = useRef(new Map<string, Promise<void>>())
  const latestInFlight = useRef(new Map<string, Promise<void>>())
  currentThreadId.current = input.threadId

  const requestIsCurrent = useCallback((threadId: string, requestGeneration: number): boolean =>
    currentThreadId.current === threadId && generation.current === requestGeneration, [])

  const loadSummary = useCallback(async (): Promise<void> => {
    const threadId = input.threadId
    if (!threadId) return
    const existing = summaryInFlight.current.get(threadId)
    if (existing) return existing
    const current = generation.current
    const task = fetchTrajectorySummary(threadId).then((next) => {
      if (requestIsCurrent(threadId, current)) setSummary(next)
    }).catch(() => {
      // The full page owns visible errors; the button summary degrades quietly.
    })
    summaryInFlight.current.set(threadId, task)
    try {
      await task
    } finally {
      if (summaryInFlight.current.get(threadId) === task) {
        summaryInFlight.current.delete(threadId)
      }
    }
  }, [input.threadId, requestIsCurrent])

  const loadLatest = useCallback(async (showLoading: boolean): Promise<void> => {
    const threadId = input.threadId
    if (!threadId || !input.visible) return
    const current = generation.current
    const existing = latestInFlight.current.get(threadId)
    if (existing) {
      if (showLoading) setLoading(true)
      try {
        await existing
      } finally {
        if (showLoading && requestIsCurrent(threadId, current)) setLoading(false)
      }
      return
    }
    if (showLoading) setLoading(true)
    setError(null)
    const task = fetchTrajectoryPage(threadId, {
      limit: 100
    }).then((page) => {
      if (!requestIsCurrent(threadId, current)) return
      setRecords((existing) => mergeRecords(existing, page.records))
      setSummary(page.summary)
      setNextCursor(page.nextCursor)
      setWarnings(page.warnings)
      setHistoryIncomplete(page.historyIncomplete)
    }).catch((loadError) => {
      if (requestIsCurrent(threadId, current)) setError(message(loadError))
    })
    latestInFlight.current.set(threadId, task)
    try {
      await task
    } finally {
      if (latestInFlight.current.get(threadId) === task) {
        latestInFlight.current.delete(threadId)
      }
      if (showLoading && requestIsCurrent(threadId, current)) setLoading(false)
    }
  }, [input.threadId, input.visible, requestIsCurrent])

  useEffect(() => {
    generation.current += 1
    setRecords([])
    setNextCursor(undefined)
    setWarnings([])
    setHistoryIncomplete(false)
    setError(null)
    setSummary(EMPTY_SUMMARY)
    if (!input.visible) {
      void loadSummary()
      return
    }
    const timer = globalThis.setTimeout(() => void loadLatest(true), 0)
    return () => globalThis.clearTimeout(timer)
  }, [input.threadId, input.visible, loadLatest, loadSummary])

  useEffect(() => {
    if (!input.threadId || (!input.threadRunning && summary.runningCount === 0)) return
    const timer = globalThis.setInterval(() => {
      if (input.visible) void loadLatest(false)
      else void loadSummary()
    }, 1_000)
    return () => globalThis.clearInterval(timer)
  }, [input.threadId, input.threadRunning, input.visible, loadLatest, loadSummary, summary.runningCount])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!input.threadId || !input.visible || !nextCursor || loadingOlder) return
    const current = generation.current
    setLoadingOlder(true)
    try {
      const page = await fetchTrajectoryPage(input.threadId, {
        limit: 100,
        cursor: nextCursor
      })
      if (current !== generation.current) return
      setRecords((existing) => mergeRecords(existing, page.records))
      setNextCursor(page.nextCursor)
      setWarnings(page.warnings)
      setHistoryIncomplete(page.historyIncomplete)
    } catch (loadError) {
      if (current === generation.current) setError(message(loadError))
    } finally {
      if (current === generation.current) setLoadingOlder(false)
    }
  }, [input.threadId, input.visible, loadingOlder, nextCursor])

  return {
    records,
    summary,
    ...(nextCursor ? { nextCursor } : {}),
    warnings,
    historyIncomplete,
    loading,
    loadingOlder,
    error,
    refresh: () => { void loadLatest(true) },
    loadOlder: () => { void loadOlder() }
  }
}

export function mergeRecords(
  existing: readonly TrajectoryRecord[],
  incoming: readonly TrajectoryRecord[]
): TrajectoryRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]))
  incoming.forEach((record) => byId.set(record.id, record))
  return [...byId.values()].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
