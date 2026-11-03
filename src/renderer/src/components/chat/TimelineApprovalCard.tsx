import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { ApprovalActions } from './ApprovalActions'
import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalEmailPreview } from './ApprovalEmailPreview'
import { ApprovalKindIcon, approvalKind, approvalQuestion } from './approval-kind'
import { useIsApprovalDocked } from './approval-dock-registry'
import { MemoryApprovalHint } from './memory-approval-hint'
import { useTimelineSurface } from './timeline-surface'
import { ApprovalSettledRecord, ApprovalWaitingRecord } from './timeline-approval-record'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

/**
 * Transcript record of an approval. A settled request collapses to one line
 * (its evidence opens on demand); while the card in the composer's place owns
 * a pending request, the transcript only points at it so the decision lives
 * in one place. A pending request nobody docks keeps its evidence and the
 * numbered decision rows here.
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

  if (!pending) return <ApprovalSettledRecord block={block} />
  if (docked && allowThreadActions) return <ApprovalWaitingRecord block={block} />

  const kind = approvalKind(block.action)
  const email = kind.kind === 'email' ? kind.email : null
  const title = approvalQuestion(kind, block.toolName, t)
  // Mobile owns pending approvals through the composer-adjacent
  // MobilePendingActions card, so the transcript never repeats its buttons.
  const showActions = allowThreadActions && surface !== 'mobile'
  return (
    <section
      aria-label={t('approvalTitle')}
      className="rounded-[18px] border border-ds-border bg-ds-card px-4 py-3.5 text-[13px] leading-6"
      data-approval-record="pending"
      data-timeline-block-id={block.id}
    >
      <div className="flex min-w-0 items-center gap-3">
        <ApprovalKindIcon kind={kind.kind} size="sm" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ds-ink">{title}</p>
        {showActions ? null : (
          <span className="shrink-0 rounded-[7px] bg-ds-warning-soft px-2 py-0.5 text-[12px] font-medium text-ds-status-warning">
            {submitting ? t('approvalSubmitting') : t('approvalPending')}
          </span>
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
        <p className="mt-2 text-[12px] text-ds-status-danger">{block.errorMessage}</p>
      ) : null}
      {showActions ? (
        <div className="-mx-2 mt-2">
          <ApprovalActions layout="rows" options={block.action?.permissionOptions} submitting={submitting} t={t}
            allowLabel={email ? t('approvalEmailSend') : undefined}
            onDecide={(decision, choice) => void resolveApproval(block.id, decision, choice)} />
        </div>
      ) : null}
    </section>
  )
}
