import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import type { MobileLink } from './useMobileLink'

export function useDesktopAccess(link: MobileLink) {
  const { t } = useTranslation('common')
  const api = link.api
  const owner = link.signedIn ? link.account.state.user?.id : undefined
  const [value, setValue] = useState<DesktopAccessStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const sequence = useRef(0)
  const pending = useRef(false)
  const invalidate = useCallback(() => { ++generation.current; ++sequence.current }, [])
  const refresh = useCallback(async () => {
    if (!api?.desktopStatus || !owner || pending.current) return
    const current = generation.current, request = ++sequence.current
    try {
      const next = await api.desktopStatus()
      if (current === generation.current && request === sequence.current) { setValue(next); setError('') }
    } catch {
      if (current === generation.current && request === sequence.current) setError(t('remoteCompact.desktopReadError'))
    }
  }, [api, owner, t])
  useEffect(() => {
    invalidate(); pending.current = false
    setValue(undefined); setError(''); setBusy(false)
    if (!owner) return
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { invalidate(); clearInterval(timer) }
  }, [owner, refresh, invalidate])

  async function action(run: () => Promise<DesktopAccessStatus | void>) {
    if (pending.current) return
    pending.current = true
    const current = generation.current
    ++sequence.current
    setBusy(true); setError('')
    try {
      const next = await run()
      if (current === generation.current) {
        pending.current = false
        if (next) setValue(next)
        else await refresh()
      }
    } catch {
      if (current === generation.current) setError(t('remoteCompact.desktopActionError'))
    } finally { if (current === generation.current) { pending.current = false; setBusy(false) } }
  }
  function configure(enabled: boolean, tokens: string[]) {
    // Losing membership must never disable the local stop operation.
    if (!api?.desktopConfigure || (enabled && (!link.mobileAllowed || !link.enabled))) return
    void action(() => api.desktopConfigure!({ enabled, displayTokens: tokens }))
  }
  function toggle() {
    if (!value) return
    configure(!value.enabled, value.displays.filter(d => d.allowed).map(d => d.token))
  }
  function permission(kind: 'screenRecording' | 'accessibility') {
    void action(async () => { await window.kunGui.requestComputerUsePermission(kind) })
  }
  return {
    value, error, busy, refresh, configure, toggle, permission,
    stop: () => api?.desktopStop && void action(() => api.desktopStop!()),
    toggleDisabled: busy || !value || (!value.enabled &&
      (!value.supported || !link.mobileAllowed || !link.enabled || !value.displays.some(d => d.allowed)))
  }
}
export type DesktopAccess = ReturnType<typeof useDesktopAccess>
