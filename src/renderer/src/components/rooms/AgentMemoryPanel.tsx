import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentPath, useAgentResource } from './agent-client'
import { AgentMemoryCandidates } from './AgentMemoryCandidates'
import { AgentMemoryEntry, type AgentMemoryListEntry } from './AgentMemoryEntry'

type Page = { memories: AgentMemoryListEntry[]; nextCursor?: string; available: boolean }
type Tab = 'overview' | 'pending' | 'history'
export function AgentMemoryPanel({ agentId, active, onSource }: {
  agentId: string; active: boolean; onSource: (roomId: string, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const [tab, setTab] = useState<Tab>('overview')
  const [cursor, setCursor] = useState<string | undefined>()
  const state = useAgentResource<Page>(agentPath(agentId) + '/memories?include_deleted=' + (tab === 'history') +
    (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), active && tab !== 'pending')
  const [older, setOlder] = useState<AgentMemoryListEntry[]>([])
  useEffect(() => { setOlder([]); setCursor(undefined) }, [agentId, tab])
  const current = state.data?.memories ?? []
  const entries = [...new Map([...older, ...current].map((entry) => [entry.memory.id, entry])).values()]
    .filter((entry) => entry.memory.agentContext?.agentId === agentId && (tab === 'history' || !entry.memory.deletedAt))
  const refresh = () => { setOlder([]); setCursor(undefined); state.refresh() }
  return <section className="agent-memory-panel" aria-label={t('agentsMemory')}>
    <p className="rooms-run-note">{t('agentsMemoryBoundary')}</p>
    <nav className="memory-section-tabs" aria-label={t('agentsMemory')}>
      {(['overview', 'pending', 'history'] as const).map((value) => <button type="button" key={value}
        aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{t('memoryTab_' + value)}</button>)}
    </nav>
    {tab === 'pending' ? <AgentMemoryCandidates key={agentId} agentId={agentId} active={active} onUpdated={refresh} /> : <>
      {tab === 'overview' ? <p className="rooms-run-note">{t('memoryOverviewHint')}</p> : null}
      {state.data && !state.data.available ? <p className="rooms-run-note">{t('agentsMemoryDisabled')}</p> : null}
      {entries.map((entry) => <AgentMemoryEntry key={agentId + ':' + entry.memory.id + ':' + entry.fingerprint} agentId={agentId}
        entry={entry} onSource={onSource} onUpdated={refresh} historyOnly={tab === 'history'} />)}
      {state.data?.nextCursor ? <button type="button" className="rooms-run-secondary" onClick={() => {
        setOlder(entries); setCursor(state.data!.nextCursor)
      }}>{t('roomsLoadMore')}</button> : null}
      {state.data && !entries.length ? <p className="rooms-run-note">{t('agentsMemoryEmpty')}</p> : null}
      {!state.data && !state.error ? <p role="status">{t('roomsLoading')}</p> : null}
      {state.error ? <p role="alert" className="rooms-run-error">{state.error}</p> : null}
    </>}
  </section>
}
