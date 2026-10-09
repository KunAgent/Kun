import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, LoaderCircle, LogIn, LogOut, RefreshCw, UserRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountError } from '@shared/kun-account'
import { useKunAccount } from './useKunAccount'

const errors: Record<KunAccountError, [string, string]> = {
  network: ['网络连接失败，请重试。', 'Could not connect. Please retry.'],
  configuration: ['账号服务尚未配置完成。', 'Account sign-in is not configured.'],
  expired: ['登录已过期，请重新登录。', 'Your session expired. Sign in again.'],
  cancelled: ['已取消授权，可以重新登录。', 'Authorization was cancelled. You can try again.'],
  timeout: ['本次登录已超时，请重试。', 'Sign-in timed out. Please retry.'],
  port_busy: ['登录回调端口被占用，请关闭其他 Kun 登录后重试。', 'The sign-in port is busy. Finish other Kun sign-ins and retry.'],
  secure_storage: ['请解锁系统钥匙串或凭据存储后重试。', 'Unlock the system credential store and retry.'],
  service: ['账号服务暂时不可用，请稍后重试。', 'Account service is temporarily unavailable.'],
  unavailable: ['请在 Kun 桌面应用中登录。', 'Sign in from the Kun desktop app.']
}

export function KunAccountControl(): ReactElement | null {
  const { i18n } = useTranslation('common')
  const zh = i18n?.language?.startsWith('zh') ?? true
  const copy = (cn: string, en: string) => zh ? cn : en
  const { state, busy, run, api } = useKunAccount()
  const [open, setOpen] = useState(false)
  const [manageError, setManageError] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const authorizing = state.status === 'authorizing'
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  if (!api || window.kunGui.isRemoteWeb) return null
  const rect = trigger.current?.getBoundingClientRect()
  const label = authorizing ? copy('登录中', 'Signing in') : state.user?.name || copy('登录', 'Sign in')
  const row = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-ds-ink hover:bg-ds-bg-soft disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  return <>
    <button ref={trigger} type="button" data-kun-account-login aria-label={state.user ? copy('Kun 账号', 'Kun account') : copy('登录 Kun 账号', 'Sign in to Kun')}
      aria-expanded={open} aria-controls={id} title={state.user?.email || label}
      disabled={busy || state.status === 'loading'}
      onClick={() => { setOpen((value) => !value); if (!state.user && !authorizing) void run('login') }}
      className="flex max-w-[100px] shrink-0 items-center gap-1 rounded-lg border border-ds-border bg-ds-bg-soft px-2 py-1.5 text-[11px] text-ds-muted outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
      {busy || authorizing || state.status === 'loading' ? <LoaderCircle size={13} className="shrink-0 animate-spin" /> : state.user ? <UserRound size={13} className="shrink-0" /> : <LogIn size={13} className="shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={copy('Kun 账号', 'Kun account')}
      className="fixed z-[250] w-[280px] max-w-[calc(100vw-24px)] rounded-xl border border-ds-border bg-ds-card p-3 shadow-2xl"
      style={{ left: Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - 292)), bottom: Math.max(12, window.innerHeight - (rect?.top ?? window.innerHeight - 60) + 8) }}>
      <div className="mb-2 flex items-center justify-between px-2"><strong className="text-[12px] text-ds-ink">{copy('Kun 账号', 'Kun account')}</strong><button type="button" aria-label={copy('关闭', 'Close')} className="rounded p-1 text-ds-faint hover:text-ds-ink" onClick={() => { setOpen(false); trigger.current?.focus() }}><X size={14} /></button></div>
      {state.user ? <div className="mb-2 border-b border-ds-border px-2 pb-3"><p className="break-words text-[13px] font-medium text-ds-ink">{state.user.name}</p><p className="mt-1 break-all text-[11px] text-ds-faint">{state.user.email}</p></div> : null}
      {authorizing ? <p className="px-2 py-2 text-[12px] leading-5 text-ds-muted" role="status">{copy('请在浏览器完成邮箱登录，完成后会自动回到 Kun。', 'Complete email sign-in in your browser. Kun will update automatically.')}</p> : null}
      {state.error || manageError ? <p className="mb-2 px-2 text-[11px] leading-5 text-red-400" role="alert">{errors[state.error || 'service'][zh ? 0 : 1]}</p> : null}
      {authorizing ? <button className={row} disabled={busy} onClick={() => void run('cancelLogin')}><X size={14} />{copy('取消登录', 'Cancel sign-in')}</button>
        : state.user ? <>
          <button className={row} onClick={() => { setManageError(false); void api.openAccountCenter().catch(() => setManageError(true)) }}><ArrowUpRight size={14} />{copy('管理账号', 'Manage account')}</button>
          <button className={row} disabled={busy} onClick={() => void run('refresh')}><RefreshCw size={14} />{copy('刷新账号资料', 'Refresh account')}</button>
          <button className={row} disabled={busy} onClick={() => void run('logout')}><LogOut size={14} />{copy('退出此应用', 'Sign out of this app')}</button>
        </> : <button className={row} disabled={busy} onClick={() => void run('login')}><LogIn size={14} />{copy('使用邮箱验证码登录', 'Sign in with email')}</button>}
    </div>, document.body)}
  </>
}
