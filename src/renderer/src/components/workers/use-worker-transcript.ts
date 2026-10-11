import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatBlock } from '../../agent/types'
import type { ThreadDetail, ThreadEventSink } from '../../agent/provider-types'
import { getProvider } from '../../agent/registry'
import { formatRuntimeError } from '../../lib/format-runtime-error'

function mergeBlocks(older: ChatBlock[], latest: ChatBlock[]): ChatBlock[] {
  const byId = new Map(older.map((block) => [block.id, block]))
  for (const block of latest) byId.set(block.id, block)
  return [...byId.values()]
}

/** A visible inspector owns exactly one cancellable worker subscription. */
export function useWorkerTranscript(workerId: string, activityStamp: string | undefined) {
  const [snapshot, setSnapshot] = useState<{ workerId: string; detail: ThreadDetail } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const scope = useRef<AbortController | null>(null)
  const history = useRef<ChatBlock[]>([])
  const historyPage = useRef<Pick<ThreadDetail, 'historyCursor' | 'hasMoreHistory'> | null>(null)
  const historyScope = useRef('')
  const provider = getProvider()
  // Old runtimes without subscriptions can still refresh from activity.
  const fallbackStamp = typeof provider.subscribeThreadEvents === 'function' ? '' : activityStamp

  useEffect(() => {
    const key = `${workerId}:${refresh}`
    if (historyScope.current !== key) {
      history.current = []
      historyPage.current = null
      historyScope.current = key
    }
    const current = ++generation.current
    const controller = new AbortController()
    scope.current = controller
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    let again = false
    setLoading(true)
    setLoadingOlder(false)
    setError(null)
    const alive = (): boolean => !controller.signal.aborted && current === generation.current
    const read = async (): Promise<ThreadDetail | undefined> => {
      if (reading) { again = true; return }
      reading = true
      try {
        const detail = await provider.getThreadDetail(workerId, { signal: controller.signal, priority: 'background' })
        if (!alive()) return
        setSnapshot({ workerId, detail: {
          ...detail,
          blocks: mergeBlocks(history.current, detail.blocks),
          ...historyPage.current
        } })
        setError(null)
        return detail
      } catch (cause) {
        if (alive()) setError(formatRuntimeError(cause))
        return undefined
      } finally {
        reading = false
        if (alive()) {
          setLoading(false)
          if (again) { again = false; schedule() }
        }
      }
    }
    const schedule = (): void => {
      if (!alive() || refreshTimer) return
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void read() }, 600)
    }
    const resetHistory = (): void => {
      if (!alive()) return
      history.current = []
      historyPage.current = null
      setSnapshot(null)
      schedule()
    }
    const sink: ThreadEventSink = {
      onSeq: () => undefined, onDeltas: schedule, onAssistantItem: schedule,
      onUserMessage: schedule, onTool: schedule,
      onCompaction: resetHistory,
      onThreadUpdated: resetHistory,
      onApproval: schedule, onApprovalStatus: schedule, onUserInput: schedule,
      onUserInputStatus: schedule, onGoal: schedule, onRuntimeStatus: schedule,
      onTurnComplete: schedule, onError: (cause) => { if (alive()) setError(formatRuntimeError(cause)) }
    }
    void read().then((detail) => {
      if (!detail || !alive() || !provider.subscribeThreadEvents) return
      return provider.subscribeThreadEvents(workerId, detail.latestSeq, sink, controller.signal)
    }).catch((cause: unknown) => { if (alive()) setError(formatRuntimeError(cause)) })
    return () => {
      controller.abort()
      clearTimeout(refreshTimer)
      generation.current += 1
    }
  }, [workerId, refresh, fallbackStamp, provider])

  const detail = snapshot?.workerId === workerId ? snapshot.detail : null
  const loadOlder = useCallback(async (): Promise<void> => {
    if (loadingOlder || !detail?.hasMoreHistory || !detail.historyCursor) return
    const current = generation.current
    setLoadingOlder(true)
    try {
      const older = await provider.getThreadDetail(workerId, {
        before: detail.historyCursor, signal: scope.current?.signal, priority: 'background'
      })
      if (current !== generation.current) return
      history.current = mergeBlocks(older.blocks, detail.blocks)
      historyPage.current = { historyCursor: older.historyCursor, hasMoreHistory: older.hasMoreHistory }
      setSnapshot((previous) => previous?.workerId === workerId ? { workerId, detail: {
        ...previous.detail, blocks: mergeBlocks(older.blocks, previous.detail.blocks),
        historyCursor: older.historyCursor, hasMoreHistory: older.hasMoreHistory
      } } : previous)
    } catch (cause) {
      if (current === generation.current) setError(formatRuntimeError(cause))
    } finally {
      if (current === generation.current) setLoadingOlder(false)
    }
  }, [detail, loadingOlder, provider, workerId])

  return { detail, loading, loadingOlder, error, loadOlder, refresh: () => { setSnapshot(null); setRefresh((value) => value + 1) } }
}
