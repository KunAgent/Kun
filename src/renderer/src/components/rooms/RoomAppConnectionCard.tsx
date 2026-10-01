import { RoomImConnectionCard } from './RoomImConnectionCard'
import { useState } from 'react'
import { Check, Loader2, PlugZap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ROOM_APP_CATALOG, isHiddenRoomGoogleApp, type RoomMessage } from '@shared/rooms-api'
import { addRoomApp, authorizeRoomApp, listRoomApps } from './room-apps-client'
import { roomRequestId, roomsRequest } from './rooms-client'
import './rooms-app-connections.css'

export function RoomAppConnectionCard({ message }: { message: RoomMessage }) {
  return message.appConnection?.serverId === 'im.feishu' || message.appConnection?.serverId === 'im.weixin'
    ? <RoomImConnectionCard message={message} /> : <RoomMcpConnectionCard message={message} />
}

function RoomMcpConnectionCard({ message }: { message: RoomMessage }) {
  const { t } = useTranslation('common')
  const [updated, setUpdated] = useState<RoomMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = updated?.bodyRevision && updated.bodyRevision > message.bodyRevision ? updated : message
  const connection = shown.appConnection
  if (!connection) return null
  const { serverId, status, resumed } = connection
  const unavailable = isHiddenRoomGoogleApp(serverId)
  const builtIn = ROOM_APP_CATALOG[serverId as keyof typeof ROOM_APP_CATALOG]
  const name = builtIn?.name ?? serverId
  const act = async (action: 'complete' | 'skip') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (action === 'complete' && status === 'requested') {
        if (unavailable) throw new Error(t('roomsAppNotConfigured'))
        const inventory = await listRoomApps()
        const configured = inventory.servers.find((server) => server.id === serverId)
        if (!configured) {
          if (!builtIn) throw new Error(t('roomsAppNotConfigured'))
          await addRoomApp(serverId, builtIn.url)
        } else if (!configured.enabled) throw new Error(t('roomsAppDisabled'))
        else if (!configured.oauth && inventory.statuses[serverId] !== 'connected') throw new Error(t('roomsAppOAuthNotConfigured'))
        if (inventory.statuses[serverId] !== 'connected' && inventory.oauth[serverId] !== 'authorized') {
          await authorizeRoomApp(serverId)
        }
      }
      const result = await roomsRequest<{ message: RoomMessage }>(
        `/v1/rooms/${encodeURIComponent(message.roomId)}/app-connections/${encodeURIComponent(message.id)}/${action}`,
        'POST', { clientRequestId: roomRequestId() })
      setUpdated(result.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const done = status !== 'requested'
  return <section className="rooms-app-connection-card" aria-label={t('roomsAppConnectTitle', { name })}>
    <div className="rooms-app-connection-hero"><span className="rooms-app-connection-icon"><PlugZap size={25} /></span></div>
    <div className="rooms-app-connection-content">
      <strong>{done ? t(status === 'connected' ? 'roomsAppConnected' : 'roomsAppSkipped', { name }) : t('roomsAppConnectTitle', { name })}</strong>
      <p>{shown.body}</p>
      {done ? <small>{resumed ? t('roomsAppResuming') : t('roomsAppReadyToResume')}</small> :
        <small>{t('roomsAppSecureSignIn')}</small>}
      {error ? <p role="alert" className="rooms-app-connection-error">{error}</p> : null}
      {!done ? <div className="rooms-app-connection-actions">
        <button type="button" disabled={busy} onClick={() => void act('skip')}>{t('roomsAppSkip')}</button>
        {!unavailable ? <button type="button" className="is-primary" disabled={busy} onClick={() => void act('complete')}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}{t('roomsAppContinue')}
        </button> : null}
      </div> : !resumed ? <button type="button" className="rooms-app-connection-resume" disabled={busy}
        onClick={() => void act(status === 'connected' ? 'complete' : 'skip')}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : null}{t('roomsAppResumeTask')}
      </button> : <span className="rooms-app-connection-done"><Check size={14} />{t('roomsAppResuming')}</span>}
    </div>
  </section>
}
