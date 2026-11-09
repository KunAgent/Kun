import { useEffect, useRef, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import type { ComputerAccessStatus } from '@shared/computer-access'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLink } from './useMobileLink'
import type { DesktopAccess } from './useDesktopAccess'
import { RemoteDetailHeader } from './remote-compact-ui'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS, RemoteGroup } from './remote-panel-ui'
import { computerError } from '../../computer-viewer/errors'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'

export function ComputerAccessPanel({ link, desktop, onBack }: { link: MobileLink; desktop: DesktopAccess; onBack(): void }) {
  const api = link.api?.computers, zh = link.zh, owner = link.account.state.user?.id
  const [tab, setTab] = useState<'connect' | 'host'>('connect')
  const [value, setValue] = useState<ComputerAccessStatus>()
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<Record<string, boolean>>({})
  const generation = useRef(0), inFlight = useRef(false)
  useEffect(() => {
    const current = ++generation.current
    setValue(undefined); setError(''); setNotice('')
    if (!api || !link.signedIn) return
    const refresh = async () => {
      if (inFlight.current) return
      try { const next = await (link.computerAllowed ? api.refresh() : api.status()); if (generation.current === current) { setValue(next); setError('') } }
      catch (failure) { if (generation.current === current) setError(computerError(failure, zh)) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => { ++generation.current; clearInterval(timer) }
  }, [api, owner, link.signedIn, link.computerAllowed, zh])
  async function run(action: () => Promise<unknown>, message = '') {
    if (inFlight.current) return
    const current = generation.current
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await action()
      if (api) { const next = await api.status(); if (current === generation.current) setValue(next) }
      await desktop.refresh()
      if (current === generation.current) setNotice(message)
    } catch (failure) { if (current === generation.current) setError(computerError(failure, zh)) }
    finally { inFlight.current = false; if (current === generation.current) setBusy(false) }
  }
  const scopes = (control: boolean): MobileLinkScope[] => control ? ['desktop.view', 'desktop.control'] : ['desktop.view']
  const requests = link.state?.pairings.filter(item => item.purpose === 'desktop') ?? []
  const grants = link.state?.grants.filter(item => item.purpose === 'desktop') ?? []
  const hosting = link.state?.computerAccess === true
  return <>
    <RemoteDetailHeader title={zh ? '电脑远程桌面' : 'Computer remote desktop'} onBack={onBack} />
    <div className="flex flex-wrap gap-2" aria-label={zh ? '电脑远控页面' : 'Computer access pages'}>
      <button type="button" className={tab === 'connect' ? REMOTE_PRIMARY_BUTTON_CLASS : REMOTE_BUTTON_CLASS} onClick={() => setTab('connect')}>{zh ? '连接其他电脑' : 'Connect to a computer'}</button>
      <button type="button" className={tab === 'host' ? REMOTE_PRIMARY_BUTTON_CLASS : REMOTE_BUTTON_CLASS} onClick={() => setTab('host')}>{zh ? '允许访问本机' : 'Allow access here'}</button>
    </div>
    {!link.signedIn ? <p className="text-[12px] text-ds-muted">{zh ? '请先登录 Kun 账号。' : 'Sign in to Kun first.'}</p> : null}
    {link.signedIn && !link.computerAllowed ? <div role="status" className="space-y-2 rounded-xl bg-ds-elevated p-3 text-[12px] text-ds-muted">
      <p>{link.computerMembershipState === 'loading' ? zh ? '正在确认 Max 会员权益…' : 'Checking Max membership…'
        : link.computerMembershipState === 'unavailable' ? zh ? '暂时无法确认会员权益，电脑互控已暂停。' : 'Membership is unavailable. Computer remote access is paused.'
          : zh ? '电脑与电脑远程桌面为 Max 会员专享，需保持 Max 会员有效。' : 'Computer remote desktop requires an active Max membership.'}</p>
      <button type="button" className={REMOTE_BUTTON_CLASS} onClick={link.refreshMembership}>{zh ? '刷新会员状态' : 'Refresh membership'}</button>
    </div> : null}
    {error ? <p role="alert" className="text-[12px] text-ds-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-[12px] text-ds-muted">{notice}</p> : null}
    {value?.active ? <RemoteGroup><div className="space-y-2 p-3 text-[12px]">
      <p className="text-ds-ink">{value.active.name} · {value.active.phase === 'unconfirmed' ? zh ? '等待对端停止确认' : 'Awaiting stop confirmation' : zh ? '远程窗口已打开' : 'Remote window open'}</p>
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void run(() => value.active?.phase === 'unconfirmed' ? api!.confirmClosed() : api!.close())}>
        {value.active.phase === 'unconfirmed' ? zh ? '核对停止' : 'Check cleanup' : zh ? '结束连接' : 'End connection'}
      </button>
    </div></RemoteGroup> : null}
    {tab === 'connect' ? <>
      <p className="text-[12px] text-ds-muted">{zh ? '首版支持同账号 Apple Silicon Mac。连接后先查看，再接管键鼠。' : 'Connect two Apple Silicon Macs on the same account. View first, then take control.'}</p>
      <button type="button" className={`${REMOTE_BUTTON_CLASS} self-start`} disabled={!api || !link.signedIn || !link.computerAllowed || busy} onClick={() => void run(() => api!.refresh())}><RefreshCw size={13} />{zh ? '刷新电脑' : 'Refresh'}</button>
      {value?.devices.map(device => <RemoteGroup key={device.id}><div className="space-y-2 p-3">
        <div className="flex items-center gap-2"><Monitor size={16} /><span className="min-w-0 break-words text-[13px] font-medium text-ds-ink">{device.name}</span></div>
        <p className="text-[12px] text-ds-muted">{device.platform} · {!device.supported ? zh ? '需要更新对端' : 'Host update needed' : !device.enabled ? zh ? '对端未开启' : 'Access off' : device.online !== true ? zh ? '离线或状态未知' : 'Offline or unknown' : device.grantId ? zh ? '在线 · 已配对' : 'Online · Paired' : zh ? '在线 · 待授权' : 'Online · Approval needed'}</p>
        <button type="button" className={device.grantId ? REMOTE_PRIMARY_BUTTON_CLASS : REMOTE_BUTTON_CLASS} disabled={busy || Boolean(value.active) || !device.supported || !device.enabled || device.online !== true || !link.computerAllowed}
          onClick={event => runTrustedUserActivation(event, () => { void run(() => device.grantId ? api!.open(device.id) : api!.pair(device.id), device.grantId ? '' : zh ? '申请已发出，请在对端电脑允许本次桌面访问。' : 'Request sent. Approve desktop access on the other computer.') })}>
          {device.grantId ? zh ? '连接桌面' : 'Open desktop' : zh ? '申请连接' : 'Request access'}
        </button>
      </div></RemoteGroup>)}
      {value && !value.devices.length ? <p className="text-[12px] text-ds-muted">{zh ? '请在另一台 Mac 登录相同账号，并打开「允许访问本机」。' : 'Sign in on another Mac and enable access there.'}</p> : null}
    </> : <>
      <RemoteGroup><div className="space-y-2 p-3"><div className="flex items-center gap-2"><span className="flex-1 text-[13px] text-ds-ink">{zh ? '允许桌面访问' : 'Allow desktop access'}</span>
        <button type="button" className={REMOTE_BUTTON_CLASS} disabled={!api || !link.signedIn || busy || (!hosting && !link.computerAllowed)} onClick={event => runTrustedUserActivation(event, () => { void run(() => api!.enableHost(!hosting)) })}>{hosting ? zh ? '关闭' : 'Turn off' : zh ? '开启' : 'Turn on'}</button>
      </div><p className="text-[12px] text-ds-muted">{zh ? '只授权桌面，不附带聊天、终端或文件权限。授权在本次 Kun 启用周期有效。' : 'Desktop permission does not include chat, terminals or files. Consent lasts for this app session.'}</p></div></RemoteGroup>
      {hosting && desktop.value?.enabled ? <RemoteGroup><fieldset className="space-y-2 p-3 text-[12px]"><legend className="px-1 text-ds-muted">{zh ? '允许分享的显示器' : 'Displays available to share'}</legend>
        {desktop.value.displays.map(item => <label key={item.token} className="flex items-center gap-2"><input type="checkbox" checked={item.allowed}
          disabled={busy || !link.computerAllowed || item.allowed && desktop.value!.displays.filter(display => display.allowed).length === 1}
          onChange={event => {
            const tokens = desktop.value!.displays.filter(display => display.token === item.token ? event.target.checked : display.allowed).map(display => display.token)
            void run(() => link.api!.desktopConfigure!({enabled:true,displayTokens:tokens}))
          }} />{item.label || (zh ? '显示器' : 'Display')} · {item.pixelWidth} × {item.pixelHeight}</label>)}
      </fieldset></RemoteGroup> : null}
      {desktop.value?.supported && !desktop.value.ready ? <button className={REMOTE_BUTTON_CLASS} onClick={() => desktop.permission('screenRecording')}>{zh ? '检查屏幕录制权限' : 'Check screen recording permission'}</button> : null}
      {desktop.value?.supported && !desktop.value.inputReady ? <button className={REMOTE_BUTTON_CLASS} onClick={() => desktop.permission('accessibility')}>{zh ? '检查辅助功能权限' : 'Check accessibility permission'}</button> : null}
      {requests.map(request => <RemoteGroup key={request.id}><div className="space-y-2 p-3 text-[12px]"><p>{request.name} · {zh ? '请求访问本机桌面' : 'Requests desktop access'}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={choices[request.id] ?? false} onChange={event => setChoices(old => ({ ...old, [request.id]: event.target.checked }))} />{zh ? '同时允许接管键鼠' : 'Also allow control'}</label>
        <button className={REMOTE_PRIMARY_BUTTON_CLASS} disabled={busy || !link.computerAllowed} onClick={event => runTrustedUserActivation(event, () => { void run(() => link.api!.confirm(request.id, scopes(choices[request.id] ?? false))) })}>{zh ? '允许本次访问' : 'Allow this session'}</button>
      </div></RemoteGroup>)}
      {grants.map(grant => <RemoteGroup key={grant.id}><div className="space-y-2 p-3 text-[12px]"><p>{grant.name ?? grant.controllerId}</p>
        <select aria-label={zh ? `${grant.name ?? '电脑'}的桌面权限` : 'Desktop permission'} className="max-w-full rounded-md border border-ds-border-muted bg-ds-elevated px-2 py-1.5 text-ds-ink" disabled={busy || !link.computerAllowed}
          value={grant.scopes?.includes('desktop.control') ? 'control' : grant.scopes?.includes('desktop.view') ? 'view' : 'none'}
          onChange={event => { const value = event.target.value; void run(() => link.api!.setScopes(grant.id, value === 'none' ? [] : scopes(value === 'control'))) }}>
          <option value="none">{zh ? '尚未允许' : 'Not allowed'}</option><option value="view">{zh ? '仅查看' : 'View only'}</option><option value="control">{zh ? '查看与控制' : 'View and control'}</option>
        </select>
        <button type="button" className={`${REMOTE_BUTTON_CLASS} ml-2`} disabled={busy} onClick={() => void run(() => link.api!.revoke(grant.id))}>{zh ? '解除授权' : 'Revoke'}</button>
      </div></RemoteGroup>)}
      {desktop.value?.active ? <button type="button" className={REMOTE_BUTTON_CLASS} onClick={desktop.stop}>{zh ? '立即结束当前访问' : 'End current access'}</button> : null}
    </>}
  </>
}
