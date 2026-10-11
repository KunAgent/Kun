import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, QrCode, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import type { RoomMessage } from '@shared/rooms-api'
import type { PersonalAgentImResult } from '@shared/personal-agent-im'
import { roomRequestId, roomsRequest } from './rooms-client'
import './rooms-app-connections.css'

/** QR material is ephemeral component state; only the durable proposal lives in the conversation. */
export function RoomImConnectionCard({ message }: { message: RoomMessage }) {
  const { i18n } = useTranslation('common')
  const zh = i18n.language.startsWith('zh')
  const [result, setResult] = useState<PersonalAgentImResult>({ status: 'requested' })
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(message.appConnection?.status === 'skipped')
  const [lark, setLark] = useState(false)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0)
  const attempt = useRef<string | undefined>(undefined)
  const provider = message.appConnection?.serverId === 'im.feishu' ? 'feishu' : 'weixin'
  const name = provider === 'feishu' ? 'Feishu / Lark' : zh ? '微信' : 'WeChat'
  const request = (action: 'start' | 'poll' | 'cancel' | 'status' | 'disconnect', attemptId?: string) => {
    if (!window.kunGui?.personalAgentIm) return Promise.resolve<PersonalAgentImResult>({ status: 'error',
      message: zh ? '请在 Kun 桌面应用中连接' : 'Connect from the Kun desktop app' })
    return window.kunGui.personalAgentIm({ action, roomId: message.roomId, cardId: message.id,
      ...(attemptId ? { attemptId } : {}), ...(action === 'start' ? { isLark: lark } : {}) })
  }
  useEffect(() => {
    let active = true
    void request('status').then((status) => { if (active) setResult(status) }).catch(() => undefined)
    return () => {
      active = false; generation.current += 1
      if (attempt.current) void request('cancel', attempt.current).catch(() => undefined)
    }
  // Identity changes remount the native connection, without starting registration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.roomId])
  useEffect(() => {
    if (result.status !== 'qr') return
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const qr = result
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = async () => {
      if (!active) return
      if (Date.now() >= qr.expiresAt) {
        await request('cancel', qr.attemptId)
        if (active) setResult({ status: 'error', message: zh ? '二维码已过期，请重新生成' : 'This QR code expired. Generate a new one.' })
        return
      }
      try {
        const next = await request('poll', qr.attemptId)
        if (!active) return
        if (next.status === 'pending') timer = setTimeout(() => void poll(), Math.max(3, qr.interval) * 1000)
        else { attempt.current = undefined; setResult(next) }
      } catch {
        if (active) setResult({ status: 'error', message: zh ? '连接中断，请重试' : 'Connection interrupted. Try again.' })
      }
    }
    timer = setTimeout(() => void poll(), Math.max(3, qr.interval) * 1000)
    return () => { active = false; clearInterval(tick); if (timer) clearTimeout(timer) }
  // Poll one official attempt at a time; QR state contains no saved credentials.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.status === 'qr' ? result.attemptId : '', message.id, zh])
  useEffect(() => {
    if (result.status === 'qr' || skipped || busy) return
    let active = true
    const timer = setInterval(() => { void request('status').then((status) => {
      if (active && (status.status === 'connected' || status.status === 'error' || status.status === 'disconnected')) setResult(status)
    }).catch(() => undefined) }, 5000)
    return () => { active = false; clearInterval(timer) }
  // Refresh connectivity/uncertain delivery, never start authorization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.status === 'qr', skipped, busy, message.id])
  const act = async (action: 'start' | 'cancel' | 'disconnect' | 'skip') => {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    try {
      if (action === 'skip') {
        if (attempt.current) await request('cancel', attempt.current)
        await roomsRequest(`/v1/rooms/${encodeURIComponent(message.roomId)}/app-connections/${encodeURIComponent(message.id)}/skip`,
          'POST', { clientRequestId: roomRequestId() })
        if (current === generation.current) setSkipped(true)
      } else {
        const next = await request(action, attempt.current)
        if (current !== generation.current) return
        attempt.current = next.status === 'qr' ? next.attemptId : undefined
        setResult(next); setNow(Date.now())
      }
    } catch {
      if (current === generation.current) setResult({ status: 'error', message: zh ? '操作未完成，请重试' : 'Could not complete this action. Try again.' })
    } finally { if (current === generation.current) setBusy(false) }
  }
  const connected = result.status === 'connected'
  const disconnected = result.status === 'disconnected'
  const text = (cn: string, en: string) => zh ? cn : en
  return <section className="rooms-app-connection-card rooms-im-connection-card" aria-label={text(`连接${name}`, `Connect ${name}`)}>
    <div className="rooms-app-connection-hero"><span className="rooms-app-connection-icon"><MessageCircle size={25} /></span></div>
    <div className="rooms-app-connection-content">
      <strong>{skipped ? text('已跳过连接', 'Connection skipped') : disconnected ? text('已断开连接', 'Disconnected') : connected
        ? text(`${name} 已连接到这个 Agent`, `${name} is connected to this Agent`) : text(`从${name}和这个 Agent 对话`, `Talk to this Agent from ${name}`)}</strong>
      <p>{message.body}</p>
      <small><ShieldCheck size={13} /> {text('只接受扫码授权账号的私聊，共用这个 Agent 的记忆和对话。', 'Only private messages from the verified scanning account are accepted, using this Agent’s conversation and memory.')}</small>
      <small>{text('桌面应用需要保持打开。任务进展和回复会发回 IM；审批、文件和任务卡片请在 Kun 中查看。', 'Keep Kun open. Progress and replies return to IM; review approvals, files and task cards in Kun.')}</small>
      {provider === 'weixin' ? <small>{text('使用腾讯官方微信渠道，不是企业微信，也不会接管你的个人聊天记录。', 'Uses Tencent’s official WeChat channel. WeCom is separate; this does not access your personal chat history.')}</small> : null}
      {result.status === 'qr' ? <div className="rooms-im-qr">
        <QRCodeSVG value={result.url} size={176} marginSize={3} />
        <span>{text('请在官方手机应用中扫码并确认权限', 'Scan in the official mobile app and review its permissions')}</span>
        <small>{Math.max(0, Math.ceil((result.expiresAt - now) / 1000))}s</small>
      </div> : null}
      {result.status === 'error' ? <p role="alert" className="rooms-app-connection-error">{result.message}</p> : null}
      {!skipped && !connected && !disconnected && result.status !== 'qr' ? <>
        <small>{text('点击继续后才会请求官方授权二维码。密钥保存在本机系统保护存储中，不进入对话。', 'Continue requests an official authorization QR. Credentials stay in OS-protected local storage, outside this conversation.')}</small>
        {provider === 'feishu' ? <label className="rooms-im-brand"><input type="checkbox" checked={lark} disabled={busy} onChange={(event) => setLark(event.target.checked)} /> {text('我使用 Lark 国际版', 'I use Lark')}</label> : null}
      </> : null}
      {!skipped ? <div className="rooms-app-connection-actions">
        {result.status === 'qr' ? <button type="button" disabled={busy} onClick={() => void act('cancel')}>{text('取消', 'Cancel')}</button> :
          connected || (result.status === 'error' && message.appConnection?.status === 'connected') ? <button type="button" disabled={busy || disconnected} onClick={() => void act('disconnect')}>{text('断开连接', 'Disconnect')}</button> : <>
            <button type="button" disabled={busy} onClick={() => void act('skip')}>{text('暂不连接', 'Not now')}</button>
            <button type="button" className="is-primary" disabled={busy} onClick={() => void act('start')}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}{text('继续并扫码连接', 'Continue to official QR')}
            </button>
          </>}
      </div> : null}
    </div>
  </section>
}
