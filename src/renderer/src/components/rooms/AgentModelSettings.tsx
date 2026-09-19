import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, AgentModelOptions, AgentModelBinding, Room } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { agentPath, useAgentResource } from './agent-client'
import { roomRequestId, roomsRequest } from './rooms-client'
import { useChatStore } from '../../store/chat-store'

export type AgentModels = AgentModelOptions & { agent: AgentIdentity }
export const modelLabel = (value?: AgentModelBinding) => value?.model ?? '—'
const bindingKey = (value?: AgentModelBinding | null) => value ? JSON.stringify([value.providerId, value.accountId, value.model]) : ''
export function AgentModelSettings({ agentId, room, onClose, onSaved }: { agentId: string; room?: Room; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<AgentModels>(agentPath(agentId) + '/models' + (room ? '?room_id=' + encodeURIComponent(room.id) : ''))
  return <RoomModal title={t('directModels')} onClose={onClose}>
    {resource.data ? <ModelEditor key={agentId + ':' + resource.data.agent.revision} value={resource.data} onSaved={() => { resource.refresh(); onSaved() }} /> :
      <p className="rooms-run-note">{t('roomsLoading')}</p>}
    {resource.error ? <p role="alert" className="rooms-run-error">{resource.error}</p> : null}
  </RoomModal>
}
function ModelEditor({ value, onSaved }: { value: AgentModels; onSaved: () => void }) {
  const { t } = useTranslation('common')
  const [main, setMain] = useState<AgentModelBinding | null>(value.agent.modelRef ?? null)
  const [fast, setFast] = useState<AgentModelBinding | null>(value.agent.fastModelRef ?? null)
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const options = value.options.filter((item) => [item.model, item.providerLabel, item.accountId].join(' ').toLowerCase().includes(search.toLowerCase()))
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await roomsRequest(agentPath(value.agent.id) + '/models', 'PUT', { clientRequestId: roomRequestId(), expectedRevision: value.agent.revision,
      modelRef: main, fastModelRef: fast }); onSaved() } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const choices = (light: boolean) => {
    const selected = light ? fast : main, inherited = light ? value.inheritedFast : value.inheritedMain
    const choose = light ? setFast : setMain
    const effective = selected ?? inherited
    const verifiedAt = bindingKey(effective) === bindingKey(light ? value.fast : value.main) ? light ? value.fastVerifiedAt : value.mainVerifiedAt : undefined
    const provider = value.options.find((item) => bindingKey(item) === bindingKey(effective))
    const groups = [...new Set(options.map((item) => item.providerId))]
    return <fieldset className="direct-model-field" disabled={busy}>
      <legend>{t(light ? 'directFastModel' : 'directMainModel')}</legend>
      <p>{t(light ? 'directFastHelp' : 'directMainHelp')}</p>
      <select aria-label={t(light ? 'directFastModel' : 'directMainModel')} value={bindingKey(selected)} onChange={(event) => {
        const option = value.options.find((item) => bindingKey(item) === event.target.value)
        choose(option ? { providerId: option.providerId, accountId: option.accountId, model: option.model } : null)
      }}>
        <option value="">{t('directInherit', { model: modelLabel(inherited) })}</option>
        {selected && !options.some((item) => bindingKey(item) === bindingKey(selected)) ? <option value={bindingKey(selected)}>{modelLabel(selected)}</option> : null}
        {groups.map((id) => <optgroup key={id} label={options.find((item) => item.providerId === id)?.providerLabel ?? id}>
          {options.filter((item) => item.providerId === id).map((item) => <option key={bindingKey(item)} value={bindingKey(item)} disabled={!item.available || light && !item.fastAvailable}>
            {item.model}{item.accountId ? ' · ' + item.accountId : ''}{!item.available ? ' · ' + t('reason' in item && item.reason === 'agent_scope_unsupported' ? 'directScopeUnsupported' : 'directUnavailable') : light && !item.fastAvailable ? ' · ' + t('directNoBackground') : !light && !item.groupAvailable ? ' · ' + t('directPrivateOnly') : ''}
          </option>)}
        </optgroup>)}
      </select>
      <div className="direct-model-effective"><strong>{t('directEffective', { model: modelLabel(effective) })}</strong><small>{provider?.providerLabel ?? effective?.providerId}{effective?.accountId ? ' · ' + effective.accountId : ''} · {t(selected ? 'directSourceAgent' : light && value.fastSource === 'main' ? 'directSourceMain' : 'directSourceDefault')}</small>
        <small>{provider?.available && verifiedAt ? t('directVerified', { date: new Date(verifiedAt).toLocaleString() }) : t(provider?.available ? 'directConfigured' : 'directUnavailable')}</small></div>
      {selected ? <button type="button" onClick={() => choose(null)}>{t('directRestoreInherit')}</button> : null}
    </fieldset>
  }
  return <div className="direct-model-settings">
    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('directSearchModels')} aria-label={t('directSearchModels')} />
    {choices(false)}{choices(true)}
    <button type="button" onClick={() => useChatStore.getState().openSettings('agents')}>{t('directConfigureProviders')}</button>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    <button className="rooms-run-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button>
  </div>
}
