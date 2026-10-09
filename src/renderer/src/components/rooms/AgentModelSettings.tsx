import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Settings2 } from 'lucide-react'
import type { AgentIdentity, AgentModelOptions, AgentModelBinding, Room } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { agentPath, modelBindingKey, saveAgentModels, useAgentResource } from './agent-client'
import { useChatStore } from '../../store/chat-store'
import { CodingAgentModelSettings } from './CodingAgentModelSettings'
import { AgentModelSelect } from './AgentModelSelect'
import { agentModelNoteBlocks, agentModelRowNote, findAgentModelOption } from './agent-model-select-logic'

export type AgentModels = AgentModelOptions & { agent: AgentIdentity }
export const modelLabel = (value?: AgentModelBinding) => value?.model ?? '—'
type SavedModelRef = NonNullable<AgentIdentity['modelRef']>
export function AgentModelSettings({ agentId, room, onClose, onSaved, variant = 'modal' }: { agentId: string; room?: Room; onClose: () => void; onSaved: () => void; variant?: 'modal' | 'panel' }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<AgentModels>(agentPath(agentId) + '/models')
  const body = <>
    <p className="rooms-run-note">{t(resource.data?.agent.executor ? 'directCodingAgentModelsHelp' : 'directRoleDefaultsHelp')}</p>
    <p className="rooms-run-note">{t('directModelsSaveImmediately')}</p>
    {room?.privateModelRef ? <p className="rooms-run-note">{t('directConversationOverrideNotice')}</p> : null}
    {resource.data ? resource.data.agent.executor
      ? <CodingAgentModelSettings key={agentId} agent={resource.data.agent} onRefresh={resource.refresh} onSaved={() => { resource.refresh(); onSaved() }} />
      : <ModelEditor key={agentId} value={resource.data} onRefresh={resource.refresh} onSaved={() => { resource.refresh(); onSaved() }} /> :
      <p className="rooms-run-note">{t('roomsLoading')}</p>}
    {resource.error ? <p role="alert" className="rooms-run-error">{resource.error}</p> : null}
  </>
  return variant === 'panel' ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    : <RoomModal title={t('directModels')} onClose={onClose}>{body}</RoomModal>
}
function ModelEditor({ value, onSaved, onRefresh }: { value: AgentModels; onSaved: () => void; onRefresh: () => void }) {
  const { t } = useTranslation('common')
  const [main, setMain] = useState<SavedModelRef | null>(value.agent.modelRef ?? null)
  const [fast, setFast] = useState<SavedModelRef | null>(value.agent.fastModelRef ?? null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const revision = useRef(value.agent.revision), inFlight = useRef(false), mounted = useRef(true)
  const latestAgent = useRef(value.agent); latestAgent.current = value.agent
  const [savingField, setSavingField] = useState<'main' | 'fast' | null>(null)
  const [savedField, setSavedField] = useState<'main' | 'fast' | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    revision.current = latestAgent.current.revision
    setMain(latestAgent.current.modelRef ?? null); setFast(latestAgent.current.fastModelRef ?? null)
  }, [value.agent.revision])
  const apply = async (nextMain: SavedModelRef | null, nextFast: SavedModelRef | null) => {
    if (inFlight.current || modelBindingKey(nextMain) === modelBindingKey(main) && modelBindingKey(nextFast) === modelBindingKey(fast)) return
    inFlight.current = true
    const field = modelBindingKey(nextMain) === modelBindingKey(main) ? 'fast' : 'main'
    setSavingField(field); setSavedField(null)
    const previous = { main, fast }
    setMain(nextMain); setFast(nextFast); setBusy(true); setError('')
    try {
      const saved = await saveAgentModels(value.agent.id, {
        expectedRevision: revision.current, modelRef: nextMain, fastModelRef: nextFast
      })
      if (mounted.current) {
        revision.current = saved.agent.revision; setSavedField(field)
        onSaved()
      }
    } catch (cause) {
      if (mounted.current) { setMain(previous.main); setFast(previous.fast); setError(String(cause)); onRefresh() }
    } finally { inFlight.current = false; if (mounted.current) { setBusy(false); setSavingField(null) } }
  }
  const choices = (light: boolean) => {
    const role = light ? 'fast' : 'main'
    const selected = light ? fast : main, inherited = light ? value.inheritedFast : value.inheritedMain
    const effective = selected ?? inherited
    const verifiedAt = modelBindingKey(effective) === modelBindingKey(light ? value.fast : value.main) ? light ? value.fastVerifiedAt : value.mainVerifiedAt : undefined
    const option = findAgentModelOption(value.options, effective)
    const usable = Boolean(option) && !agentModelNoteBlocks(option ? agentModelRowNote(option, role) : undefined)
    const source = t(selected ? 'directSourceAgent' : light && value.fastSource === 'main' ? 'directSourceMain' : 'directSourceDefault')
    const health = usable && verifiedAt ? t('directVerified', { date: new Date(verifiedAt).toLocaleString() }) : t(usable ? 'directConfigured' : 'directUnavailable')
    const saving = savingField === role, saved = !saving && savedField === role
    const tone = saving ? 'is-busy' : !usable ? 'is-bad' : saved || verifiedAt ? 'is-ok' : ''
    const label = t(light ? 'directFastModel' : 'directMainModel')
    return <fieldset className="direct-model-field is-agent-role" disabled={busy}>
      <legend>{label}</legend>
      {selected ? <button type="button" className="direct-model-restore" onClick={() => void apply(light ? main : null, light ? null : fast)}>
        <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />{t('directRestoreInherit')}
      </button> : null}
      <p>{t(light ? 'directFastHelp' : 'directMainHelp')}</p>
      <AgentModelSelect role={role} label={label} options={value.options} selected={selected} inherited={inherited}
        disabled={busy} busy={saving} onConfigureProviders={() => useChatStore.getState().openSettings('agents')}
        onChange={(next) => void apply(light ? main : next, light ? next : fast)} />
      <div className="direct-model-status">
        <span className={`direct-model-status-dot ${tone}`} aria-hidden="true" />
        {saving ? <span role="status">{t('directModelSaving')}</span> : <>
          {saved ? <><span role="status">{t('directModelSaved')}</span><span aria-hidden="true"> · </span></> : null}
          <span>{saved ? source : `${source} · ${health}`}</span>
        </>}
      </div>
    </fieldset>
  }
  return <div className="direct-model-settings is-agent-roles">
    {choices(false)}{choices(true)}
    <button type="button" className="direct-model-manage" onClick={() => useChatStore.getState().openSettings('agents')}>
      <Settings2 size={13} strokeWidth={1.9} aria-hidden="true" />{t('directConfigureProviders')}
    </button>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
  </div>
}
