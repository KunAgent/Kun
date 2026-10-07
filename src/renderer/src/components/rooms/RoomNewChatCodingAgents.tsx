import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { codingRouteKey, useCodingAgentCatalog, type CodingAgentEntry, type CodingAgentRoute } from './coding-agent-client'
import './room-new-chat-coding.css'

/** Codex, Claude Code and OpenCode as chat contacts; each row pins one engine route. */
export function RoomNewChatCodingAgents({ busy, group, selected, onChoose }: {
  busy: boolean
  group: boolean
  selected: AgentIdentity[]
  onChoose: (entry: CodingAgentEntry, route: CodingAgentRoute) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const catalog = useCodingAgentCatalog(true)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const agents = catalog.data?.agents ?? []
  return <section className="direct-coding-agents" aria-labelledby="direct-coding-agents-title">
    <header>
      <h3 id="direct-coding-agents-title">{t('directCodingAgents')}</h3>
      <p>{t(group ? 'directCodingAgentsGroupHint' : 'directCodingAgentsHint')}</p>
    </header>
    {!catalog.data && !catalog.error ? <p className="direct-new-chat-empty" role="status">{t('directCodingAgentsLoading')}</p> : null}
    {catalog.data && !agents.length ? <p className="direct-new-chat-empty" role="status">{t('directCodingAgentsEmpty')}</p> : null}
    {agents.map((entry) => {
      const key = choices[entry.harnessId] ?? (entry.models[0] ? codingRouteKey(entry.models[0]) : '')
      const route = entry.models.find((item) => codingRouteKey(item) === key) ?? entry.models[0]
      const chosen = selected.some((agent) => agent.executor?.harnessId === entry.harnessId)
      const ready = entry.available && Boolean(route)
      return <div key={entry.harnessId} className="direct-coding-agent" data-ready={ready || undefined}>
        <button type="button" disabled={busy || !ready} aria-pressed={group ? chosen : undefined}
          onClick={() => { if (route) onChoose(entry, route) }}>
          <RoomAvatar avatar={{ kind: 'harness', harnessId: entry.harnessId }} id={entry.harnessId} label={entry.displayName} size={38} />
          <span><strong>{entry.displayName}</strong>
            <small>{ready ? route!.model : entry.reason ?? t('directCodingAgentUnavailable')}</small></span>
        </button>
        {ready && entry.models.length > 1 ? <select aria-label={t('directCodingAgentModel', { name: entry.displayName })}
          disabled={busy} value={key} onChange={(event) => setChoices({ ...choices, [entry.harnessId]: event.target.value })}>
          {entry.models.map((item) => <option key={codingRouteKey(item)} value={codingRouteKey(item)}>
            {item.credentialMode === 'kun-gateway' ? t('directCodingAgentGatewayModel', { model: item.model }) : item.model}
          </option>)}
        </select> : null}
      </div>
    })}
    {catalog.error ? <p className="direct-coding-agents-error" role="alert">{catalog.error}</p> : null}
  </section>
}
