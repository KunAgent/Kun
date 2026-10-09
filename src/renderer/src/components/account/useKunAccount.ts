import { useEffect, useRef, useState } from 'react'
import type { KunAccountApi, KunAccountState } from '@shared/kun-account'

const initial: KunAccountState = { status: 'loading', user: null, error: null }

export function useKunAccount() {
  const api = window.kunGui?.kunAccount
  const [state, setState] = useState<KunAccountState>(initial)
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    if (!api) { setState({ status: 'anonymous', user: null, error: 'unavailable' }); return () => { mounted.current = false } }
    const stop = api.onState((next) => { revision.current++; if (mounted.current) setState(next) })
    const version = revision.current
    void api.getState().then((next) => { if (mounted.current && version === revision.current) setState(next) })
      .catch(() => { if (mounted.current) setState({ status: 'error', user: null, error: 'service' }) })
    return () => { mounted.current = false; stop() }
  }, [api])
  async function run(action: 'login' | 'cancelLogin' | 'refresh' | 'logout'): Promise<void> {
    if (!api || busy) return
    setBusy(true)
    const version = revision.current
    try {
      const next = await api[action]()
      if (mounted.current && version === revision.current) setState(next)
    } catch { if (mounted.current) setState((current) => ({ ...current, status: 'error', error: 'service' })) }
    finally { if (mounted.current) setBusy(false) }
  }
  return { state, busy, run, api: api as KunAccountApi | undefined }
}
