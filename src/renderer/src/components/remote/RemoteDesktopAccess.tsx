import { useEffect, useState, type ReactElement } from 'react'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS } from './remote-panel-ui'
export function RemoteDesktopAccess({ zh, signedIn }: { zh: boolean; signedIn: boolean }): ReactElement | null {
  const api = typeof window === 'undefined' ? undefined : window.kunGui?.mobileLink
  const [value, setValue] = useState<DesktopAccessStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const refresh = () => { void api?.desktopStatus?.().then(setValue).catch(() => setError(zh ? '无法读取内置远控状态' : 'Desktop state unavailable')) }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [api, zh])
  if (!api?.desktopConfigure || !signedIn || !value?.supported) return null
  async function configure(enabled: boolean, displayTokens: string[]) {
    if (busy) return
    setBusy(true); setError('')
    try { setValue(await api!.desktopConfigure!({ enabled, displayTokens })) }
    catch { setError(zh ? '无法配置内置远控，请先检查屏幕录制权限。' : 'Could not configure desktop sharing. Check Screen Recording permission.') }
    finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-2 border-t border-ds-border p-3 text-[12px]">
    <div className="flex items-center gap-2"><strong className="flex-1">{zh ? 'Kun 内置远控' : 'Kun built-in desktop'}</strong>
      <button type="button" className={value.enabled ? REMOTE_BUTTON_CLASS : REMOTE_PRIMARY_BUTTON_CLASS} disabled={busy || !value.displays.some(display => display.allowed)}
        onClick={event => runTrustedUserActivation(event, () => { void configure(!value.enabled, value.displays.filter(display => display.allowed).map(display => display.token)) })}>
        {value.enabled ? zh ? '关闭内置远控' : 'Disable desktop' : zh ? '开启内置远控' : 'Enable desktop'}
      </button>
    </div>
    <p className="text-ds-muted">{zh ? '仅共享下方选中的显示器。每台手机还须在高级访问里单独批准查看或控制。重启 Kun 后重新配置。' : 'Only selected displays may be shared. Grant each phone desktop view/control separately in Advanced access. Reconfigure after restarting Kun.'}</p>
    {value.displays.map(display => <label className="flex items-center gap-2" key={display.token}>
      <input type="checkbox" checked={display.allowed} disabled={busy} onChange={event => runTrustedUserActivation(event, () => {
        const tokens = value.displays.filter(item => item.token === display.token ? event.target.checked : item.allowed).map(item => item.token)
        void configure(value.enabled && tokens.length > 0, tokens)
      })} />{display.label} · {display.pixelWidth}×{display.pixelHeight}
    </label>)}
    {value.reason === 'SCREEN_PERMISSION_REQUIRED' ? <p className="text-amber-600">{zh ? '需要在系统设置中允许 Kun 屏幕录制。' : 'Allow Kun Screen Recording in System Settings.'}</p> : null}
    {value.reason === 'SCREEN_PERMISSION_REQUIRED' || value.inputReady === false ? <div className="flex flex-wrap gap-2">
      {value.reason === 'SCREEN_PERMISSION_REQUIRED' ? <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => {
        void window.kunGui.requestComputerUsePermission('screenRecording').then(refresh).catch(() => setError(zh ? '无法打开系统权限设置' : 'Could not open system permissions'))
      }}>{zh ? '设置屏幕录制权限' : 'Screen Recording permission'}</button> : null}
      {value.inputReady === false ? <button type="button" className={REMOTE_BUTTON_CLASS} onClick={() => {
        void window.kunGui.requestComputerUsePermission('accessibility').then(refresh).catch(() => setError(zh ? '无法打开系统权限设置' : 'Could not open system permissions'))
      }}>{zh ? '设置键鼠控制权限' : 'Accessibility permission'}</button> : null}
    </div> : null}
    {value.active ? <div className="flex items-center gap-2"><span>{zh ? '手机正在共享此桌面' : 'A phone is sharing this desktop'}</span>
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => { void api!.desktopStop!().then(refresh).catch(() => setError(zh ? '尚未确认结束，请再次检查。' : 'Desktop cleanup is not confirmed.')) }}>{zh ? '结束远控' : 'End desktop session'}</button></div> : null}
    {error ? <p role="alert" className="text-ds-danger">{error}</p> : null}
  </div>
}
