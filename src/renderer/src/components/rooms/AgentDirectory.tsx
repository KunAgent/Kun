import { AgentFeatureControls } from './AgentFeatureControls'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { RoomAvatar } from './RoomAvatar'
import { AgentDirectoryModelSummary } from './AgentDirectoryModelSummary'
import './agent-model-management.css'
import { agentMember, useAgentCatalog } from './agent-client'
import './agents.css'

export function AgentDirectory({ selectedAgentId, onOpen, onDetails, onCreate }: {
  selectedAgentId?: string; onOpen: (id: string) => void; onDetails: (id: string) => void; onCreate: () => void
}) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false)
  const state = useAgentCatalog(query, archived)
  return <section className="agent-directory" aria-label={t('agentsDirectory')}>
    <div className="rooms-sidebar-heading"><h2>{t('agentsDirectory')}</h2>
      <button type="button" className="rooms-icon-button" aria-label={t('agentsCreate')} onClick={onCreate}><Plus size={18} /></button><AgentFeatureControls />
    </div>
    <p className="agent-directory-model-help">{t('directRoleDefaultsHelp')}</p>
    <div className="rooms-list-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)}
      aria-label={t('agentsSearch')} placeholder={t('agentsSearch')} /></div>
    <label className="agent-directory-archive"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />{t('agentsArchived')}</label>
    <div className="agent-directory-list">
      {state.agents.map((agent) => {
        const activity = state.activities[agent.id]
        return <div key={agent.id} className={'agent-directory-row' + (agent.id === selectedAgentId ? ' is-selected' : '')}>
          <button type="button" className="agent-directory-open" aria-label={agent.name} onClick={() => onOpen(agent.id)}>
            <RoomAvatar member={agentMember(agent)} label={agent.name} size={38} />
            <span className="agent-directory-label"><strong>{agent.name}</strong><small>{agent.title || t('rooms' + agent.defaultRole[0].toUpperCase() + agent.defaultRole.slice(1))}</small>
              {agent.migratedFrom ? <small>{agent.migratedFrom.roomName}</small> : null}
              <small>{agent.archivedAt ? t('agentsArchivedState') : activity?.runs.length ? t('agentsWorking') : t('agentsIdle')}</small>
            </span>
            {activity?.unread ? <i className="agent-unread-dot" aria-label={t('roomsFilter_unread')} /> : null}
          </button>
          <AgentDirectoryModelSummary agentId={agent.id} />
          <button type="button" className="agent-directory-configure" aria-label={t('directConfigureAgentNamed', { name: agent.name })} onClick={() => onDetails(agent.id)}>
            <SlidersHorizontal size={15} aria-hidden="true" />{t('directConfigureAgent')}
          </button>
        </div>
      })}
      {state.cursor ? <button type="button" className="rooms-run-secondary" disabled={state.busy} onClick={() => void state.more().catch(() => {})}>{t('roomsLoadMore')}</button> : null}
      {!state.data && !state.error ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
      {state.data && !state.agents.length ? <p className="rooms-run-note">{t('agentsEmpty')}</p> : null}
      {state.error ? <div role="alert" className="rooms-run-error">{state.error}<button type="button" onClick={state.refresh}>{t('directCreationModelsRefresh')}</button></div> : null}
    </div>
  </section>
}
