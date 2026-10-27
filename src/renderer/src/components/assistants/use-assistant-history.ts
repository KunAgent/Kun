import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantHistoryPage, AssistantMailboxStatus } from '@shared/assistant-mailbox'
const empty = (): AssistantHistoryPage => ({ tasks: [], notes: [], hasMore: true })
export function useAssistantHistory(id: string | undefined, status: AssistantMailboxStatus | null) {
  const [page, setPage] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const scope = useRef(0), cursor = useRef<string | undefined>(undefined), loading = useRef(false)
  useEffect(() => {
    scope.current++; cursor.current = undefined; loading.current = false; setPage(empty()); setBusy(false); setError('')
    return () => { scope.current++ }
  }, [id])
  // Keep already loaded older records current when they reappear in a live snapshot.
  useEffect(() => {
    if (!status) return
    setPage(old => ({ ...old, tasks: old.tasks.map(task => status.tasks.find(t => t.id === task.id) ?? task),
      notes: old.notes.map(note => status.notes.find(n => n.id === note.id) ?? note) }))
  }, [status])
  const load = useCallback(async () => {
    const api = window.kunGui?.assistantMailbox?.history
    if (!id || !api || loading.current) return
    const generation = scope.current; loading.current = true; setBusy(true); setError('')
    try {
      const result = await api(id, cursor.current)
      if (scope.current !== generation) return
      cursor.current = result.nextCursor
      setPage(old => ({ ...result, tasks: [...new Map([...old.tasks, ...result.tasks].map(t => [t.id, t])).values()],
        notes: [...new Map([...old.notes, ...result.notes].map(n => [n.id, n])).values()] }))
    } catch (cause) { if (scope.current === generation) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (scope.current === generation) { loading.current = false; setBusy(false) } }
  }, [id])
  const merged = useMemo(() => ({
    tasks: [...new Map([...page.tasks, ...(status?.tasks ?? [])].filter(t => t.assistantId === id).map(t => [t.id, t])).values()],
    notes: [...new Map([...page.notes, ...(status?.notes ?? [])].filter(n => n.assistantId === id).map(n => [n.id, n])).values()]
  }), [page, status, id])
  return { ...merged, hasMore: page.hasMore && Boolean(window.kunGui?.assistantMailbox?.history), busy, error, load }
}
