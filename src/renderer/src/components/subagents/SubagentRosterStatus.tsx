import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRosterLaneName, AgentRosterLaneStatusView } from '@shared/agent-roster'
import { useAgentRoster } from '../../store/agent-roster-store'

const LANES: ReadonlyArray<{ lane: AgentRosterLaneName; key: string }> = [
  { lane: 'delegate', key: 'adeSettings.rosterLaneDelegate' },
  { lane: 'worker', key: 'adeSettings.rosterLaneWorker' },
  { lane: 'graph', key: 'adeSettings.rosterLaneGraph' },
  { lane: 'conversation', key: 'adeSettings.rosterLaneConversation' }
]

const TONE: Record<AgentRosterLaneStatusView['state'], string> = {
  ok: 'bg-emerald-500',
  unchecked: 'bg-ds-faint',
  blocked: 'bg-red-500'
}

/**
 * Where a saved role can run right now, straight from the agent roster: its
 * engine and one status per dispatch lane, with the blocking reason on hover.
 */
export function SubagentRosterStatus({ profileId }: { profileId: string }): ReactElement | null {
  const { t } = useTranslation('settings')
  const roster = useAgentRoster()
  const entry = roster.entries.find((candidate) => candidate.id === profileId)
  if (!entry) return null
  const engine = entry.engine.kind === 'bound'
    ? t('adeSettings.rosterEngineBound', {
        engine: entry.engine.model ? `${entry.engine.displayName} · ${entry.engine.model}` : entry.engine.displayName
      })
    : t('adeSettings.rosterEngineInherit')
  return (
    <div className="rounded-lg border border-ds-border bg-ds-card px-3 py-2" data-roster-status={profileId}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-xs font-medium text-ds-muted">{t('adeSettings.rosterStatusTitle')}</span>
        <span className="min-w-0 truncate text-[11.5px] text-ds-ink" title={engine}>{engine}</span>
      </div>
      <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-3 gap-y-1">
        {LANES.map(({ lane, key }) => {
          const status = entry.lanes[lane]
          const label = status.state === 'ok'
            ? t('adeSettings.rosterLaneOk')
            : status.state === 'unchecked'
              ? t('adeSettings.rosterLaneUnchecked')
              : t('adeSettings.rosterLaneBlocked', { reason: status.message })
          return (
            <li key={lane} className="flex min-w-0 items-center gap-1.5 text-[11.5px]" data-roster-lane={lane}
              data-roster-lane-state={status.state} title={label}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[status.state]}`} aria-hidden />
              <span className="shrink-0 text-ds-ink">{t(key)}</span>
              <span className="min-w-0 truncate text-ds-faint">{label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
