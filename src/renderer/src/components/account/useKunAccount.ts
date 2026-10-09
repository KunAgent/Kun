import { useCallback, useEffect, useRef, useState } from 'react'
import type { KunAccountApi, KunAccountState } from '@shared/kun-account'

const initial: KunAccountState = { status: 'loading', user: null, error: null }

export type KunAccountAction = 'login' | 'reopenLogin' | 'cancelLogin' | 'refresh' | 'logout'
/** Something the panel should open for on its own: a finished or failed browser sign-in. */
export type KunAccountNotice = { kind: 'welcome' | 'failure'; at: number }

export function useKunAccount() {
  const api = window.kunGui?.kunAccount
  const [state, setState] = useState<KunAccountState>(initial)
  const [busy, setBusy] = useState<KunAccountAction | null>(null)
  const [welcome, setWelcome] = useState(false)
  const [notice, setNotice] = useState<KunAccountNotice | null>(null)
  const revision = useRef(0)
  const mounted = useRef(false)
  const previous = useRef<KunAccountState['status']>(initial.status)

  // Every state passes through here in arrival order, so the end of a browser
  // sign-in is seen even when React batches the renders.
  const apply = useCallback((next: KunAccountState) => {
    const wasAuthorizing = previous.current === 'authorizing'
    previous.current = next.status
    setState(next)
    if (!wasAuthorizing || next.status === 'authorizing') return
    if (next.status === 'authenticated') {
      setWelcome(true)
      setNotice({ kind: 'welcome', at: Date.now() })
    } else if (next.error) {
      setNotice({ kind: 'failure', at: Date.now() })
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    if (!api) { setState({ status: 'anonymous', user: null, error: 'unavailable' }); return () => { mounted.current = false } }
    const stop = api.onState((next) => { revision.current++; if (mounted.current) apply(next) })
    const version = revision.current
    void api.getState().then((next) => { if (mounted.current && version === revision.current) apply(next) })
      .catch(() => { if (mounted.current) apply({ status: 'error', user: null, error: 'service' }) })
    return () => { mounted.current = false; stop() }
  }, [api, apply])

  const inflight = useRef<KunAccountAction | null>(null)
  const run = useCallback(async (action: KunAccountAction): Promise<void> => {
    // Cancel and reopen stay available while a sign-in is pending; the rest run one at a time.
    const exclusive = action !== 'cancelLogin' && action !== 'reopenLogin'
    if (!api || (exclusive && inflight.current)) return
    if (exclusive) inflight.current = action
    setBusy(action)
    if (action !== 'reopenLogin') setWelcome(false)
    const version = revision.current
    try {
      const next = await api[action]()
      if (mounted.current && version === revision.current) apply(next)
    } catch {
      if (mounted.current) setState((current) => ({ ...current, status: current.user ? 'authenticated' : 'error', error: 'service' }))
    } finally {
      if (inflight.current === action) inflight.current = null
      if (mounted.current) setBusy((current) => current === action ? null : current)
    }
  }, [api, apply])

  const dismissWelcome = useCallback(() => setWelcome(false), [])
  return { state, busy, welcome, notice, dismissWelcome, run, api: api as KunAccountApi | undefined }
}
