import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { hasKunAccountSession } from '@shared/kun-account'
import { useKunAccount } from '../account/useKunAccount'
import { publishMobilePairings } from './mobile-pairing-store'

export type MobileLinkBusy = 'start' | 'stop' | 'other' | null

/** Kun iOS relay state for the Remote panel: polling, start/stop, pairing and grants. */
export function useMobileLink() {
  const { i18n } = useTranslation(),
    zh = i18n.language.startsWith('zh'),
    api = window.kunGui?.mobileLink
  const account = useKunAccount(),
    signedIn = hasKunAccountSession(account.state)
  const [state, setState] = useState<MobileLinkStatus>(),
    [busy, setBusy] = useState<MobileLinkBusy>(null),
    [error, setError] = useState('')
  const operation = useRef(0),
    owner = useRef<string | null>(null),
    accountId = signedIn ? account.state.user?.id ?? null : null
  owner.current = accountId
  const unavailable = zh
    ? '连接不可用，请检查 Kun 账号登录和服务状态。'
    : 'Connection unavailable. Check your Kun account and service status.'
  useEffect(() => {
    publishMobilePairings(signedIn && state?.enabled ? state.pairings : [])
  }, [signedIn, state])
  useEffect(() => {
    let active = true
    ++operation.current
    setState(undefined)
    setError('')
    setBusy(null)
    if (!api || !signedIn) return
    async function refresh() {
      const current = operation.current
      try {
        const next = await api!.status()
        if (active && current === operation.current) setState(next)
      } catch { /* keep the last known status */ }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      ++operation.current
      clearInterval(timer)
    }
  }, [api, signedIn, accountId])
  async function action(
    run: () => Promise<MobileLinkStatus>,
    kind: Exclude<MobileLinkBusy, null> = 'other'
  ) {
    const serial = ++operation.current, initiatingOwner = owner.current
    const current = () => serial === operation.current && initiatingOwner === owner.current
    setBusy(kind)
    setError('')
    try {
      const next = await run()
      if (current()) setState(next)
    } catch {
      if (current()) setError(unavailable)
    } finally {
      if (current()) setBusy(null)
    }
  }
  const starting = Boolean(state?.starting || busy === 'start'),
    canStop = signedIn && Boolean(state?.enabled || starting),
    connectionError = error || (state?.error ? unavailable : ''),
    enabled = signedIn && state?.enabled === true
  return {
    api,
    zh,
    account,
    signedIn,
    state,
    busy,
    starting,
    canStop,
    enabled,
    connectionError,
    toggle: () => api && void action(() => api.enable(!canStop), canStop ? 'stop' : 'start'),
    confirm: (id: string) => api && void action(() => api.confirm(id)),
    revoke: (id: string) => api && void action(() => api.revoke(id))
  }
}

export type MobileLink = ReturnType<typeof useMobileLink>
