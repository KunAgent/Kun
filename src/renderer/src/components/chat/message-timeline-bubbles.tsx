import { memo, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, FileEdit, GitFork, Loader2, RotateCcw, Terminal, Wrench } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { useChatStore } from '../../store/chat-store'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { isBackgroundShellNoticeBlock, isBackgroundSubagentNoticeBlock } from './message-timeline-turns'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { readNumber, formatDuration, summarizeBackgroundShellToolBlock } from './message-timeline-tools'
import { formatTtftSeconds, formatTps } from '../../hooks/use-thread-usage'
import {
  BackgroundShellNoticeBubble,
  BackgroundSubagentNoticeBubble,
  UserMessageBubble
} from './message-timeline-user-bubbles'
import {
  AssistantExportButton,
  CopyFeedbackButton,
  RuntimeMetaChips,
  UserInputBubble,
  formatMessageDateTime
} from './message-timeline-bubble-support'
import { ToolAttachmentPreviews } from './message-timeline-media-views'
import { LiveAssistantStreamingProvider } from './live-assistant-streaming'
import { metaString } from './message-timeline-bubble-meta'

export { GeneratedFilesPanel } from './message-timeline-media-views'
export { generatedMediaScrollAvailability } from './message-timeline-media-logic'

export const MessageBubble = memo(MessageBubbleImpl)

export function shouldAnimateAssistantStream({
  isLiveAssistant,
  busyUnconfirmed,
  catchingUpThread
}: {
  isLiveAssistant: boolean
  busyUnconfirmed: boolean
  catchingUpThread: boolean
}): boolean {
  return isLiveAssistant && !busyUnconfirmed && !catchingUpThread
}

type TurnMetricsLike = {
  avgTtftMs: number | null
  avgTokensPerSecond: number | null
}
/**
 * Renders a turn's average TTFT/TPS as a compact footer label. Segments with
 * no data are omitted so legacy turns show nothing at all.
 */
export function turnMetricsLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  metrics: TurnMetricsLike
): string {
  const parts: string[] = []
  const ttft = formatTtftSeconds(metrics.avgTtftMs)
  if (ttft != null) parts.push(t('turnMetricsTtft', { value: ttft }))
  const tps = formatTps(metrics.avgTokensPerSecond)
  if (tps != null) parts.push(t('turnMetricsTps', { value: tps }))
  return parts.join(' · ')
}

function MessageBubbleImpl({
  block,
  nested = false,
  forkAction,
  rollbackAction,
  allowThreadActions = true
}: {
  block: ChatBlock
  nested?: boolean
  forkAction?: {
    busy: boolean
    onFork: () => void
  }
  rollbackAction?: {
    busy: boolean
    onRollback: () => void
  }
  allowThreadActions?: boolean
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  const turnTimingMetrics = useChatStore((s) => s.turnTimingMetrics)
  const busyUnconfirmed = useChatStore((s) => s.busyUnconfirmed)
  const catchingUpThread = useChatStore((s) =>
    Boolean(s.activeThreadId && s.threadLoadingId === s.activeThreadId)
  )
  if (block.kind === 'user' && isBackgroundShellNoticeBlock(block)) {
    return <BackgroundShellNoticeBubble block={block} nested={nested} />
  }
  if (block.kind === 'user' && isBackgroundSubagentNoticeBlock(block)) {
    return <BackgroundSubagentNoticeBubble block={block} nested={nested} />
  }
  if (block.kind === 'user') {
    return <UserMessageBubble block={block} allowThreadActions={allowThreadActions} />
  }
  if (block.kind === 'assistant') {
    const streaming = block.id === 'live-assistant'
    // Replayed events are folded into the hidden timeline at full speed.
    // Typewriter pacing resumes only after the selected thread has caught up.
    const effectiveStreaming = shouldAnimateAssistantStream({
      isLiveAssistant: streaming,
      busyUnconfirmed,
      catchingUpThread
    })
    const createdAtLabel = block.createdAt
      ? formatMessageDateTime(block.createdAt, i18n.language)
      : null
    const turnMetrics =
      !streaming && block.turnId
        ? turnTimingMetrics.get(block.turnId)
        : undefined
    return (
      <LiveAssistantStreamingProvider streaming={effectiveStreaming}>
        <div className="group/message flex min-w-0 max-w-full flex-col">
          <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-ds-ink">
            <AssistantMarkdown text={block.text} streaming={effectiveStreaming} />
          </div>
        {!streaming ? (
          <div className="mt-1 flex min-h-5 min-w-0 items-center justify-between gap-3 text-[11.5px] text-ds-faint opacity-0 transition duration-150 group-hover/message:opacity-100">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{createdAtLabel ?? ''}</span>
              {turnMetrics ? (
                <span
                  className="shrink-0 whitespace-nowrap tabular-nums"
                  title={t('turnMetricsTitle')}
                >
                  {turnMetricsLabel(t, turnMetrics)}
                </span>
              ) : null}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {rollbackAction ? (
                <button
                  type="button"
                  onClick={() => rollbackAction.onRollback()}
                  disabled={rollbackAction.busy}
                  className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:opacity-60"
                  title={t('rollbackWorkspaceFromAssistantResponse')}
                  aria-label={t('rollbackWorkspaceFromAssistantResponse')}
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>{rollbackAction.busy ? t('rollingBackWorkspace') : t('rollbackWorkspace')}</span>
                </button>
              ) : null}
              {forkAction ? (
                <button
                  type="button"
                  onClick={() => forkAction.onFork()}
                  disabled={forkAction.busy}
                  className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:opacity-60"
                  title={t('forkFromAssistantResponse')}
                  aria-label={t('forkFromAssistantResponse')}
                >
                  <GitFork className="h-3.5 w-3.5" strokeWidth={1.8} />
                  <span>{forkAction.busy ? t('forkingThread') : t('forkResponse')}</span>
                </button>
              ) : null}
              <AssistantExportButton text={block.text} createdAt={block.createdAt} />
              <CopyFeedbackButton text={block.text} />
            </div>
          </div>
        ) : null}
        </div>
      </LiveAssistantStreamingProvider>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="ds-card-soft rounded-[20px] px-4 py-3 text-[13.5px] leading-6 text-ds-muted">
        <div className="ds-markdown">
          <AssistantMarkdown text={block.text} streaming={false} />
        </div>
      </div>
    )
  }
  if (block.kind === 'tool') {
    return <ToolEntry block={block} nested={nested} />
  }
  if (block.kind === 'user_input') {
    return (
      <UserInputBubble
        block={block}
        nested={nested}
      />
    )
  }
  if (block.kind === 'approval_review') {
    const statusLabel =
      block.status === 'approved'
        ? t('approvalReviewApproved')
        : block.status === 'denied'
          ? t('approvalReviewDenied')
          : block.status === 'timed-out'
            ? t('approvalReviewTimedOut')
            : block.status === 'failed-closed'
              ? t('approvalReviewFailedClosed')
              : block.status === 'aborted'
                ? t('approvalReviewAborted')
                : t('approvalReviewInProgress')
    const errorTone =
      block.status === 'denied' ||
      block.status === 'timed-out' ||
      block.status === 'failed-closed' ||
      block.status === 'aborted'
    return (
      <div
        className={`rounded-[20px] border px-4 py-3 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
          errorTone
            ? 'border-amber-300/80 bg-amber-500/10 dark:border-amber-800/60 dark:bg-amber-950/30'
            : block.status === 'approved'
              ? 'border-emerald-300/70 bg-emerald-500/10 dark:border-emerald-800/60 dark:bg-emerald-950/25'
              : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.07),rgba(79,124,255,0.11))] text-ds-ink'
        }`}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 font-semibold text-ds-ink">
          {block.status === 'in-progress' ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4 text-accent" aria-hidden="true" />
          )}
          <span>{t('approvalReviewTitle')}</span>
        </div>
        {block.toolName ? (
          <div className="mt-1 text-[12px] text-ds-muted">
            {t('approvalTool', { name: block.toolName })}
          </div>
        ) : null}
        <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ds-ink">{block.summary}</p>
        <p className="mt-2 text-[12px] font-medium text-ds-muted">{statusLabel}</p>
        {block.riskLevel ? (
          <p className="mt-1 text-[12px] text-ds-muted">
            {t('approvalReviewRisk', { risk: block.riskLevel })}
          </p>
        ) : null}
        {block.rationale ? (
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ds-muted">
            {t('approvalReviewRationale', { rationale: block.rationale })}
          </p>
        ) : null}
      </div>
    )
  }
  if (block.kind === 'approval') {
    const submitting = block.status === 'submitting'
    const done = !allowThreadActions || (block.status !== 'pending' && !submitting)
    const statusLabel =
      block.status === 'allowed'
        ? t('approvalAllowed')
        : block.status === 'denied'
          ? t('approvalDenied')
          : block.status === 'expired'
            ? t('approvalExpired')
          : block.status === 'error'
            ? t('approvalFailed')
            : submitting
              ? t('approvalSubmitting')
              : t('approvalPending')
    return (
      <div
        className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
          block.status === 'error'
            ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
            : block.status === 'expired'
              ? 'border-amber-300/80 bg-amber-500/10 dark:border-amber-800/60 dark:bg-amber-950/30'
            : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.08),rgba(79,124,255,0.12))] text-ds-ink'
        }`}
      >
        <div className="font-semibold text-accent">{t('approvalTitle')}</div>
        {block.toolName ? (
          <div className="mt-1 text-[12px] text-ds-muted">
            {t('approvalTool', { name: block.toolName })}
          </div>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[14px] text-ds-ink">{block.summary}</p>
        {block.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
        ) : null}
        {!done ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
              onClick={(event) => runTrustedUserActivation(
                event,
                () => void resolveApproval(block.id, 'allow')
              )}
            >
              {t('approvalAllow')}
            </button>
            <button
              type="button"
              disabled={submitting}
              className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-wait disabled:opacity-60"
              onClick={(event) => runTrustedUserActivation(
                event,
                () => void resolveApproval(block.id, 'deny')
              )}
            >
              {t('approvalDeny')}
            </button>
            {submitting ? (
              <span className="self-center text-[12px] font-medium text-ds-muted">{statusLabel}</span>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-[12px] font-medium text-ds-muted">{statusLabel}</p>
        )}
      </div>
    )
  }
  if (block.kind === 'compaction') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.detail || block.summary}
      </div>
    )
  }
  if (block.kind === 'review') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.reviewText || block.title}
      </div>
    )
  }
  if (block.kind === 'system') {
    const errorTone = block.severity === 'error'
    const warningTone = block.severity === 'warning'
    return (
      <div
        className={`rounded-[18px] border px-3 py-2 text-[13.5px] leading-6 ${
          errorTone
            ? 'border-red-300/80 bg-red-500/10 text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200'
            : warningTone
              ? 'border-amber-300/80 bg-amber-500/10 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100'
              : 'border-ds-border bg-ds-subtle text-ds-muted'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{block.text}</p>
        {block.code ? (
          <p className="mt-1 font-mono text-[11px] opacity-70">{block.code}</p>
        ) : null}
      </div>
    )
  }
  return <></>
}

function ToolEntry({ block, nested = false }: { block: ToolBlock; nested?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  // Errored tool calls stay collapsed by default — only the red header is shown so the
  // (often verbose) error payload doesn't disrupt reading. The user can still expand it.
  const [open, setOpen] = useState(() => block.status === 'running')

  useEffect(() => {
    if (block.status === 'running') {
      setOpen(true)
    }
  }, [block.status, block.id])

  const effectiveOpen = block.status === 'running' ? true : open

  const tone =
    block.status === 'error'
      ? 'border-orange-300/80 bg-orange-500/10 text-orange-950 dark:border-orange-800/60 dark:bg-orange-950/35 dark:text-orange-100'
      : block.status === 'running'
        ? 'border-amber-300/80 bg-amber-500/10 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100'
        : 'border-ds-border bg-ds-subtle text-ds-ink'

  const toolName = typeof block.meta?.toolName === 'string' ? block.meta.toolName.trim() : ''
  const displaySummary =
    toolName === 'background_shell'
      ? summarizeBackgroundShellToolBlock(block, t)
      : block.summary

  const Icon = block.toolKind === 'file_change' ? FileEdit : block.toolKind === 'command_execution' ? Terminal : Wrench
  const kindLabel =
    toolName === 'background_shell'
      ? t('toolBuiltinBackgroundShell', { defaultValue: 'Background shell' })
      : block.toolKind === 'file_change'
        ? t('toolKindFile')
        : block.toolKind === 'command_execution'
          ? t('toolKindCommand')
          : t('toolKindTool')

  const exitCode = readNumber(block.meta, 'exit_code')
  const durationMs = readNumber(block.meta, 'duration_ms')
  const sessionId = metaString(block.meta, 'session_id')
  const sessionStatus = metaString(block.meta, 'status')

  const hasDetail = !!(block.detail && block.detail.trim().length > 0)
  const patchText = block.toolKind === 'file_change' ? extractUnifiedDiffText(block.detail) : undefined
  const canExpand = hasDetail || block.status === 'running'

  return (
    <div className={`rounded-[22px] border shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${tone}`}>
      <button
        type="button"
        onClick={() => {
          if (!canExpand || block.status === 'running') return
          setOpen((v) => !v)
        }}
        className={`flex w-full items-start gap-2 px-4 py-3 text-left text-[13.5px] leading-6 ${
          canExpand && block.status !== 'running' ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-[0.12em] text-[11px] opacity-75">
              {kindLabel}
            </span>
            {block.status === 'running' ? (
              <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                {t('inspectorStatusRunning')}
              </span>
            ) : null}
            {typeof exitCode === 'number' ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-mono ${
                  exitCode === 0
                    ? 'bg-ds-success-soft text-ds-success'
                    : 'bg-orange-500/10 text-orange-800 dark:text-orange-200'
                }`}
              >
                exit {exitCode}
              </span>
            ) : null}
            {sessionId ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted" title={sessionId}>
                {sessionStatus === 'running' ? t('inspectorStatusRunning') : sessionStatus || 'session'} {sessionId.slice(0, 12)}
              </span>
            ) : null}
            {typeof durationMs === 'number' ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted">
                {formatDuration(durationMs)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 break-words">
            {block.filePath ? (
              <span className="font-mono text-[12px] opacity-90">{block.filePath} — </span>
            ) : null}
            <span>{displaySummary}</span>
          </div>
          <RuntimeMetaChips meta={block.meta} hideTurnDisclosure />
        </div>
        {canExpand ? (
          effectiveOpen ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          )
        ) : null}
      </button>
      <ToolAttachmentPreviews meta={block.meta} />
      {effectiveOpen && hasDetail ? (
        <div className="ds-panel-strip min-w-0 border-t border-ds-border-muted/60 px-4 py-3">
          {patchText !== undefined ? (
            <DiffView patch={patchText} filePath={block.filePath} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
              {block.detail}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}
