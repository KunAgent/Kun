import { useRef, useState } from 'react'
import { Search, Plus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { RoomAvatar } from './RoomAvatar'
import { agentMember, useAgentCatalog, useAgentResource } from './agent-client'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'

export function RoomNewChat({ onClose, onOpen, onAgent }: { onClose: () => void; onOpen: (roomId: string) => void; onAgent: (agentId: string) => void }) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState(''), [group, setGroup] = useState(false), [templatesOpen, setTemplatesOpen] = useState(false)
  const [selected, setSelected] = useState<AgentIdentity[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const catalog = useAgentCatalog(query)
  const templates = useAgentResource<{ templates: AgentIdentity[] }>('/v1/agents/templates', templatesOpen)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const run = async (key: string, action: (id: string) => Promise<void>) => {
    if (busy) return
    if (pending.current?.key !== key) pending.current = { key, id: roomRequestId() }
    setBusy(true); setError('')
    try { await action(pending.current.id); onClose() } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const create = (templateId?: string) => void run('create:' + (templateId ?? ''), async (clientRequestId) => {
    const result = await roomsRequest<{ roomId: string }>('/v1/agents/quick-create', 'POST', { clientRequestId, templateId, ...(!templateId ? { name: t('directNewAgentName') } : {}) })
    onOpen(result.roomId)
  })
  return <RoomModal title={t('directNewChat')} busy={busy} onClose={onClose}>
    <div className="direct-new-chat">
      <label className="direct-recipient"><span>{t('directTo')}</span><Search size={17} /><input autoFocus value={query} placeholder={t('directFindAgent')} onChange={(e) => setQuery(e.target.value)} /></label>
      <div className="direct-create-actions"><button disabled={busy} onClick={() => create()}><Plus size={18} />{t('directCreateAgent')}</button>
        <button aria-pressed={group} disabled={busy} onClick={() => setGroup(!group)}><Users size={18} />{t('directCreateGroup')}</button></div>
      {selected.length && group ? <div className="direct-selected">{selected.map((agent) => <button key={agent.id} onClick={() => setSelected(selected.filter((item) => item.id !== agent.id))}>{agent.name} ×</button>)}</div> : null}
      <div className="direct-agent-choices">{catalog.agents.map((agent) => <button type="button" key={agent.id} disabled={busy} aria-pressed={group && selected.some((item) => item.id === agent.id)}
        onClick={() => { if (group) setSelected((old) => old.some((item) => item.id === agent.id) ? old.filter((item) => item.id !== agent.id) : [...old, agent]); else { onAgent(agent.id); onClose() } }}>
        <RoomAvatar avatar={agent.avatar} id={agent.id} label={agent.name} size={38} /><span><strong>{agent.name}</strong><small>{agent.title}</small></span>
      </button>)}{catalog.cursor ? <button disabled={catalog.busy} onClick={() => void catalog.more()}>{t('roomsLoadMore')}</button> : null}</div>
      <button className="direct-template-toggle" aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(!templatesOpen)}>{t('directTemplates')}</button>
      {templatesOpen ? <div className="direct-template-list">{templates.data?.templates.filter((item) => item.defaultRole !== 'coordinator').map((item) =>
        <button disabled={busy} key={item.templateId} onClick={() => create(item.templateId)}><RoomAvatar avatar={item.avatar} label={item.name} id={item.templateId} size={30} /><span>{item.name}</span></button>)}</div> : null}
      {group ? <button className="rooms-run-primary" disabled={busy || selected.length < 2} onClick={() => void run('group:' + selected.map((agent) => agent.id).join(','), async (id) => {
        const result = await roomsClient.create({ name: selected.map((agent) => agent.name).join('、').slice(0, 80), description: '', repositories: [], members: selected.map((agent) => agentMember(agent)), defaultMemberId: selected[0].id, collaborationMode: 'peer' }, id)
        onOpen(result.room.id)
      })}>{t('directStartGroup', { count: selected.length })}</button> : null}
      {error || catalog.error || templates.error ? <p role="alert" className="rooms-run-error">{error || catalog.error || templates.error}</p> : null}
    </div>
  </RoomModal>
}
