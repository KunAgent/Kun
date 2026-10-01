import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoogleWorkspaceAction, GoogleWorkspaceApi, GoogleWorkspaceStatus } from '@shared/google-workspace'

export function useGoogleWorkspace(api: GoogleWorkspaceApi | undefined) {
  const [status, setStatus] = useState<GoogleWorkspaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const epoch = useRef(0)
  const requestPending = useRef(false)
  const cancelPending = useRef(false)
  const owned = useRef(false)
  const running = useRef(false)

  const accept = useCallback((value: GoogleWorkspaceStatus) => {
    running.current = value.operation?.state === 'running'
    if (!running.current) owned.current = false
    setStatus(value)
  }, [])
  const current = useCallback((token: number) => mounted.current && token === epoch.current, [])
  const invalidate = useCallback(() => { ++epoch.current }, [])
  const refresh = useCallback(async () => {
    if (!api || requestPending.current || cancelPending.current) return
    const token = epoch.current
    setLoading(true)
    try {
      const value = await api.status()
      if (current(token)) { accept(value); setError('') }
    } catch {
      if (current(token)) setError('googleWorkspaceStatusError')
    } finally {
      if (current(token)) setLoading(false)
    }
  }, [accept, api, current])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      invalidate()
      // Navigation, Back and closing Settings cancel only work started here.
      if (owned.current) {
        owned.current = false
        void api?.cancel().catch(() => undefined)
      }
    }
  }, [api, invalidate, refresh])

  useEffect(() => {
    if (!api || status?.operation?.state !== 'running') return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      const token = epoch.current
      try {
        const value = await api.status()
        if (disposed || !current(token)) return
        accept(value)
        if (owned.current && value.operation?.kind === 'login' && value.operation.state === 'running') {
          await api.openAuthorization()
        }
        if (!disposed && current(token)) setError('')
      } catch {
        if (!disposed && current(token)) setError('googleWorkspacePollError')
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 1_000)
      }
    }
    timer = setTimeout(() => void poll(), 1_000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [accept, api, current, status?.operation?.id, status?.operation?.state])

  const run = async (action: GoogleWorkspaceAction): Promise<void> => {
    if (!api || requestPending.current || cancelPending.current || running.current) return
    const token = ++epoch.current
    requestPending.current = true
    owned.current = true
    setPending(true)
    setError('')
    try {
      const value = await api[action]()
      if (!current(token)) return
      accept(value)
      if (owned.current && action === 'login') await api.openAuthorization()
    } catch {
      if (current(token)) setError('googleWorkspaceActionError')
    } finally {
      if (current(token)) {
        requestPending.current = false
        setPending(false)
        setLoading(false)
      }
    }
  }

  const cancel = async (): Promise<void> => {
    if (!api || cancelPending.current) return
    const token = ++epoch.current
    cancelPending.current = true
    setCancelling(true)
    setError('')
    try {
      const value = await api.cancel()
      if (current(token)) { owned.current = false; accept(value) }
    } catch {
      if (current(token)) setError('googleWorkspaceCancelError')
    } finally {
      if (current(token)) {
        cancelPending.current = false
        requestPending.current = false
        setCancelling(false)
        setPending(false)
        setLoading(false)
      }
    }
  }

  return {
    status, loading, error, cancelling, refresh, run, cancel,
    busy: pending || cancelling || status?.operation?.state === 'running'
  }
}
