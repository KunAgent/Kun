import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { hasKunAccountSession } from '@shared/kun-account'
import { useKunAccount } from '../account/useKunAccount'
import { useAccountEntitlements } from '../account/useAccountEntitlements'
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
  const membership = useAccountEntitlements(accountId)
  const mobileAllowed = membership.value?.features.mobileRemote === true
  const membershipState = !signedIn ? 'signedOut' : membership.value
    ? mobileAllowed ? 'active' : 'free'
    : membership.failed ? 'unavailable' : 'loading'
  const membershipUnknown = zh ? '暂时无法确认会员权益，手机远控已暂停。请刷新会员状态后再试。' : 'Membership could not be verified. Remote access is paused. Refresh membership and try again.'
  const vipRequired = zh ? '手机远控需要 Plus、Pro 或 Max 会员。开通或续期后重新连接。' : 'Mobile remote access requires Plus, Pro or Max. Reconnect after activating or renewing membership.'
  const unavailable = zh
    ? '连接不可用，请检查 Kun 账号登录和服务状态。'
    : 'Connection unavailable. Check your Kun account and service status.'
  const deviceRejected = zh
    ? '这台电脑的远控设备授权已失效或被撤销。请重置远控设备，再开启连接并重新配对手机。'
    : 'This computer\'s remote device authorization is invalid or revoked. Reset the remote device, then enable access and pair your phone again.'
  function failureMessage(code: string): string {
    if (code.includes('DEVICE_AUTHORIZATION_REQUIRED')) return deviceRejected
    if (code.includes('vip_mobile_remote_required') || code === 'VIP_REQUIRED') return vipRequired
    if (code.includes('ENTITLEMENTS_UNAVAILABLE')) return membershipUnknown
    return unavailable
  }
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
      if (current()) { setState(next); return true }
    } catch (failure) {
      if (current()) setError(failureMessage(String(failure)))
    } finally {
      if (current()) setBusy(null)
    }
    return false
  }
  const starting = Boolean(state?.starting || busy === 'start'),
    canStop = signedIn && Boolean(state?.enabled || starting),
    connectionError = error || (signedIn && !mobileAllowed ? membership.value ? vipRequired : membershipUnknown : state?.error ? failureMessage(state.error) : ''),
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
    membershipState,
    mobileAllowed,
    refreshMembership: membership.refresh,
    retryVip: () => api && void action(() => api.reconnect(), 'start'),
    resetIdentity: () => api && void action(() => api.resetIdentity()),
    toggle: () => {
      if (!api || (!canStop && !mobileAllowed)) return
      const stop = canStop && (state?.desktopAccess === true || !mobileAllowed || starting)
      void action(() => api.enable(!stop), stop ? 'stop' : 'start')
    },
    stop: () => api && canStop && void action(() => api.enable(false), 'stop'),
    confirm: (id: string, scopes?: MobileLinkScope[]) => api && void action(() => api.confirm(id, scopes)),
    setScopes: (id: string, scopes: MobileLinkScope[]) => api ? action(() => api.setScopes(id, scopes)) : Promise.resolve(false),
    revoke: (id: string) => api && void action(() => api.revoke(id))
  }
}

export type MobileLink = ReturnType<typeof useMobileLink>
