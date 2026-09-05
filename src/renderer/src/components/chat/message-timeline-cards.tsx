import type { ReactElement, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight, FileEdit, ListTodo, MessageSquareQuote, SearchCode, TriangleAlert } from 'lucide-react'
import type { ReviewBlock, ToolBlock } from '../../agent/types'
import { countDiffStats, sumDiffStats } from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import type {
  WritePromptDisplay,
  WritePromptDisplayQuote,
  WritePromptDisplayRetrieval
} from '../../write/quoted-selection'
import { DiffView } from '../DiffView'
import { formatDuration } from './message-timeline-tools'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import type { GuiPlanToolMeta } from '../../plan/plan-tool'
import { PlanBuildActions } from '../plan/PlanBuildActions'
import { WritePromptOfficeDocumentCard } from './WritePromptOfficeDocumentCard'

/**
 * Inline "Review Plan" card rendered under a turn whose `create_plan`
 * call succeeded. Mirrors the Plan panel actions (open / build) so the
 * user can act on the plan without leaving the conversation.
 */
export function ReviewPlanCard({
  title,
  planId,
  relativePath,
  busy,
  graphEnabled,
  planMeta,
  onOpen,
  onBuild
}: {
  title: string
  planId?: string
  relativePath: string
  busy: boolean
  graphEnabled: boolean
  planMeta?: GuiPlanToolMeta
  onOpen?: () => void
  onBuild?: (orchestration: PlanBuildOrchestration) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      data-review-plan-card
      title={relativePath}
      className="flex w-full flex-col gap-5 rounded-[26px] border border-ds-border-muted/80 bg-ds-card/95 px-6 py-5 shadow-[0_16px_40px_rgba(20,47,95,0.055)] dark:border-white/[0.08] dark:bg-ds-card/90"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft/80 text-accent">
          <ListTodo className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-accent">
            <span>{t('reviewPlanCardStatus')}</span>
          </div>
          <div className="mt-0.5 break-words text-[15px] font-medium text-ds-ink">{title}</div>
          <div className="mt-0.5 text-[12px] text-ds-muted">{t('reviewPlanCardHint')}</div>
        </div>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ds-card-muted/70 px-3.5 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <FileEdit className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('reviewPlanOpen')}
          </button>
        ) : null}
      </div>
      {onBuild ? (
        <PlanBuildActions
          disabled={busy}
          graphEnabled={graphEnabled}
          variant="card"
          planId={planId}
          planMeta={planMeta}
          onBuild={onBuild}
        />
      ) : null}
    </div>
  )
}

export function ReviewSummaryCard({ review }: { review: ReviewBlock }): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(review.status !== 'success')
  const findings = review.output?.findings ?? []
  const incorrect = review.output?.overallCorrectness === 'patch is incorrect'
  const running = review.status === 'running'
  const failed = review.status === 'error'
  const icon = running ? (
    <SearchCode className="h-5 w-5" strokeWidth={1.9} />
  ) : failed || incorrect ? (
    <TriangleAlert className="h-5 w-5" strokeWidth={1.9} />
  ) : (
    <CheckCircle2 className="h-5 w-5" strokeWidth={1.9} />
  )
  const statusText = running
    ? t('reviewCardRunning')
    : failed
      ? t('reviewCardFailed')
      : findings.length === 0
        ? t('reviewCardNoFindings')
        : t('reviewCardFindings', { count: findings.length })

  return (
    <section className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/80 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${
          failed || incorrect
            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
            : running
              ? 'bg-accent/10 text-accent'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        }`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ds-ink">
            {review.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ds-muted">
            {statusText}
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-ds-border-muted/70 px-5 py-4">
          {review.output?.overallExplanation?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.output.overallExplanation}
            </p>
          ) : review.reviewText?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
              {review.reviewText}
            </p>
          ) : (
            <p className="text-[14px] leading-6 text-ds-muted">{statusText}</p>
          )}

          {findings.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {findings.map((finding, index) => (
                <article
                  key={`${finding.title}-${index}`}
                  className="rounded-[12px] border border-ds-border-muted bg-ds-card-muted/45 px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-md bg-ds-card px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                      P{finding.priority}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[14px] font-semibold text-ds-ink">
                        {finding.title.replace(/^\[P[0-3]\]\s*/i, '')}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11.5px] text-ds-faint">
                        {finding.codeLocation.absoluteFilePath}:{finding.codeLocation.lineRange.start}
                        -{finding.codeLocation.lineRange.end}
                      </div>
                    </div>
                  </div>
                  {finding.body.trim() ? (
                    <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">
                      {finding.body}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function TurnChangeSummary({
  changes,
  viewportRef,
  compact = false,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false
}: {
  changes: ToolBlock[]
  viewportRef: RefObject<HTMLDivElement | null>
  compact?: boolean
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [showAllFiles, setShowAllFiles] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (changes.length === 0) {
      setActiveId(null)
      setShowAllFiles(false)
      return
    }
    setActiveId((current) => {
      if (current && changes.some((change) => change.id === current)) return current
      return null
    })
    if (changes.length <= 3) setShowAllFiles(false)
  }, [changes])

  const totals = useMemo(() => sumDiffStats(changes.map((change) => change.detail)), [changes])
  const title = useMemo(
    () =>
      changes.length === 1
        ? t('turnChangeFilesOne')
        : t('turnChangeFilesMany', { count: changes.length }),
    [changes.length, t]
  )
  const visibleChanges = showAllFiles ? changes : changes.slice(0, 3)
  const hiddenFileCount = Math.max(0, changes.length - 3)
  const { ref: deferredBodyRef, shouldRender: shouldRenderBody } = useDeferredRender<HTMLDivElement>({
    enabled: activeId !== null,
    root: viewportRef
  })

  return (
    <section
      data-turn-change-summary
      className={`ds-card-strong overflow-hidden border border-ds-border shadow-[0_16px_40px_rgba(86,103,136,0.08)] ${
        compact ? 'rounded-[20px]' : 'rounded-[24px]'
      }`}
    >
      <div
        className={`flex min-w-0 flex-col border-b border-ds-border-muted/70 sm:flex-row sm:items-center ${
          compact ? 'gap-3 px-4 py-3' : 'gap-4 px-5 py-4'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={`flex shrink-0 items-center justify-center bg-ds-card-muted text-ds-muted ${
              compact ? 'h-10 w-10 rounded-[14px]' : 'h-11 w-11 rounded-[15px]'
            }`}
          >
            <FileEdit className={compact ? 'h-4.5 w-4.5' : 'h-5 w-5'} strokeWidth={1.85} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate font-semibold tracking-[-0.02em] text-ds-ink ${
                compact ? 'text-[15px]' : 'text-[17px]'
              }`}
            >
              {title}
            </span>
            {totals ? (
              <span className={`block font-mono ${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-[12px]'}`}>
                <span className="text-ds-diff-added">+{totals.added}</span>
                <span className="mx-1.5 text-ds-faint">·</span>
                <span className="text-ds-diff-removed">-{totals.removed}</span>
              </span>
            ) : null}
          </span>
        </div>
        {onOpenChanges || onReviewChanges ? (
          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
            {onOpenChanges ? (
              <button
                type="button"
                onClick={onOpenChanges}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('composerOpenChanges')}
              </button>
            ) : null}
            {onReviewChanges ? (
              <button
                type="button"
                disabled={reviewChangesDisabled}
                onClick={onReviewChanges}
                className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
              >
                <SearchCode className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('composerReviewChanges')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-ds-border-muted/60">
        {visibleChanges.map((change) => {
          const stats = countDiffStats(change.detail)
          const open = activeId === change.id
          const primary = change.filePath ?? t('toolActionFile')

          return (
            <div key={change.id} data-turn-change-file>
              <button
                type="button"
                onClick={() => setActiveId(open ? null : change.id)}
                aria-expanded={open}
                className={`flex w-full items-center text-left transition ${
                  open ? 'bg-ds-hover/45' : 'hover:bg-ds-hover/35'
                } ${compact ? 'gap-2.5 px-4 py-2.5' : 'gap-3 px-5 py-3'}`}
              >
                <span
                  className={`min-w-0 flex-1 truncate font-medium text-ds-muted ${
                    compact ? 'text-[12px]' : 'text-[13px]'
                  }`}
                  title={primary}
                >
                  {primary}
                </span>
                {stats ? (
                  <span className={`shrink-0 font-mono tabular-nums ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
                    <span className="text-ds-diff-added">+{stats.added}</span>
                    <span className="ml-1.5 text-ds-diff-removed">-{stats.removed}</span>
                  </span>
                ) : null}
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                )}
              </button>

              {open && change.detail ? (
                <div
                  ref={deferredBodyRef}
                  className={`bg-ds-card-muted/45 ${compact ? 'px-3 pb-2.5 pt-1' : 'px-4 pb-3 pt-1'}`}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? 'auto 148px' : 'auto 260px' }}
                >
                  {shouldRenderBody ? (
                    <DiffView
                      patch={change.detail}
                      filePath={change.filePath}
                      maxHeight={compact ? 148 : 260}
                      className="border border-ds-border-muted/70"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {hiddenFileCount > 0 ? (
        <div
          className={`border-t border-ds-border-muted/70 ${compact ? 'px-4 py-2' : 'px-5 py-2.5'}`}
        >
          <button
            type="button"
            onClick={() => {
              if (showAllFiles && activeId && !changes.slice(0, 3).some((change) => change.id === activeId)) {
                setActiveId(null)
              }
              setShowAllFiles(!showAllFiles)
            }}
            aria-expanded={showAllFiles}
            className="inline-flex items-center gap-1.5 rounded-lg py-1 text-[12.5px] font-semibold text-ds-muted transition hover:text-ds-ink"
          >
            {showAllFiles
              ? t('turnChangeShowFewer')
              : t('turnChangeShowMore', { count: hiddenFileCount })}
            {showAllFiles ? (
              <ChevronDown className="h-3.5 w-3.5 rotate-180" strokeWidth={1.8} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** Turn-level work metadata disclosure. Details stay collapsed until the user opens them. */
export function WorkMetaRow({
  processing,
  durationMs,
  expanded,
  onToggle,
  collapsible = true
}: {
  processing: boolean
  durationMs?: number
  expanded: boolean
  onToggle: () => void
  collapsible?: boolean
}): ReactElement {
  const { t } = useTranslation('common')

  const mainLabel = processing
    ? `${t('processing')}${typeof durationMs === 'number' ? ` · ${formatDuration(durationMs)}` : ''}`
    : `${t('processed')}${typeof durationMs === 'number' ? ` ${formatDuration(durationMs)}` : ''}`

  const content = (
    <>
      <span className="tabular-nums">{mainLabel}</span>
      {collapsible ? (
        expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
        ) : (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
            strokeWidth={1.8}
          />
        )
      ) : null}
    </>
  )

  if (!collapsible) {
    return (
      <div data-work-meta-row="true" className="flex w-full max-w-full items-center gap-1.5 border-b border-ds-border-muted/70 py-2 text-left text-[15px] font-medium text-ds-muted">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-work-meta-row="true"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-full max-w-full items-center gap-1.5 border-b border-ds-border-muted/70 py-2 text-left text-[15px] font-medium text-ds-muted transition hover:opacity-85"
    >
      {content}
    </button>
  )
}

/**
 * Tiny mono "via <model>" tag rendered above the user message body. Subtle by
 * design — no pill, no ring, just faint monospaced text right-aligned at the
 * top of the bubble. Hidden when there's no model selection to surface.
 */
export function ModelMetaTag({
  label,
  className = ''
}: {
  label?: string
  className?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!label) return null
  return (
    <div
      className={`flex min-w-0 text-right ${className}`.trim()}
      title={t('turnModelBadgeTitle', { model: label })}
    >
      <span className="truncate font-mono text-[12px] tracking-tight text-ds-faint/85">
        {label}
      </span>
    </div>
  )
}

function writePromptMetaSummary(
  display: WritePromptDisplay,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parts: string[] = []
  if (display.quotes.length > 0) {
    parts.push(t('writePromptReferencesCount', { count: display.quotes.length }))
  }
  if (display.retrieval && display.retrieval.snippets.length > 0) {
    parts.push(t('writePromptRetrievalCount', { count: display.retrieval.snippets.length }))
  }
  if (display.officeDocument) {
    parts.push(t('writePromptOfficeContext'))
  }
  if (display.context) {
    parts.push(t('writePromptContextShort'))
  }
  return parts.join(' · ')
}

export function WritePromptMetaDisclosure({
  display,
  expanded,
  onToggle
}: {
  display: WritePromptDisplay
  expanded: boolean
  onToggle: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = writePromptMetaSummary(display, t)
  if (!summary) return null

  return (
    <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-lg py-0.5 text-left text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-55" strokeWidth={1.85} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-45 transition group-hover:opacity-70" strokeWidth={1.85} />
        )}
      </button>

      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {display.context ? (
            <div className="rounded-xl border border-black/5 bg-white/55 px-3 py-2 text-[12px] font-normal leading-5 text-ds-muted shadow-sm dark:border-white/10 dark:bg-white/6">
              <div className="font-medium text-ds-ink">{t('writePromptContextLabel')}</div>
              {display.context.activeFile ? (
                <div className="mt-1 truncate">
                  <span className="text-ds-faint">{t('writePromptActiveFile')} </span>
                  <span className="font-mono text-ds-muted">{display.context.activeFile}</span>
                </div>
              ) : null}
              {display.context.workspaceRoot ? (
                <div className="mt-0.5 truncate" title={display.context.workspaceRoot}>
                  <span className="text-ds-faint">{t('writePromptWorkspace')} </span>
                  <span className="font-mono text-ds-muted">{display.context.workspaceRoot}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {display.quotes.map((quote, index) => (
            <WritePromptQuoteCard key={`${quote.sourceTitle}-${index}`} quote={quote} />
          ))}

          {display.officeDocument ? (
            <WritePromptOfficeDocumentCard document={display.officeDocument} />
          ) : null}

          {display.retrieval && display.retrieval.snippets.length > 0 ? (
            <WritePromptRetrievalCard retrieval={display.retrieval} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function WritePromptQuoteCard({ quote }: { quote: WritePromptDisplayQuote }): ReactElement {
  const { t } = useTranslation('common')
  const lineLabel =
    quote.lineStart != null && quote.lineEnd != null
      ? t('writePromptReferenceLines', { start: quote.lineStart, end: quote.lineEnd })
      : null
  const pageLabel =
    quote.pageStart != null && quote.pageEnd != null
      ? quote.pageStart === quote.pageEnd
        ? t('writePromptReferencePage', { page: quote.pageStart })
        : t('writePromptReferencePages', { start: quote.pageStart, end: quote.pageEnd })
      : null
  const slideLabel = quote.slide != null ? `Slide ${quote.slide}` : null
  const cellLabel = quote.sheetName && quote.cellRange
    ? `${quote.sheetName}!${quote.cellRange}`
    : null
  const rangeLabel = lineLabel ?? pageLabel ?? slideLabel ?? cellLabel

  return (
    <figure className="rounded-xl border border-accent/15 bg-accent/[0.055] px-3 py-2.5 text-left shadow-sm">
      <figcaption className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
          {quote.sourceTitle || t('writePromptReference')}
        </span>
        {rangeLabel ? (
          <span className="shrink-0 rounded-full bg-white/65 px-2 py-0.5 font-mono text-[11px] text-ds-faint dark:bg-white/8">
            {rangeLabel}
          </span>
        ) : null}
      </figcaption>
      <blockquote className="mt-2 max-h-36 overflow-auto border-l-2 border-accent/35 pl-3 text-[12.5px] font-normal leading-6 text-ds-muted">
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {quote.text}
        </div>
      </blockquote>
      {quote.sourceFilePath ? (
        <div className="mt-2 truncate font-mono text-[11px] font-normal text-ds-faint" title={quote.sourceFilePath}>
          {quote.sourceFilePath}
        </div>
      ) : null}
    </figure>
  )
}

/**
 * Collapsed view of the auto-attached retrieval context ([相关文献上下文]).
 * Snippets used to be dumped verbatim into the user bubble; here they render
 * as compact numbered cards with location, optional title and matched terms.
 */
function WritePromptRetrievalCard({
  retrieval
}: {
  retrieval: WritePromptDisplayRetrieval
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-xl border border-black/5 bg-white/55 px-3 py-2.5 text-left shadow-sm dark:border-white/10 dark:bg-white/6">
      <div className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
        <SearchCode className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
          {t('writePromptRetrievalLabel')}
        </span>
        {retrieval.keywords ? (
          <span
            className="min-w-0 shrink truncate rounded-full bg-white/65 px-2 py-0.5 font-mono text-[11px] text-ds-faint dark:bg-white/8"
            title={retrieval.keywords}
          >
            {retrieval.keywords}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {retrieval.snippets.map((snippet, index) => (
          <div
            key={`${snippet.location}-${index}`}
            className="rounded-lg border border-black/5 bg-white/45 px-2.5 py-2 dark:border-white/8 dark:bg-white/4"
          >
            <div className="flex min-w-0 items-center gap-2 text-[11.5px] leading-4">
              <span className="shrink-0 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-accent">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-ds-muted" title={snippet.location}>
                {snippet.location}
              </span>
            </div>
            {snippet.title ? (
              <div className="mt-1.5 truncate text-[12px] font-medium text-ds-ink">{snippet.title}</div>
            ) : null}
            <div className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[12px] font-normal leading-5 text-ds-muted [overflow-wrap:anywhere]">
              {snippet.text}
            </div>
            {snippet.keywords ? (
              <div className="mt-1.5 truncate text-[11px] text-ds-faint" title={snippet.keywords}>
                {t('writePromptRetrievalMatched', { keywords: snippet.keywords })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
