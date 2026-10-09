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

type Row = {
  id: string
  childId?: string
  title: string
  meta: string
  status: CardStatus
  letter: string
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
    letter: profile.charAt(0).toUpperCase(),
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
    <section aria-label={label} className="flex flex-col gap-1.5">
      <span className="px-1 text-[12px] font-medium text-ds-faint">{label}</span>
      <div className="flex flex-col overflow-hidden rounded-[14px] border border-ds-border bg-ds-card">
        {list.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={!row.childId}
            onClick={() => { if (row.childId) void selectThread(row.childId).catch(() => undefined) }}
            className="flex min-w-0 items-center gap-2.5 border-t border-ds-border-muted px-3 py-2.5 text-left transition first:border-t-0 enabled:hover:bg-ds-hover/40 disabled:cursor-default"
            data-testid="conversation-subagent-row"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-ds-border-muted bg-ds-card text-[12px] font-bold text-ds-ink"
            >
              {row.source ? <AgentIcon harnessId={row.source} size={16} /> : row.letter}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-ds-ink">{row.title}</span>
                {row.background ? (
                  <span className="shrink-0 rounded-full bg-ds-card-muted px-1.5 text-[10.5px] font-semibold text-ds-muted">
                    {t('subagentDetachedBadge')}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[11.5px] text-ds-muted">{row.meta}</span>
            </span>
            <StatusPill status={row.status} t={t} />
          </button>
        ))}
      </div>
    </section>
  ) : null
  return (
    <div className="flex max-h-[45%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-ds-border px-3 py-3" data-testid="conversation-subagent-list">
      <div className="flex items-center gap-2 px-1">
        <strong className="text-[14px] font-semibold text-ds-ink">
          {t('conversationSubagentsTitle', { defaultValue: 'Subagents in this chat' })}
        </strong>
        <span className="rounded-full bg-accent/10 px-1.5 text-[11px] font-semibold text-accent">{rows.length}</span>
      </div>
      {section(t('conversationSubagentsRunning', { count: running.length, defaultValue: 'Running · {{count}}' }), running)}
      {section(t('conversationSubagentsFinished', { count: finished.length, defaultValue: 'Finished · {{count}}' }), finished)}
      {sources.length ? (
        <p className="flex gap-2 rounded-[12px] bg-ds-hover/60 px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
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

