import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, Mail, ShieldAlert } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { ApprovalActions } from './ApprovalActions'
import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalEmailPreview, approvalEmail } from './ApprovalEmailPreview'
import { useIsApprovalDocked } from './approval-dock-registry'
import { MemoryApprovalHint } from './memory-approval-hint'
import { useTimelineSurface } from './timeline-surface'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

/**
 * Transcript record of an approval. While the composer dock owns a pending
 * request, this collapses to a one-line pointer so the decision lives in one
 * place; resolved and undocked requests keep the full evidence.
 */
export function TimelineApprovalCard({ block, allowThreadActions }: {
  block: ApprovalBlock
  allowThreadActions: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  const surface = useTimelineSurface()
  const docked = useIsApprovalDocked(block.id)
  const submitting = block.status === 'submitting'
  const pending = block.status === 'pending' || submitting
  const email = approvalEmail(block.action)
  const title = email
    ? t('approvalEmailQuestion')
    : block.toolName ? t('approvalToolQuestion', { name: block.toolName }) : t('approvalTitle')
  const Icon = email ? Mail : ShieldAlert
  const icon = (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${
      email ? 'bg-accent-tint/10 text-accent' : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
    }`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  )

  if (pending && docked && allowThreadActions) {
    return (
      <section aria-label={t('approvalTitle')} className="flex min-w-0 items-center gap-3 rounded-[16px] border border-ds-border bg-ds-card px-3.5 py-2.5" data-testid="approval-docked-pointer">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-5 text-ds-ink">{title}</p>
          <p className="truncate text-[12px] leading-5 text-ds-faint">{t('approvalDockedHint')}</p>
        </div>
        <ArrowDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
      </section>
    )
  }

  const statusLabel =
    block.status === 'allowed' ? t('approvalAllowed')
      : block.status === 'denied' ? t('approvalDenied')
        : block.status === 'expired' ? t('approvalExpired')
          : block.status === 'error' ? t('approvalFailed')
            : submitting ? t('approvalSubmitting') : t('approvalPending')
  const statusTone =
    block.status === 'allowed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : block.status === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300'
        : block.status === 'denied' || block.status === 'expired' ? 'bg-ds-subtle text-ds-muted'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  // Mobile owns pending approvals through the composer-adjacent
  // MobilePendingActions card, so the transcript never repeats its buttons.
  const showActions = pending && allowThreadActions && surface !== 'mobile'
  return (
    <section aria-label={t('approvalTitle')} className={`rounded-[18px] border bg-ds-card px-4 py-3.5 text-[13px] leading-6 ${
      block.status === 'error' ? 'border-red-300/80 dark:border-red-800/60' : 'border-ds-border'
    }`}>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">{title}</p>
        {showActions ? null : (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${statusTone}`}>{statusLabel}</span>
        )}
      </div>
      <div className="mt-3">
        {email ? <ApprovalEmailPreview email={email} t={t} compact /> : <>
          <p className="whitespace-pre-wrap break-words text-[13px] text-ds-ink [overflow-wrap:anywhere]">{block.summary}</p>
          <ApprovalDetails action={block.action} />
        </>}
      </div>
      <MemoryApprovalHint toolName={block.toolName} action={block.action} t={t} />
      {block.errorMessage ? (
        <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
      ) : null}
      {showActions ? (
        <div className="mt-3 flex justify-end">
          <ApprovalActions options={block.action?.permissionOptions} submitting={submitting} t={t}
            allowLabel={email ? t('approvalEmailSend') : undefined}
            onDecide={(decision, choice) => void resolveApproval(block.id, decision, choice)} />
        </div>
      ) : null}
    </section>
  )
}
