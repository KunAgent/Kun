import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { Network } from 'lucide-react'
import type { DirectLinkStatus } from '@shared/direct-link'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import { MobileScopeOptions } from './MobileScopeOptions'
import { REMOTE_BUTTON_CLASS, RemoteCopyButton, RemoteGroup, RemoteSwitch } from './remote-panel-ui'
import { RemoteCompactRow } from './remote-compact-ui'

export function DirectMobileLink({ onRunningChange }: { onRunningChange?(running: boolean): void } = {}) {
  const { i18n } = useTranslation(), zh = i18n.language.startsWith('zh')
  const text = (cn: string, en: string) => zh ? cn : en
  const api = window.kunGui?.mobileLink?.direct
  const [state, setState] = useState<DirectLinkStatus>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [open, setOpen] = useState(false), [port, setPort] = useState('0'), [bind, setBind] = useState<'lan' | 'loopback'>('lan')
  const [addresses, setAddresses] = useState(''), [ice, setIce] = useState(''), [pairing, setPairing] = useState<{ link: string; expiresAt: number }>()
  const [scopes, setScopes] = useState<MobileLinkScope[]>(['personal']), [now, setNow] = useState(Date.now())
  const alive = useRef(true), operation = useRef(0)
  const confirmedRunning = state?.running
  useEffect(() => { if (confirmedRunning !== undefined) onRunningChange?.(confirmedRunning) }, [confirmedRunning, onRunningChange])
  const refresh = useCallback(async () => {
    const version = operation.current
    try { const value = await api?.status(); if (alive.current && version === operation.current && value) setState(value) }
    catch { /* Keep the last confirmed state during an IPC failure. */ }
  }, [api])
  useEffect(() => {
    if (!api) return
    alive.current = true; operation.current++; void refresh()
    const timer = setInterval(() => { setNow(Date.now()); void refresh() }, 5000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [api, refresh])
  async function run(action: () => Promise<DirectLinkStatus | void>) {
    if (busy) return
    const version = ++operation.current
    setBusy(true); setError('')
    try { const result = await action(); if (alive.current && version === operation.current && result) setState(result) }
    catch (failure) {
      if (alive.current && version === operation.current) setError(String(failure).includes('LOGIN_REQUIRED')
        ? text('请先登录 Kun 账号。', 'Sign in to Kun first.') : String(failure).includes('DIRECT_ADDRESS_REQUIRED')
          ? text('仅本机监听时，请先填写手机可以访问的 Tailscale 或隧道地址。', 'For loopback listening, first add a Tailscale or tunnel address reachable from the phone.') : String(failure).includes('PORT_IN_USE')
          ? text('端口已被占用，请换一个端口或填 0 自动选择。', 'This port is in use. Choose another port or use 0 for an automatic port.')
          : text('操作未完成，请检查地址、端口或系统安全存储。', 'Could not complete this action. Check addresses, port and secure storage.'))
    } finally { if (alive.current && version === operation.current) setBusy(false) }
  }
  function edit() {
    if (!open && state) { setPort(String(state.port)); setBind(state.bind); setAddresses(state.addresses.join('\n')); setIce('') }
    setOpen(!open)
  }
  const label = text('局域网与自建连接', 'Local network and private connections')
  if (!api) return null
  const field = 'w-full rounded-lg border border-ds-border-muted bg-ds-elevated px-2.5 py-2 text-[12px] text-ds-ink outline-none focus:ring-2 focus:ring-[var(--ds-accent)]'
  return <RemoteGroup>
    <RemoteCompactRow icon={Network} title={label} onOpen={edit} subtitle={text(state?.running ? '已开启 · 数据直接传到电脑' : '支持局域网、Tailscale 和自己的隧道', state?.running ? 'On · data goes directly to this computer' : 'LAN, Tailscale and your own tunnel')}>
      <RemoteSwitch checked={state?.running === true} disabled={!state?.ready || busy} label={label} onToggle={() => void run(async () => {
        setPairing(undefined)
        return api!.configure({ enabled: !state?.running, bind: state?.bind ?? 'lan', port: state?.port ?? 0, addresses: state?.addresses ?? [] })
      })} />
    </RemoteCompactRow>
    {error ? <p role="alert" className="px-3 pb-3 text-[12px] text-ds-danger">{error}</p> : null}
    {state && !state.ready ? <div className="space-y-2 px-3 pb-3 text-[12px] text-ds-muted"><p>{text('请确认已登录 Kun，并允许读取系统安全存储。', 'Sign in to Kun and allow access to system secure storage.')}</p>
      <button className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void run(() => api.retry())}>{text('重新读取配置', 'Retry loading settings')}</button></div> : null}
    {open ? <div className="space-y-3 px-3 pb-3 text-[12px] text-ds-muted">
      <p>{text('手机在设备页选择“连接方式”。直连独立授权、加密传输，会话和附件不经过官方中继。', 'Choose Connection method in the phone device screen. Direct sessions and files use a separately authorized encrypted connection.')}</p>
      <label className="block space-y-1"><span>{text('监听范围', 'Listen on')}</span><select aria-label={text('监听范围', 'Listen on')} className={field} value={bind} disabled={busy} onChange={event => setBind(event.target.value as 'lan' | 'loopback')}>
        <option value="lan">{text('局域网 / VPN 网卡', 'LAN / VPN interfaces')}</option><option value="loopback">{text('仅本机（供本机隧道转发）', 'Loopback only (local tunnel forwarder)')}</option>
      </select></label>
      <label className="block space-y-1"><span>{text('端口（0 为自动选择）', 'Port (0 selects automatically)')}</span><input className={field} inputMode="numeric" value={port} disabled={busy} onChange={event => setPort(event.target.value)} /></label>
      <label className="block space-y-1"><span>{text('Tailscale 或隧道地址，每行一个', 'Tailscale or tunnel addresses, one per line')}</span><textarea className={field} rows={2} value={addresses} disabled={busy} onChange={event => setAddresses(event.target.value)} placeholder="https://computer.example.ts.net" /></label>
      <details><summary className="cursor-pointer">{text('自建 TURN（可选，仅远程桌面视频需要）', 'Own TURN (optional, for desktop video)')}</summary>
        <p className="my-2">{text(state?.hasIceServers ? '已有配置。留空保留，填写 [] 清除。' : '局域网可直接传画面；跨网络可填写自己的 ICE servers JSON。', state?.hasIceServers ? 'Configured. Leave blank to keep, or enter [] to clear.' : 'LAN video can connect directly. For other networks, enter your own ICE servers JSON.')}</p>
        <textarea aria-label="ICE servers JSON" className={field} rows={3} value={ice} onChange={event => setIce(event.target.value)} />
      </details>
      <button className={REMOTE_BUTTON_CLASS} disabled={busy || !state?.ready} onClick={() => void run(async () => {
        setPairing(undefined)
        return api!.configure({ enabled: state?.running === true, bind, port: Number(port), addresses: addresses.split('\n').map(value => value.trim()).filter(Boolean),
          ...(ice.trim() ? { iceServers: JSON.parse(ice) } : {}) })
      })}>{text('保存连接设置', 'Save connection settings')}</button>
      <p>{text('修改端口或监听范围会重建连接，请同步更新手机保存的地址。', 'Changing the port or interface reconnects clients. Update the saved address on your phone.')}</p>
      {state?.running ? <>
        {state.localAddresses.map(address => <div key={address} className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{address}</code><RemoteCopyButton text={address} /></div>)}
        <MobileScopeOptions zh={zh} value={scopes} disabled={busy} onChange={setScopes} persistent excludeScopes={['shares.manage']} />
        <button className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void run(async () => { const value = await api!.pair(scopes); if (alive.current) setPairing(value) })}>{text('生成一次性配对码', 'Create one-time pairing code')}</button>
        {pairing && pairing.expiresAt > now ? <div className="space-y-2 rounded-xl border border-ds-border-muted p-3">
          {pairing.link.length <= 2000 ? <div className="w-fit rounded-lg bg-white p-2"><QRCodeSVG value={pairing.link} size={200} /></div>
            : <p>{text('配对信息较长，请复制后粘贴到手机。', 'Pairing details are too long for a QR code. Copy and paste them into the phone.')}</p>}
          <p>{text('用手机系统相机扫描，或复制后粘贴到 App。配对信息 5 分钟内有效，仅能使用一次。', 'Scan with the phone camera or paste into the app. The pairing link lasts 5 minutes and works once.')}</p>
          <RemoteCopyButton text={pairing.link} />
        </div> : pairing ? <p>{text('配对码已过期，请重新生成。', 'Pairing code expired. Create a new one.')}</p> : null}
        {state.grants.map(grant => <div key={grant.id} className="flex items-center gap-2 border-t border-ds-border-muted pt-2"><span className="min-w-0 flex-1">{grant.name} · {text(grant.online ? '在线' : '已配对', grant.online ? 'Online' : 'Paired')}</span>
          <button className={REMOTE_BUTTON_CLASS} disabled={busy} onClick={() => void run(() => api!.revoke(grant.id))}>{text('撤销', 'Revoke')}</button></div>)}
      </> : null}
    </div> : null}
  </RemoteGroup>
}
