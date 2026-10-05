import { useEffect, useRef, useState } from 'react'
import { Search, Users, MessageSquare, PenLine, LoaderCircle, AlertCircle, RotateCcw, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { RoomCreationModelPicker } from './RoomCreationModelPicker'
import './room-new-chat-actions.css'
import { RoomAvatar } from './RoomAvatar'
import { agentMember, useAgentCatalog, useAgentResource } from './agent-client'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'

export function RoomNewChat({ onClose, onOpen, onAgent, onFill = null, autoFocus = true, closeAfterAgent = true, initialGroup = false, selectionMode = 'all' }: {
  onClose: () => void; onOpen: (roomId: string) => void; onAgent: (agentId: string) => void | Promise<void>; onFill?: (() => void) | null; autoFocus?: boolean; closeAfterAgent?: boolean
  initialGroup?: boolean
  selectionMode?: 'all' | 'private' | 'group'
}) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState(''), [groupChoice, setGroupChoice] = useState(initialGroup), [templatesOpen, setTemplatesOpen] = useState(false)
  const [choosingModel, setChoosingModel] = useState(false)
  const group = selectionMode === 'group' || (selectionMode === 'all' && groupChoice)
  const allowPrivate = selectionMode !== 'group'
  const [selected, setSelected] = useState<AgentIdentity[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const catalog = useAgentCatalog(query)
  const templates = useAgentResource<{ templates: AgentIdentity[] }>('/v1/agents/templates', allowPrivate && templatesOpen)
  const creationDismiss = useRef(onClose)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const inFlight = useRef(false), mounted = useRef(true)
  const retry = useRef<(() => void) | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const run = async (key: string, action: (id: string) => Promise<void>, closeAfter = true) => {
    // State alone does not guard two clicks delivered before React renders.
    if (inFlight.current) return
    inFlight.current = true
    if (pending.current?.key !== key) pending.current = { key, id: roomRequestId() }
    retry.current = () => { void run(key, action, closeAfter) }
    setBusy(true); setError('')
    try {
      await action(pending.current.id)
      if (mounted.current && closeAfter) onClose()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const openAgent = (agentId: string): void => {
    void run('open:' + agentId, async () => { await onAgent(agentId) }, closeAfterAgent)
  }
  const create = (templateId: string) => void run('create:' + (templateId ?? ''), async (clientRequestId) => {
    const result = await roomsRequest<{ roomId: string }>('/v1/agents/quick-create', 'POST', {
      clientRequestId, templateId
    })
    if (mounted.current) onOpen(result.roomId)
  })
  if (choosingModel) return <RoomModal title={t('directCreationModelTitle')} busy={busy} onClose={() => creationDismiss.current()}>
    <RoomCreationModelPicker onBack={() => setChoosingModel(false)} onClose={onClose} onOpen={onOpen} onBusyChange={setBusy} onDismissReady={(dismiss) => { creationDismiss.current = dismiss }} />
  </RoomModal>
  return <RoomModal title={t(selectionMode === 'group' ? 'directCreateGroup' : 'directNewChat')} busy={busy} onClose={onClose}>
    <div className="direct-new-chat" aria-busy={busy}>
      {busy ? <p className="direct-new-chat-status" role="status"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />{t('directPreparingChat')}</p> : null}
      <label className="direct-recipient"><span>{t('directTo')}</span><Search size={17} /><input type="search" disabled={busy} autoFocus={autoFocus} aria-label={t('directFindAgent')} value={query} placeholder={t('directFindAgent')} onChange={(e) => setQuery(e.target.value)} /></label>
      {selectionMode === 'group' ? <p className="rooms-run-note">{t('roomsGroupPickerHint')}</p> : <div className="direct-create-actions">
        <button disabled={busy} onClick={() => setChoosingModel(true)}><MessageSquare size={18} />{t('directDefineByChat')}</button>
        {onFill ? <button disabled={busy} onClick={() => { onFill(); onClose() }}><PenLine size={18} />{t('directFillYourself')}</button> : null}
        {selectionMode === 'all' ? <button aria-pressed={group} disabled={busy} onClick={() => setGroupChoice(!groupChoice)}><Users size={18} />{t('directCreateGroup')}</button> : null}
      </div>}
      {selected.length && group ? <div className="direct-selected">{selected.map((agent) => <button key={agent.id} disabled={busy} onClick={() => setSelected(selected.filter((item) => item.id !== agent.id))}>{agent.name} ×</button>)}</div> : null}
      {!catalog.agents.length && !catalog.error ? <p className="direct-new-chat-empty" role="status">{t(catalog.data ? 'agentsEmpty' : 'roomsLoading')}</p> : null}
      <div className="direct-agent-choices">{catalog.agents.map((agent) => <button type="button" key={agent.id} disabled={busy} aria-pressed={group && selected.some((item) => item.id === agent.id)}
        onClick={() => { if (group) setSelected((old) => old.some((item) => item.id === agent.id) ? old.filter((item) => item.id !== agent.id) : [...old, agent]); else openAgent(agent.id) }}>
        <RoomAvatar avatar={agent.avatar} id={agent.id} label={agent.name} size={38} /><span><strong>{agent.name}</strong><small>{agent.title}</small></span>
      </button>)}{catalog.cursor ? <button disabled={busy || catalog.busy} onClick={() => void catalog.more()}>{t('roomsLoadMore')}</button> : null}</div>
      {allowPrivate ? <button className="direct-template-toggle" disabled={busy} aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(!templatesOpen)}>{t('directTemplates')}<ChevronDown size={14} aria-hidden="true" /></button> : null}
      {allowPrivate && templatesOpen ? <div className="direct-template-list">{templates.data?.templates.filter((item) => item.defaultRole !== 'coordinator').map((item) =>
        <button disabled={busy} key={item.templateId} onClick={() => { if (item.templateId) create(item.templateId) }}><RoomAvatar avatar={item.avatar} label={item.name} id={item.templateId} size={30} /><span>{item.name}</span></button>)}</div> : null}
      {group ? <button type="button" className="rooms-run-primary direct-start-group" aria-busy={busy} disabled={busy || selected.length < 2} onClick={() => void run('group:' + selected.map((agent) => agent.id).join(','), async (id) => {
        const result = await roomsClient.create({ name: selected.map((agent) => agent.name).join('、').slice(0, 80), description: '', repositories: [], members: selected.map((agent) => agentMember(agent)), defaultMemberId: selected[0].id, collaborationMode: 'peer' }, id)
        if (mounted.current) onOpen(result.room.id)
      })}>{busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Users size={18} aria-hidden="true" />}<span>{t('directStartGroup', { count: selected.length })}</span></button> : null}
      {error || catalog.error || templates.error ? <div className="direct-new-chat-error" role="alert">
        <AlertCircle size={18} aria-hidden="true" /><div>
          <p>{/room coordinator (lease|ownership)|Conversation service is starting or reconnecting/i.test(error || catalog.error || templates.error)
            ? t('directCoordinatorUnavailable') : error || catalog.error || templates.error}</p>
          <button type="button" disabled={busy} onClick={() => {
            if (error) retry.current?.()
            else { catalog.refresh(); templates.refresh() }
          }}><RotateCcw size={14} aria-hidden="true" />{t('directRetry')}</button>
        </div>
      </div> : null}
    </div>
  </RoomModal>
}
