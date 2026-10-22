import { useCallback, useEffect, useState } from 'react'
import type {
  AssistantEnrollmentRequest, AssistantEnrollmentResult, AssistantMailboxStatus
} from '@shared/assistant-mailbox'

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in IPC handlers.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Assistant mailbox state for the Remote panel; Main pushes updates after every sync. */
export function useAssistantMailbox() {
  const api = window.kunGui?.assistantMailbox
  const [status, setStatus] = useState<AssistantMailboxStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!api) return
    let active = true
    api.status().then((next) => { if (active) setStatus(next) }).catch((loadError: unknown) => {
      if (active) setError(message(loadError))
    })
    const unsubscribe = api.onStatus((next) => { if (active) setStatus(next) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError('')
    try {
      return await work()
    } catch (runError) {
      setError(message(runError))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  const refresh = useCallback(() => run(async () => { if (api) setStatus(await api.refresh()) }), [api, run])
  const revoke = useCallback((id: string) => run(async () => { if (api) setStatus(await api.revoke(id)) }), [api, run])
  const cancel = useCallback((taskId: string) => run(async () => { await api?.cancel(taskId) }), [api, run])
  const createEnrollment = useCallback(
    (request: AssistantEnrollmentRequest): Promise<AssistantEnrollmentResult | undefined> =>
      run(async () => api!.createEnrollment(request)),
    [api, run]
  )

  return { api, status, busy, error, setError, refresh, revoke, cancel, createEnrollment }
}
