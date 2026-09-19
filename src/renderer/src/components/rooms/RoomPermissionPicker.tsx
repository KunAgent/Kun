import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomPermissionState } from '@shared/rooms-api'
import { kunToolPermissionModeFromSettings } from '@shared/app-settings'
import { useAgentResource } from './agent-client'
import { roomPath, roomRequestId } from './rooms-client'
import { FloatingComposerExecutionPicker, type ComposerExecutionSettings } from '../chat/FloatingComposerExecutionPicker'

export function RoomPermissionPicker({ roomId }: { roomId: string }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<RoomPermissionState>(roomPath(roomId) + '/direct/permissions')
  const [saved, setSaved] = useState<RoomPermissionState | null>(null)
  const data = saved && (!resource.data || saved.revision > resource.data.revision) ? saved : resource.data
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = async (patch: Partial<ComposerExecutionSettings>) => {
    if (!data || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.kunGui.setRoomPermissions({ roomId, expectedRevision: data.revision,
        clientRequestId: roomRequestId(), mode: kunToolPermissionModeFromSettings({ ...data.policy, ...patch }) })
      if (result.confirmed) setSaved(result.state)
      resource.refresh()
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <div className="room-permission-picker">
    {data ? <FloatingComposerExecutionPicker value={data.policy} applying={busy} onChange={(patch) => void update(patch)}
      disabledModes={data.fullAccessUnavailable ? { 'full-access': t('roomPermissionLimited') } : undefined} /> : <span>{t('roomsLoading')}</span>}
    <span className="room-permission-scope" title={t('roomPermissionNext')}>{t('roomPermissionScope')}</span>
    {error || resource.error ? <span role="alert" className="rooms-run-error">{error || resource.error}</span> : null}
  </div>
}
