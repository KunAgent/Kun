import { Archive, ArchiveRestore, Copy, MessageSquare, SlidersHorizontal } from 'lucide-react'
import { AgentModelSettings } from './AgentModelSettings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity, Room, RoomRunRecord } from '@shared/rooms-api'
import { AgentProfileForm } from './AgentProfileForm'
import { AgentMemoryPanel } from './AgentMemoryPanel'
import { RoomAvatar } from './RoomAvatar'
import { agentPath, useAgentResource } from './agent-client'
import { roomRequestId, roomsRequest } from './rooms-client'
import './agents.css'

const TABS = ['profile', 'conversations', 'memory', 'runs'] as const

export function AgentDetails({ agentId, active, onSaved, onOpen, onConversation, onRun, onSource }: {
  agentId?: string; active: boolean; onSaved: (agent: AgentIdentity) => void; onOpen: (id: string) => void;
  onConversation: (roomId: string) => void; onRun: (roomId: string, runId: string) => void;
  onSource: (roomId: string, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<{ agent: AgentIdentity }>(agentId ? agentPath(agentId) : null, active)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [tab, setTab] = useState<'profile' | 'conversations' | 'memory' | 'runs'>('profile')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const agent = resource.data?.agent
  const action = async (kind: 'archive' | 'copy') => {
    if (!agent || busy) return
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<{ agent: AgentIdentity }>(kind === 'copy' ? '/v1/agents' : agentPath(agent.id),
        kind === 'copy' ? 'POST' : 'PATCH', kind === 'copy' ? { clientRequestId: roomRequestId(), copyFromAgentId: agent.id, name: t('agentsCopyName', { name: agent.name }) }
          : { clientRequestId: roomRequestId(), expectedRevision: agent.revision, archived: !agent.archivedAt })
      onSaved(result.agent)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  if (!agentId) return <div className="agent-details"><div className="agent-details-panel"><AgentProfileForm agent={null} active={active} onSaved={onSaved} /></div></div>
  return <div className="agent-details">
    {agent ? <>
      <div className="agent-details-body">
        <aside className="agent-details-summary">
          <div className="agent-details-identity">
            <RoomAvatar avatar={agent.avatar} id={agent.id} label={agent.name} size={64} />
            <div className="agent-details-identity-text">
              <h2 className="agent-details-name">{agent.name}</h2>
              {agent.title ? <p className="agent-details-title">{agent.title}</p> : null}
            </div>
          </div>
          <span className={'agent-details-status' + (agent.archivedAt ? ' is-archived' : '')}>
            {t(agent.archivedAt ? 'agentsArchivedState' : 'agentsIdle')}
          </span>
          <button type="button" className="rooms-run-primary agent-details-chat" onClick={() => onOpen(agent.id)}>
            <MessageSquare size={15} aria-hidden="true" />{t('agentsOpenPrivate')}
          </button>
          <div className="agent-details-actions">
            <button type="button" disabled={busy} onClick={() => void action('archive')}>
              {agent.archivedAt ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
              {t(agent.archivedAt ? 'agentsRestore' : 'agentsArchive')}
            </button>
            <button type="button" disabled={busy} onClick={() => void action('copy')}>
              <Copy size={15} aria-hidden="true" />{t('agentsCopy')}
            </button>
          </div>
          <button type="button" className="agent-details-models" onClick={() => setModelsOpen(true)}>
            <SlidersHorizontal size={15} aria-hidden="true" />{t('directModels')}
          </button>
          {agent.archivedAt ? <p className="rooms-run-note agent-details-archive-note">{t('agentsArchiveHint')}</p> : null}
        </aside>
        <div className="agent-details-content">
          <nav className="agent-detail-tabs" aria-label={t('agentsProfileAndMemory')}>
            {TABS.map((value) => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{t('agentsTab_' + value)}</button>)}
          </nav>
          <div className="agent-details-panel">
            {tab === 'profile' ? <AgentProfileForm agent={agent} active={active} onSaved={onSaved} /> : null}
            {tab === 'memory' ? <AgentMemoryPanel agentId={agent.id} active={active} onSource={onSource} /> : null}
            {tab === 'conversations' ? <AgentConversations agentId={agent.id} active={active} onOpen={onConversation} /> : null}
            {tab === 'runs' ? <AgentRuns agentId={agent.id} active={active} onRun={onRun} /> : null}
          </div>
        </div>
      </div>
      {modelsOpen ? <AgentModelSettings agentId={agent.id} onClose={() => setModelsOpen(false)} onSaved={resource.refresh} /> : null}
    </> : !resource.error ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
    {error || resource.error ? <p role="alert" className="rooms-run-error">{error || resource.error}</p> : null}
  </div>
}
function AgentConversations({ agentId, active, onOpen }: { agentId: string; active: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation('common')
  const [cursor, setCursor] = useState<string | undefined>(), [older, setOlder] = useState<Room[]>([])
  const resource = useAgentResource<{ conversations: Room[]; nextCursor?: string }>(agentPath(agentId) + '/conversations' + (cursor ? '?cursor=' + cursor : ''), active)
  const rooms = [...new Map([...older, ...(resource.data?.conversations ?? [])].map((room) => [room.id, room])).values()]
  return <div className="agent-record-list">{rooms.map((room) => <button type="button" key={room.id} onClick={() => onOpen(room.id)}>
    <strong>{room.name}</strong><small>{t('agentsConversation_' + (room.conversationKind ?? 'group'))}</small>
  </button>)}{resource.data?.nextCursor ? <button type="button" onClick={() => { setOlder(rooms); setCursor(resource.data!.nextCursor) }}>{t('roomsLoadMore')}</button> : null}
    {resource.error ? <p role="alert">{resource.error}</p> : null}</div>
}
function AgentRuns({ agentId, active, onRun }: { agentId: string; active: boolean; onRun: (roomId: string, id: string) => void }) {
  const { t } = useTranslation('common')
  const [cursor, setCursor] = useState<string | undefined>(), [older, setOlder] = useState<RoomRunRecord[]>([])
  const resource = useAgentResource<{ runs: RoomRunRecord[]; nextCursor?: string }>(agentPath(agentId) + '/runs' + (cursor ? '?cursor=' + cursor : ''), active)
  const runs = [...new Map([...older, ...(resource.data?.runs ?? [])].map((run) => [run.id, run])).values()]
  return <div className="agent-record-list">{runs.map((run) => <button type="button" key={run.id} onClick={() => onRun(run.roomId, run.id)}>
    <strong>{t('roomsRunPhase_' + run.phase)} · {t('roomsRunStatus_' + run.status)}</strong><small>{new Date(run.createdAt).toLocaleString()}</small>
  </button>)}{resource.data?.nextCursor ? <button type="button" onClick={() => { setOlder(runs); setCursor(resource.data!.nextCursor) }}>{t('roomsLoadMore')}</button> : null}
    {resource.error ? <p role="alert">{resource.error}</p> : null}</div>
}
