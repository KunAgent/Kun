import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalActions } from './ApprovalActions'
import { ApprovalEmailPreview, approvalEmail } from './ApprovalEmailPreview'
import { setDockedApprovalIds } from './approval-dock-registry'
import { useEffect, useState, type ReactElement } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Mail,
  ShieldAlert,
  Square
} from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
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

  const dockedIds = approvals.map((approval) => approval.id).join('\n')
  useEffect(() => {
    setDockedApprovalIds(dockedIds ? dockedIds.split('\n') : [])
    return () => setDockedApprovalIds([])
  }, [dockedIds])

  const current = approvals[Math.min(index, approvals.length - 1)]
  if (!current) return null
  const submitting = current.status === 'submitting'
  const email = approvalEmail(current.action)
  const title = email
    ? t('approvalEmailQuestion')
    : current.toolName ? t('approvalToolQuestion', { name: current.toolName }) : t('approvalTitle')
  const subtitle = email ? t('approvalEmailSubtitle') : t('approvalPending')
  const Icon = email ? Mail : ShieldAlert

  return (
    <section
      aria-label={t('approvalTitle')}
      data-composer-stack-item="approval"
      className={`ds-no-drag pointer-events-auto relative z-30 flex max-h-[70dvh] w-full flex-col overflow-hidden border border-ds-border bg-ds-card shadow-[0_16px_42px_rgba(20,47,95,0.11)] ${
        compact ? 'rounded-[16px]' : 'rounded-[20px]'
      }`}
    >
      <header className={`shrink-0 ${compact ? 'px-4 pb-2 pt-3.5' : 'px-5 pb-2.5 pt-4'}`}>
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${
              email ? 'bg-accent-tint/10 text-accent' : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
            }`}>
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="break-words text-[14px] font-semibold leading-5 text-ds-ink [overflow-wrap:anywhere]">
                {title}
              </h2>
              <p className="mt-0.5 text-[12px] leading-5 text-ds-faint">
                {subtitle}
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

      <div className={`min-h-0 overflow-y-auto ${compact ? 'px-4 pb-3' : 'px-5 pb-4'}`} data-approval-evidence-scroll>
        {email ? <ApprovalEmailPreview email={email} t={t} compact={compact} /> : <>
          <div
            tabIndex={0}
            className={`overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-ds-border-muted bg-ds-main/40 font-mono text-[12px] leading-5 text-ds-ink [overflow-wrap:anywhere] ${
              compact ? 'max-h-28 px-2.5 py-2' : 'max-h-40 px-3 py-2.5'
            }`}
          >
            {current.summary}
          </div>
          <ApprovalDetails action={current.action} />
        </>}
        <MemoryApprovalHint toolName={current.toolName} action={current.action} t={t} />
        {current.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{current.errorMessage}</p>
        ) : null}
      </div>

      <footer className={`flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-ds-border-muted ${
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

        <ApprovalActions options={current.action?.permissionOptions} submitting={submitting} t={t}
          allowLabel={email ? t('approvalEmailSend') : undefined}
          onDecide={(decision, choice) => void resolveApproval(current.id, decision, choice)} />
      </footer>
    </section>
  )
}
