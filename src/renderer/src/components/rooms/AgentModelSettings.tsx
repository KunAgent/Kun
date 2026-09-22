import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, AgentModelOptions, AgentModelBinding, Room } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { agentPath, modelBindingKey, saveAgentModels, useAgentResource } from './agent-client'
import { useChatStore } from '../../store/chat-store'

export type AgentModels = AgentModelOptions & { agent: AgentIdentity }
export const modelLabel = (value?: AgentModelBinding) => value?.model ?? '—'
export function AgentModelSettings({ agentId, room, onClose, onSaved, variant = 'modal' }: { agentId: string; room?: Room; onClose: () => void; onSaved: () => void; variant?: 'modal' | 'panel' }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<AgentModels>(agentPath(agentId) + '/models' + (room ? '?room_id=' + encodeURIComponent(room.id) : ''))
  const body = <>
    {resource.data ? <ModelEditor key={agentId + ':' + resource.data.agent.revision} value={resource.data} onSaved={() => { resource.refresh(); onSaved() }} /> :
      <p className="rooms-run-note">{t('roomsLoading')}</p>}
    {resource.error ? <p role="alert" className="rooms-run-error">{resource.error}</p> : null}
  </>
  return variant === 'panel' ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    : <RoomModal title={t('directModels')} onClose={onClose}>{body}</RoomModal>
}
function ModelEditor({ value, onSaved }: { value: AgentModels; onSaved: () => void }) {
  const { t } = useTranslation('common')
  const [main, setMain] = useState<AgentModelBinding | null>(value.agent.modelRef ?? null)
  const [fast, setFast] = useState<AgentModelBinding | null>(value.agent.fastModelRef ?? null)
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const revision = useRef(value.agent.revision)
  const options = value.options.filter((item) => [item.model, item.providerLabel, item.accountId].join(' ').toLowerCase().includes(search.toLowerCase()))
  const apply = async (nextMain: AgentModelBinding | null, nextFast: AgentModelBinding | null) => {
    if (busy || modelBindingKey(nextMain) === modelBindingKey(main) && modelBindingKey(nextFast) === modelBindingKey(fast)) return
    const previous = { main, fast }
    setMain(nextMain); setFast(nextFast); setBusy(true); setError('')
    try {
      const saved = await saveAgentModels(value.agent.id, {
        expectedRevision: revision.current, modelRef: nextMain, fastModelRef: nextFast
      })
      revision.current = saved.agent.revision
      onSaved()
    } catch (cause) {
      setMain(previous.main); setFast(previous.fast); setError(String(cause))
    } finally { setBusy(false) }
  }
  const choices = (light: boolean) => {
    const selected = light ? fast : main, inherited = light ? value.inheritedFast : value.inheritedMain
    const effective = selected ?? inherited
    const verifiedAt = modelBindingKey(effective) === modelBindingKey(light ? value.fast : value.main) ? light ? value.fastVerifiedAt : value.mainVerifiedAt : undefined
    const provider = value.options.find((item) => modelBindingKey(item) === modelBindingKey(effective))
    const groups = [...new Set(options.map((item) => item.providerId))]
    return <fieldset className="direct-model-field" disabled={busy}>
      <legend>{t(light ? 'directFastModel' : 'directMainModel')}</legend>
      <p>{t(light ? 'directFastHelp' : 'directMainHelp')}</p>
      <select aria-label={t(light ? 'directFastModel' : 'directMainModel')} value={modelBindingKey(selected)} onChange={(event) => {
        const option = value.options.find((item) => modelBindingKey(item) === event.target.value)
        const next = option ? { providerId: option.providerId, accountId: option.accountId, model: option.model } : null
        void apply(light ? main : next, light ? next : fast)
      }}>
        <option value="">{t('directInherit', { model: modelLabel(inherited) })}</option>
        {selected && !options.some((item) => modelBindingKey(item) === modelBindingKey(selected)) ? <option value={modelBindingKey(selected)}>{modelLabel(selected)}</option> : null}
        {groups.map((id) => <optgroup key={id} label={options.find((item) => item.providerId === id)?.providerLabel ?? id}>
          {options.filter((item) => item.providerId === id).map((item) => <option key={modelBindingKey(item)} value={modelBindingKey(item)} disabled={!item.available || light && !item.fastAvailable}>
            {item.model}{item.accountId ? ' · ' + item.accountId : ''}{!item.available ? ' · ' + t('reason' in item && item.reason === 'agent_scope_unsupported' ? 'directScopeUnsupported' : 'directUnavailable') : light && !item.fastAvailable ? ' · ' + t('directNoBackground') : !light && !item.groupAvailable ? ' · ' + t('directPrivateOnly') : ''}
          </option>)}
        </optgroup>)}
      </select>
      <div className="direct-model-effective"><strong>{t('directEffective', { model: modelLabel(effective) })}</strong><small>{provider?.providerLabel ?? effective?.providerId}{effective?.accountId ? ' · ' + effective.accountId : ''} · {t(selected ? 'directSourceAgent' : light && value.fastSource === 'main' ? 'directSourceMain' : 'directSourceDefault')}</small>
        <small>{provider?.available && verifiedAt ? t('directVerified', { date: new Date(verifiedAt).toLocaleString() }) : t(provider?.available ? 'directConfigured' : 'directUnavailable')}</small></div>
      {selected ? <button type="button" onClick={() => void apply(light ? main : null, light ? null : fast)}>{t('directRestoreInherit')}</button> : null}
    </fieldset>
  }
  return <div className="direct-model-settings">
    <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('directSearchModels')} aria-label={t('directSearchModels')} />
    {choices(false)}{choices(true)}
    <button type="button" onClick={() => useChatStore.getState().openSettings('agents')}>{t('directConfigureProviders')}</button>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </div>
}
