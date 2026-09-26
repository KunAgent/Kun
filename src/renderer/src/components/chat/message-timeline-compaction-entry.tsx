import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'

export function CompactionTimelineEntry({
  block,
  processing
}: {
  block: Extract<ChatBlock, { kind: 'compaction' }>
  processing: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const isRunning = block.status === 'running'
  const isError = block.status === 'error'
  // A context-window checkpoint is a committed boundary, not a compaction:
  // it renders the fixed marker label and never a generated summary.
  const isWindow = block.variant === 'window'
  // `auto === false` means the user explicitly ran `/compact`; absent/true is
  // loop-triggered (automatic) compaction per the runtime contract.
  const isAuto = block.auto !== false
  const summary = block.summary?.trim() ?? ''
  const detail = block.detail?.trim() ?? ''
  const hasDetails = Boolean(summary || detail)
  // Live animation/expansion only while the turn is actually processing.
  const live = processing && isRunning
  // While a compaction runs it stays open so the live summary is visible;
  // once settled the record collapses back into the timeline by default.
  const forceOpen = live && hasDetails
  const open = hasDetails && (forceOpen || (userOpen ?? false))
  const canToggle = hasDetails && !forceOpen

  const Icon = isRunning ? LoaderCircle : isError ? CircleAlert : CheckCircle2
  const title = isWindow
    ? t('contextWindowSwitched')
    : isRunning
      ? t('compactionRunning')
      : isError
        ? t('compactionFailed')
        : isAuto
          ? t('compactionAutoCompleted')
          : t('compactionManualCompleted')
  const meta = compactionMetaText(block, t)
  const iconTone = isRunning
    ? 'text-accent'
    : isError
      ? 'text-ds-danger'
      : 'text-ds-success'

  const handleToggle = (): void => {
    if (!canToggle) return
    setUserOpen((value) => !(value ?? false))
  }
  const handleToggleButton = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    handleToggle()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!canToggle) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleToggle()
  }

  return (
    <div
      role={canToggle ? 'button' : undefined}
      tabIndex={canToggle ? 0 : undefined}
      aria-expanded={canToggle ? open : undefined}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      data-compaction-timeline-entry="true"
      className={`group w-full border-y border-ds-border-muted px-2 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
        canToggle ? 'cursor-pointer hover:bg-ds-hover/45' : 'cursor-default'
      }`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card/70 ${iconTone}`}
        >
          <Icon
            className={`h-3.5 w-3.5 ${live ? 'animate-spin' : ''}`}
            strokeWidth={1.9}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              role={live ? 'status' : undefined}
              aria-live={live ? 'polite' : undefined}
              className={`min-w-0 text-[13.5px] font-semibold leading-6 ${
                isError ? 'text-ds-danger' : 'text-ds-ink'
              }`}
            >
              {title}
            </span>
            {isWindow ? null : (
              <span className="inline-flex items-center rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint">
                {isAuto ? t('compactionTriggerAuto') : t('compactionTriggerManual')}
              </span>
            )}
          </span>
          {meta ? (
            <span className="mt-0.5 block truncate text-[12px] leading-5 text-ds-faint">
              {meta}
            </span>
          ) : null}
        </span>
        {canToggle ? (
          <button
            type="button"
            aria-label={open ? t('processCollapseDetail') : t('processExpandDetail')}
            aria-expanded={open}
            onClick={handleToggleButton}
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition hover:bg-ds-hover/70"
          >
            {open ? (
              <ChevronDown className="h-3 w-3 opacity-45" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3 w-3 opacity-45" strokeWidth={2} />
            )}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="ds-work-timeline-detail ml-9 mt-1.5">
          {summary ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ds-faint">
                {t('compactionSummaryLabel')}
              </span>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-ds-muted">{summary}</p>
            </div>
          ) : null}
          {detail ? (
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ds-faint">{detail}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function compactionMetaText(
  block: Extract<ChatBlock, { kind: 'compaction' }>,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | null {
  if (block.status !== 'success') return null
  if (
    typeof block.messagesBefore === 'number' &&
    typeof block.messagesAfter === 'number'
  ) {
    return t('compactionMessagesReduced', {
      before: block.messagesBefore,
      after: block.messagesAfter
    })
  }
  // `messagesBefore` carries the folded (released) token estimate. Only render
  // a concrete number when the runtime reported one.
  const releasedTokens = typeof block.messagesBefore === 'number' ? block.messagesBefore : 0
  if (releasedTokens > 0) {
    return t('compactionReleasedTokens', { tokens: releasedTokens.toLocaleString() })
  }
  return null
}
