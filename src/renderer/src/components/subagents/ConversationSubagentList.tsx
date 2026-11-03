import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { EXTERNAL_SUBAGENT_SOURCE_LABELS, type ExternalSubagentSource } from '../../agent/external-subagent'
import { useChatStore } from '../../store/chat-store'
import { isSubagentBlock } from '../chat/message-timeline-process-grouping'
import {
  StatusPill,
  isTerminal,
  parseDelegateDetail,
  readChildMeta,
  resolveStatus,
  type CardStatus
} from '../chat/subagent-call-card-support'
import {
  externalAgentIdentity,
  mergeExternalDetail,
  readExternalSubagentView
} from '../chat/subagent-external-card'
import { AgentIcon } from '../agent-icon'
import { formatSubagentElapsed } from './SubagentLiveness'
import { SubagentRoleTile } from './SubagentRoleTile'

type Row = {
  id: string
  childId?: string
  title: string
  meta: string
  status: CardStatus
  profile: string
  durationMs?: number
  tokens?: number
  background: boolean
  source?: ExternalSubagentSource
}

function toRow(block: ChatBlock): Row {
  const external = readExternalSubagentView(block)
  const child = readChildMeta(block)
  const detail = mergeExternalDetail(parseDelegateDetail(block.kind === 'tool' ? (block as ToolBlock).detail : undefined), external)
  const status = external?.status === 'awaiting' ? 'awaiting-permission' : resolveStatus(block, child, detail)
  const profile = child.childProfile || detail.profile || 'agent'
  const model = child.childModel || detail.model
  const identity = external ? externalAgentIdentity(external) : profile
  return {
    id: block.id,
    ...(child.childId || detail.childId ? { childId: child.childId || detail.childId } : {}),
    title: child.childLabel || detail.title || (block.kind === 'tool' ? (block as ToolBlock).summary : '') || profile,
    meta: model ? `${identity} · ${model}` : identity,
    status,
    profile,
    ...(typeof (child.durationMs ?? detail.durationMs) === 'number' ? { durationMs: child.durationMs ?? detail.durationMs } : {}),
    ...(typeof (child.totalTokens ?? detail.totalTokens) === 'number' ? { tokens: child.totalTokens ?? detail.totalTokens } : {}),
    background: child.detached === true || detail.detached === true,
    ...(external ? { source: external.source } : {})
  }
}

/**
 * Every subagent of the open conversation, newest first and running ones on
 * top, so background work is easy to find after it scrolled out of view.
 * Rows open the subagent's own session.
 */
export function ConversationSubagentList(): ReactElement | null {
  const { t } = useTranslation('common')
  const blocks = useChatStore((s) => s.blocks)
  const selectThread = useChatStore((s) => s.selectThread)
  const rows = useMemo(() => blocks.filter(isSubagentBlock).map(toRow).reverse(), [blocks])
  if (!rows.length) return null
  const running = rows.filter((row) => !isTerminal(row.status))
  const finished = rows.filter((row) => isTerminal(row.status))
  const sources = [...new Set(rows.map((row) => row.source).filter(Boolean))] as ExternalSubagentSource[]
  const section = (label: string, list: Row[]): ReactElement | null => list.length ? (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <span className="px-2.5 pb-1 pt-3 text-[11.5px] font-semibold text-ds-muted">{label}</span>
      {list.map((row) => (
        <button
          key={row.id}
          type="button"
          disabled={!row.childId}
          onClick={() => { if (row.childId) void selectThread(row.childId).catch(() => undefined) }}
          className="flex min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition enabled:hover:bg-ds-hover/60 disabled:cursor-default"
          data-testid="conversation-subagent-row"
        >
          <span aria-hidden="true" className="shrink-0">
            <SubagentRoleTile profileId={row.profile} status={row.status} size="sm" neutral={Boolean(row.source)}>
              {row.source ? <AgentIcon harnessId={row.source} size={14} /> : undefined}
            </SubagentRoleTile>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`truncate text-[13px] font-semibold ${row.status === 'stopped' ? 'text-ds-muted' : 'text-ds-ink'}`}>{row.title}</span>
              {row.background ? (
                <span className="shrink-0 rounded-[5px] bg-ds-card-muted px-1.5 text-[10.5px] font-semibold text-ds-muted">
                  {t('subagentDetachedBadge')}
                </span>
              ) : null}
            </span>
            <span className={`truncate text-[12px] ${row.status === 'failed' ? 'text-ds-danger' : row.status === 'running' ? 'text-accent' : 'text-ds-muted'}`}>
              {row.meta}
            </span>
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-ds-muted">
            {row.durationMs !== undefined ? formatSubagentElapsed(row.durationMs) : ''}
          </span>
          <span className="sr-only"><StatusPill status={row.status} t={t} /></span>
        </button>
      ))}
    </section>
  ) : null
  const totalMs = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0)
  const totalTokens = rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
  const stat = (label: string, value: string, tone = ''): ReactElement => (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-[11.5px] text-ds-muted">{label}</div>
      <div className={`text-[17px] font-semibold tabular-nums ${tone || 'text-ds-ink'}`}>{value}</div>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 pt-1" data-testid="conversation-subagent-list">
      <div className="grid grid-cols-3 divide-x divide-ds-border-muted rounded-[12px] border border-ds-border bg-ds-card">
        {stat(t('conversationSubagentsRunningLabel', { defaultValue: 'Running' }), String(running.length), running.length ? 'text-accent' : '')}
        {stat(t('conversationSubagentsTime', { defaultValue: 'Total time' }), formatSubagentElapsed(totalMs))}
        {stat('tokens', totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens))}
      </div>
      {section(t('conversationSubagentsRunning', { count: running.length, defaultValue: 'Running · {{count}}' }), running)}
      {section(t('conversationSubagentsFinished', { count: finished.length, defaultValue: 'Finished · {{count}}' }), finished)}
      {sources.length ? (
        <p className="mt-4 flex gap-2 rounded-[12px] bg-ds-hover/60 px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          {t('conversationSubagentsExternalNote', {
            agent: sources.map((source) => EXTERNAL_SUBAGENT_SOURCE_LABELS[source]).join(' / '),
            defaultValue: 'Subagent types and models come from {{agent}}’s own configuration. The settings below apply only to Kun.'
          })}
        </p>
      ) : null}
    </div>
  )
}

