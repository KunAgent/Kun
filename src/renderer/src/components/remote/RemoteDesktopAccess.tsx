import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS } from './remote-panel-ui'
import { desktopFailureMessage, desktopReadiness } from './desktop-readiness'

export function RemoteDesktopAccess({ zh, signedIn }: { zh: boolean; signedIn: boolean }): ReactElement | null {
  const api = typeof window === 'undefined' ? undefined : window.kunGui?.mobileLink
  const [value, setValue] = useState<DesktopAccessStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const refresh = useCallback(() => {
    void api?.desktopStatus?.().then(next => { setValue(next); setReadError('') })
      .catch(() => setReadError(zh ? '无法读取内置远控状态，请刷新重试。' : 'Desktop state unavailable. Refresh to retry.'))
  }, [api, zh])
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [refresh])
  if (!signedIn || !api?.desktopConfigure) return null
  async function configure(enabled: boolean, displayTokens: string[]) {
    if (busy) return
    setBusy(true); setError('')
    try { setValue(await api!.desktopConfigure!({ enabled, displayTokens })) }
    catch { setError(zh ? '无法配置内置远控，请重新检查显示器和系统权限。' : 'Could not configure sharing. Recheck displays and system permissions.') }
    finally { setBusy(false) }
  }
  function permission(kind: 'screenRecording' | 'accessibility') {
    setError('')
    void window.kunGui.requestComputerUsePermission(kind).then(refresh)
      .catch(() => setError(zh ? '无法打开系统权限设置，请手动打开「系统设置 → 隐私与安全性」。' : 'Open System Settings → Privacy & Security manually.'))
  }
  const state = value && !readError && desktopReadiness(value, zh)
  return <section className="flex flex-col gap-3 border-t border-ds-border p-3 text-[12px]" aria-label={zh ? 'Kun 内置远控' : 'Kun built-in desktop'}>
    <div className="flex flex-wrap items-center gap-2">
      <strong className="flex-1">{zh ? 'Kun 内置远控' : 'Kun built-in desktop'}</strong>
      <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => { setError(''); refresh() }}>{zh ? '重新检查' : 'Recheck'}</button>
      {value?.supported ? <button type="button" className={value.enabled ? REMOTE_BUTTON_CLASS : REMOTE_PRIMARY_BUTTON_CLASS}
        disabled={busy || (!value.enabled && !value.displays.some(display => display.allowed))}
        onClick={event => runTrustedUserActivation(event, () => { void configure(!value.enabled, value.displays.filter(display => display.allowed).map(display => display.token)) })}>
        {value.enabled ? zh ? '关闭内置远控' : 'Disable desktop' : zh ? '开启内置远控' : 'Enable desktop'}
      </button> : null}
    </div>
    {state ? <div role="status" className="rounded-lg border border-ds-border-muted bg-ds-subtle p-2.5">
      <p className={state.warning ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium text-emerald-600 dark:text-emerald-400'}>{state.label}</p>
      <p className="mt-1 leading-5 text-ds-muted">{state.detail}</p>
    </div> : !error && !readError ? <p role="status" className="text-ds-muted">{zh ? '正在检查电脑端状态…' : 'Checking this computer…'}</p> : null}
    {value?.supported ? <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-ds-ink">{zh ? '1. 选择要共享的显示器' : '1. Choose the shared display'}</legend>
        {value.displays.map(display => <label className="flex items-center gap-2" key={display.token}>
          <input type="checkbox" checked={display.allowed} disabled={busy} onChange={event => runTrustedUserActivation(event, () => {
            const tokens = value.displays.filter(item => item.token === display.token ? event.target.checked : item.allowed).map(item => item.token)
            void configure(value.enabled && tokens.length > 0, tokens)
          })} />{display.label} · {display.pixelWidth}×{display.pixelHeight}
        </label>)}
      </fieldset>
      <div className="flex flex-col gap-2">
        <p className="font-medium text-ds-ink">{zh ? '2. 完成电脑系统权限' : '2. Complete system permissions'}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={value.reason === 'SCREEN_PERMISSION_REQUIRED' ? 'text-amber-600 dark:text-amber-400' : 'text-ds-muted'}>
            {value.reason === 'SCREEN_PERMISSION_REQUIRED' ? zh ? '录屏：当前进程未获授权' : 'Screen Recording: not effective' : zh ? '录屏：已授权' : 'Screen Recording: granted'}
          </span>
          {value.reason === 'SCREEN_PERMISSION_REQUIRED' ? <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => permission('screenRecording')}>{zh ? '设置屏幕录制权限' : 'Screen Recording permission'}</button> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ds-muted">{value.inputReady ? zh ? '键鼠：已授权' : 'Input: granted' : zh ? '键鼠：未授权，可先仅查看' : 'Input: not granted; viewing only'}</span>
          {value.inputReady !== true ? <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => permission('accessibility')}>{zh ? '设置键鼠控制权限' : 'Accessibility permission'}</button> : null}
        </div>
        {value.reason === 'SCREEN_PERMISSION_REQUIRED' || value.inputReady !== true ? <p className="leading-5 text-ds-muted">
          {zh ? '打开系统设置不等于授权完成。请完成密码或触控 ID 验证，再回到这里点「重新检查」。若系统已允许但仍提示未生效，请按系统提示退出并重开 Kun。' : 'Opening System Settings does not complete authorization. Finish any password or Touch ID prompt, then recheck here. If permission is allowed but still ineffective, quit and reopen Kun as prompted.'}
        </p> : null}
      </div>
      <div className="rounded-lg border border-ds-border-muted px-2.5 py-2 leading-5 text-ds-muted">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-ds-ink">{zh ? '3. 为手机保存桌面权限' : '3. Save phone permissions'}</p>
          <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => document.getElementById('mobile-device-permissions')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
            {zh ? '设置手机权限' : 'Phone permissions'}
          </button>
        </div>
        <p className="mt-1">{zh ? '在已连接设备中勾选并保存。重启 Kun 后需重新开启和授权。' : 'Select and save below. Enable sharing and reauthorize after restarting Kun.'}</p>
      </div>
    </> : null}
    {value?.lastFailure ? <p role="alert" className="text-amber-600 dark:text-amber-400">{desktopFailureMessage(value.lastFailure, zh)}</p> : null}
    {value?.active ? <div className="flex items-center gap-2"><span>{zh ? '手机正在共享此桌面' : 'A phone is sharing this desktop'}</span>
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => { void api!.desktopStop!().then(refresh).catch(() => setError(zh ? '尚未确认结束，请再次检查。' : 'Desktop cleanup is not confirmed.')) }}>{zh ? '结束远控' : 'End desktop session'}</button></div> : null}
    {error || readError ? <p role="alert" className="text-ds-danger">{error || readError}</p> : null}
  </section>
}
