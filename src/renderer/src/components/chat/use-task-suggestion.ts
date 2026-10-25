import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { TaskSuggestionActionInput, TaskSuggestionActionName, TaskSuggestionView } from '@shared/task-suggestions'
import { publishTaskSuggestion, taskSuggestionCache, taskSuggestionClient } from '../../agent/task-suggestion-client'

/** One card: events update it at once; a bounded poll repairs missed events while rows are live. */
export function useTaskSuggestion(intentId: string, initial?: TaskSuggestionView) {
  const card = useSyncExternalStore(taskSuggestionCache.subscribe, () => taskSuggestionCache.get(intentId) ?? initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const refresh = useCallback(async () => {
    try { publishTaskSuggestion(await taskSuggestionClient.get(intentId)); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [intentId])
  useEffect(() => { void refresh() }, [refresh])
  const live = card ? card.state === 'countdown' || card.tasks.some((task) => task.state === 'starting' || task.state === 'running') : false
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => { void refresh() }, 4000)
    return () => clearInterval(timer)
  }, [live, refresh])
  const act = useCallback(async (action: TaskSuggestionActionName, input?: TaskSuggestionActionInput) => {
    if (!card || busyRef.current) return undefined
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await taskSuggestionClient.act(card, action, input)
      publishTaskSuggestion(next)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh()
      return undefined
    } finally { busyRef.current = false; setBusy(false) }
  }, [card, refresh])
  return { card, error, busy, act, refresh }
}

/** Every card the conversation owns, loaded once per thread and kept live by events. */
export function useThreadTaskSuggestions(threadId: string | null | undefined): TaskSuggestionView[] {
  const version = useSyncExternalStore(taskSuggestionCache.subscribe, taskSuggestionCache.version)
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    void taskSuggestionClient.list(threadId).then((cards) => {
      if (!cancelled) for (const card of cards) publishTaskSuggestion(card)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [threadId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (threadId ? taskSuggestionCache.forThread(threadId) : []), [threadId, version])
}
