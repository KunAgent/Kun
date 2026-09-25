import { useEffect, useState, type ReactElement } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ShieldAlert,
  Square
} from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import { useChatStore } from '../../store/chat-store'
import { MemoryApprovalHint } from './memory-approval-hint'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Pending runtime approvals docked directly above the composer so they cannot
 * be scrolled past in the transcript. One request is in focus at a time; the
 * detail region scrolls rather than truncating, matching the timeline card's
 * mono presentation. Decisions still flow through `resolveApproval`, so the
 * timeline card and this panel never disagree about state.
 */
export function FloatingComposerApprovalPanel({
  approvals,
  t,
  variant = 'main'
}: {
  approvals: ApprovalBlock[]
  t: Translate
  variant?: 'main' | 'compact'
}): ReactElement | null {
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  const interrupt = useChatStore((s) => s.interrupt)
  const [index, setIndex] = useState(0)
  const compact = variant === 'compact'

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, approvals.length - 1)))
  }, [approvals.length])

  const current = approvals[Math.min(index, approvals.length - 1)]
  if (!current) return null
  const submitting = current.status === 'submitting'

  return (
    <section
      aria-label={t('approvalTitle')}
      data-composer-stack-item="approval"
      className={`ds-no-drag pointer-events-auto relative z-30 w-full overflow-hidden border border-ds-border bg-ds-card shadow-[0_16px_42px_rgba(20,47,95,0.11)] ${
        compact ? 'rounded-[16px]' : 'rounded-[20px]'
      }`}
    >
      <header className={`border-b border-ds-border-muted ${compact ? 'px-4 py-3' : 'px-5 py-3.5'}`}>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold leading-5 text-ds-ink">
                {t('approvalTitle')}
              </h2>
              <p className="mt-0.5 text-[12px] leading-5 text-ds-faint">
                {t('approvalPending')}
              </p>
            </div>
          </div>
          {approvals.length > 1 ? (
            <span className="flex shrink-0 items-center gap-0.5 pt-1">
              <button
                type="button"
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                disabled={index === 0}
                aria-label={t('findInChatPrevious')}
                className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
              </button>
              <span className="px-1 text-[12px] font-semibold tabular-nums text-ds-muted">
                {index + 1} / {approvals.length}
              </span>
              <button
                type="button"
                onClick={() => setIndex((value) => Math.min(approvals.length - 1, value + 1))}
                disabled={index >= approvals.length - 1}
                aria-label={t('findInChatNext')}
                className="rounded-md p-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-35"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </span>
          ) : null}
        </div>
      </header>

      <div className={compact ? 'px-4 py-3' : 'px-5 py-4'}>
        {current.toolName ? (
          <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11.5px] font-semibold text-ds-muted">
            <span className="truncate font-mono">{current.toolName}</span>
          </div>
        ) : null}
        <div
          className={`overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-ds-border-muted bg-ds-main/40 font-mono text-[12px] leading-5 text-ds-ink [overflow-wrap:anywhere] ${
            compact ? 'max-h-28 px-2.5 py-2' : 'max-h-40 px-3 py-2.5'
          }`}
        >
          {current.summary}
        </div>
        <MemoryApprovalHint toolName={current.toolName} action={current.action} t={t} />
        {current.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{current.errorMessage}</p>
        ) : null}
      </div>

      <footer className={`flex min-h-14 items-center justify-between gap-3 border-t border-ds-border-muted bg-ds-main/25 ${
        compact ? 'px-4 py-2.5' : 'px-5 py-3'
      }`}>
        <button
          type="button"
          onClick={() => void interrupt()}
          disabled={submitting}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
          title={t('approvalInterruptTurnHint')}
        >
          <Square className="h-3.5 w-3.5" strokeWidth={2} />
          <span>{t('approvalInterruptTurn')}</span>
        </button>

        <div className="flex items-center gap-2">
          {submitting ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              {t('approvalSubmitting')}
            </span>
          ) : null}
          <button
            type="button"
            disabled={submitting}
            onClick={(event) => runTrustedUserActivation(
              event,
              () => void resolveApproval(current.id, 'deny')
            )}
            className="inline-flex min-h-10 items-center rounded-[11px] border border-ds-border bg-ds-card px-4 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('approvalDeny')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={(event) => runTrustedUserActivation(
              event,
              () => void resolveApproval(current.id, 'allow')
            )}
            className="inline-flex min-h-10 items-center rounded-[11px] border border-accent bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_6px_16px_rgba(37,99,235,0.2)] transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('approvalAllow')}
          </button>
        </div>
      </footer>
    </section>
  )
}
