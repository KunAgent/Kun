import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MobileLinkStatus } from '@shared/mobile-link'
import { hasKunAccountSession } from '@shared/kun-account'
import { useKunAccount } from '../account/useKunAccount'
export function MobileLinkPanel() {
  const { i18n } = useTranslation(),
    zh = i18n.language.startsWith('zh'),
    api = window.kunGui?.mobileLink
  const account = useKunAccount(),
    signedIn = hasKunAccountSession(account.state)
  const [state, setState] = useState<MobileLinkStatus>(),
    [busy, setBusy] = useState<'start' | 'stop' | 'other' | null>(null),
    [error, setError] = useState('')
  const operation = useRef(0),
    owner = useRef<string | null>(null),
    accountId = signedIn ? account.state.user?.id ?? null : null
  owner.current = accountId
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
      } catch {}
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
    kind: 'start' | 'stop' | 'other' = 'other'
  ) {
    const serial = ++operation.current, initiatingOwner = owner.current
    const current = () => serial === operation.current && initiatingOwner === owner.current
    setBusy(kind)
    setError('')
    try {
      const next = await run()
      if (current()) setState(next)
    } catch {
      if (current()) setError(
        zh
          ? '连接不可用，请检查 Kun 账号登录和服务状态。'
          : 'Connection unavailable. Check your Kun account and service status.'
      )
    } finally {
      if (current()) setBusy(null)
    }
  }
  if (!api) return null
  const button =
    'rounded border border-ds-border-muted px-3 py-1.5 text-xs disabled:opacity-50'
  const starting = Boolean(state?.starting || busy === 'start'),
    canStop = signedIn && Boolean(state?.enabled || starting),
    connectionError = error || (state?.error
      ? zh ? '连接不可用，请检查 Kun 账号登录和服务状态。'
        : 'Connection unavailable. Check your Kun account and service status.'
      : '')
  return (
    <section className="m-3 rounded-xl border border-ds-border-muted bg-ds-panel p-3 text-ds-ink">
      <div className="flex items-center justify-between">
        <strong>{zh ? 'Kun iOS 手机远程' : 'Kun iOS remote access'}</strong>
        <button
          className={button}
          disabled={!signedIn || !state || busy === 'stop' || (Boolean(busy) && !canStop)}
          onClick={() => void action(() => api.enable(!canStop), canStop ? 'stop' : 'start')}
        >
          {starting
            ? zh
              ? '取消启动'
              : 'Cancel start'
            : signedIn && state?.enabled
            ? zh
              ? '关闭手机远程'
              : 'Stop remote access'
            : zh
              ? '启动手机远程'
              : 'Start remote access'}
        </button>
      </div>
      {!signedIn && (
        <p className="my-2 text-xs text-ds-muted">
          {zh
            ? '请先登录 Kun 账号，登录后可手动启动手机远程。'
            : 'Sign in to Kun, then start remote access manually.'}
          <button
            className={`${button} ml-2`}
            disabled={
              !account.api ||
              Boolean(account.busy) ||
              account.state.status === 'loading' ||
              account.state.status === 'authorizing'
            }
            onClick={() => void account.run('login')}
          >
            {account.state.status === 'authorizing'
              ? zh
                ? '等待登录'
                : 'Waiting for sign-in'
              : zh
                ? '登录 Kun'
                : 'Sign in to Kun'}
          </button>
        </p>
      )}
      <p className="my-2 text-xs text-ds-muted">
        {zh
          ? '每次打开 Kun 默认关闭，需要手动启动。退出或切换账号后自动关闭。'
          : 'Off each time Kun opens. Start manually; signing out or switching accounts stops access.'}
      </p>
      <p className="my-2 text-xs text-ds-muted">
        {busy === 'stop'
          ? zh
            ? '正在关闭'
            : 'Stopping'
          : starting
            ? zh
              ? '正在启动'
              : 'Starting'
          : signedIn && state?.online
          ? zh
            ? '中继已连接'
            : 'Relay connected'
          : signedIn && state?.enabled
            ? zh
              ? '连接中'
              : 'Connecting'
            : zh
              ? '已关闭'
              : 'Off'}{' '}
        ·{' '}
        {zh
          ? '聊天记录留在电脑；附件临时中转。关闭 Kun 后手机不可访问。'
          : 'History stays on this computer; attachments use temporary storage. Keep Kun open.'}
      </p>
      {connectionError && (
        <p role="alert" className="text-xs text-red-500">
          {connectionError}
        </p>
      )}
      {signedIn &&
        state?.enabled &&
        state.pairings.map((p) => (
          <div key={p.id} className="my-2 flex justify-between">
            <span>{p.name}</span>
            <button
              className={button}
              disabled={Boolean(busy)}
              onClick={() => void action(() => api.confirm(p.id))}
            >
              {zh ? '允许访问' : 'Allow access'}
            </button>
          </div>
        ))}
      {signedIn &&
        state?.enabled &&
        state.grants.map((g) => (
          <div key={g.id} className="my-2 flex justify-between text-xs">
            <span>{g.name ?? g.controllerId}</span>
            <button
              className={button}
              disabled={Boolean(busy)}
              onClick={() => void action(() => api.revoke(g.id))}
            >
              {zh ? '撤销' : 'Revoke'}
            </button>
          </div>
        ))}
    </section>
  )
}
