import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ClipboardList } from 'lucide-react'
import { parseAssignmentCard } from '@shared/assignment-card'
import type { ChatBlock } from '../../agent/types'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'

/**
 * First-turn task assignment card for ADE worker threads (12 §6.3): folds
 * the `<kun_assignment>` wrapper into a collapsed card — title row shows
 * the task line, expanding reveals the full brief (context, workspace,
 * collaboration). Unparseable text falls back to a plain bubble upstream.
 */
export function AssignmentCard({
  block,
  nested = false
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const parsed = useMemo(() => parseAssignmentCard(block.text), [block.text])

  if (!parsed) {
    return (
      <div className={nested ? 'min-w-0' : 'flex w-full justify-start'}>
        <pre className="whitespace-pre-wrap break-words rounded-2xl border border-ds-border bg-ds-card px-4 py-3 text-[13px] leading-6 text-ds-ink">
          {block.text}
        </pre>
      </div>
    )
  }

  return (
    <div className={nested ? 'min-w-0' : 'flex w-full justify-start'}>
      <div
        data-assignment-card="true"
        className="w-full max-w-[min(760px,calc(100vw-3rem))] overflow-hidden rounded-[16px] border border-ds-border bg-ds-card shadow-[0_8px_24px_rgba(42,52,72,0.06)]"
      >
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex w-full min-w-0 items-center gap-3 px-4 py-3 pl-[18px] text-left transition hover:bg-ds-hover/40"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-accent/15 bg-accent/[0.07] text-accent">
            <ClipboardList className="h-[17px] w-[17px]" strokeWidth={1.9} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold leading-5 text-ds-ink">
              {parsed.title || t('assignmentCardTitle')}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-ds-faint">
              {t('assignmentCardFrom', { from: parsed.from || t('assignmentCardManager') })}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ds-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
            strokeWidth={2}
            aria-hidden
          />
        </button>
        {expanded ? (
          <div className="ds-markdown border-t border-ds-border/80 px-4 py-3 pl-[18px] text-[13.5px] leading-[1.68] text-ds-ink">
            <AssistantMarkdown text={parsed.body} streaming={false} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
