import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'
import { useAgentCatalog } from './agent-client'

export function AgentPicker({ label, excluded = [], onSelect }: {
  label: string; excluded?: string[]; onSelect: (agent: AgentIdentity) => void
}) {
  return <RoomPopover label={label} trigger={<span>{label}</span>} width={300}>
    {(close) => <AgentPickerList excluded={excluded} onSelect={(agent) => { onSelect(agent); close() }} />}
  </RoomPopover>
}
function AgentPickerList({ excluded, onSelect }: { excluded: string[]; onSelect: (agent: AgentIdentity) => void }) {
  const { t } = useTranslation('common')
  const [query, setQuery] = useState('')
  const state = useAgentCatalog(query)
  return <div className="agent-picker-list"><input autoFocus aria-label={t('agentsSearch')} placeholder={t('agentsSearch')}
    value={query} onChange={(event) => setQuery(event.target.value)} />
    {state.agents.filter((agent) => !excluded.includes(agent.id)).map((agent) => <button type="button" key={agent.id} onClick={() => onSelect(agent)}>
      <strong>{agent.name}</strong><small>{agent.title}</small>
    </button>)}
    {state.cursor ? <button type="button" disabled={state.busy} onClick={() => void state.more().catch(() => {})}>{t('roomsLoadMore')}</button> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
  </div>
}
