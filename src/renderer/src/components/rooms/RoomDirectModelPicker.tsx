import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room } from '@shared/rooms-api'
import type { AgentModels } from './AgentModelSettings'
import { agentPath, modelBindingKey } from './agent-client'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import './room-direct-model-picker.css'

/** A room override affects the next message, never an active or queued request. */
export function RoomDirectModelPicker({ room, onSaved, onBusyChange, agentRevision }: {
  room: Room; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void; agentRevision?: number
}) {
  const { t } = useTranslation('common')
  const [loadFailed, setLoadFailed] = useState(false)
  const [models, setModels] = useState<AgentModels | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const mounted = useRef(true), saving = useRef(false)
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange
  const controller = useRef<AbortController | null>(null)
  const revision = useRef(room.revision)
  const pending = useRef<{ key: string; id: string; revision: number } | null>(null)
  const agentId = room.members[0]?.participantAgentId
  const refresh = useCallback(async () => {
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setLoading(true); setLoadFailed(false)
    try {
      if (!agentId) throw new Error(t('directCreationModelsEmpty'))
      const result = await roomsRequest<AgentModels>(agentPath(agentId) + '/models?room_id=' + encodeURIComponent(room.id), 'GET', undefined, abort.signal)
      if (mounted.current && !abort.signal.aborted) { setModels(result); setError('') }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : String(cause)) }
    } finally { if (mounted.current && !abort.signal.aborted) setLoading(false) }
  }, [agentId, room.id, t])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort(); busyCallback.current(false) }
  }, [])
  useEffect(() => {
    revision.current = room.revision
    if (!saving.current) void refresh()
  }, [room.id, room.revision, agentId, agentRevision, refresh])
  const effective = models?.roomOverride ?? models?.main
  const key = modelBindingKey(effective)
  const options = models?.options ?? []
  const groups = [...new Set(options.map((item) => item.providerId))]
  const change = async (nextKey: string) => {
    const option = options.find((item) => modelBindingKey(item) === nextKey)
    if (saving.current || loading || loadFailed || !option?.available || !option.providerId || nextKey === key) return
    saving.current = true; setBusy(true); onBusyChange(true); setError('')
    if (pending.current?.key !== nextKey || pending.current.revision !== revision.current) {
      pending.current = { key: nextKey, id: roomRequestId(), revision: revision.current }
    }
    try {
      const result = await roomsRequest<{ room: Room }>(roomPath(room.id) + '/direct/model', 'PUT', {
        clientRequestId: pending.current.id, expectedRevision: pending.current.revision,
        modelRef: { providerId: option.providerId, accountId: option.accountId, model: option.model }
      })
      if (mounted.current) {
        revision.current = result.room.revision
        await refresh()
        await onSaved()
      }
    } catch (cause) {
      if (mounted.current) {
        await refresh()
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
        await onSaved()
      }
    } finally {
      saving.current = false
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }
  const label = [options.find((item) => modelBindingKey(item) === key)?.providerLabel ?? effective?.providerId,
    effective?.accountId, effective?.model].filter(Boolean).join(' / ')
  return <div className="direct-composer-model-picker" aria-busy={busy || loading}>
    <select aria-label={t('directConversationModel')} title={label + '\n' + t('directConversationModelHelp')}
      disabled={busy || loading || loadFailed || !models} value={key} onChange={(event) => void change(event.target.value)}>
      {!effective ? <option value="">{t(loading ? 'roomsLoading' : 'directChooseModel')}</option> : null}
      {effective && !options.some((item) => modelBindingKey(item) === key) ? <option value={key} disabled>{label} · {t('directUnavailable')}</option> : null}
      {groups.map((id) => <optgroup key={id ?? ''} label={options.find((item) => item.providerId === id)?.providerLabel ?? id ?? ''}>
        {options.filter((item) => item.providerId === id).map((item) => <option key={modelBindingKey(item)} value={modelBindingKey(item)} disabled={!item.available || !item.providerId}>
          {[item.model, item.providerLabel, item.accountId].filter(Boolean).join(' / ')}{!item.available || !item.providerId ? ' · ' + t('reason' in item && item.reason === 'agent_scope_unsupported' ? 'directScopeUnsupported' : 'directUnavailable') : ''}
        </option>)}
      </optgroup>)}
    </select>
    <small>{t('directConversationModelHelp')}</small>
    {error ? <div role="alert"><span>{error}</span><button type="button" disabled={busy || loading} onClick={() => void refresh()}>{t('directCreationModelsRefresh')}</button></div> : null}
  </div>
}
