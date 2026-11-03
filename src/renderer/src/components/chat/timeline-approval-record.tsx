import { useId, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Clock3, X } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalEmailPreview } from './ApprovalEmailPreview'
import { approvalDisplayPath } from './approval-card-model'
import { approvalKind } from './approval-kind'
import { useApprovalDenyNote } from './interrupt-card/approval-deny-note-memory'
import { MemoryApprovalHint } from './memory-approval-hint'
import {
  RecordAlertIcon,
  RecordCheckIcon,
  RecordDashIcon,
  RecordWaitingDot
} from './timeline-user-input-record'
import './timeline-records.css'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

export type ApprovalRecordTopic = 'command' | 'file' | 'email' | 'other'

const FILE_TOOL_NAMES = new Set(['edit', 'write', 'multi_edit', 'apply_patch', 'create_file', 'delete_file'])
const PATH_ARGUMENT_KEYS = ['path', 'file_path', 'filePath', 'target_file']

export type ApprovalRecordSubject = {
  topic: ApprovalRecordTopic
  /** What the chip shows: the command, a display path, the mail subject or the tool. */
  target: string | null
  /** The raw target for the chip's tooltip, when the chip shows it shortened. */
  fullTarget?: string
}

/** What was approved (command, file, mail) and the text the record's chip shows. */
export function approvalRecordSubject(block: Pick<ApprovalBlock, 'action' | 'toolName'>): ApprovalRecordSubject {
  const kind = approvalKind(block.action)
  if (kind.kind === 'email') {
    const target = kind.email.subject.trim() || kind.email.to.join(', ')
    return { topic: 'email', target: target || null }
  }
  if (kind.kind === 'command') return { topic: 'command', target: kind.command.trim() || null }
  const action = block.action
  const toolName = (block.toolName ?? action?.toolName ?? '').trim()
  const fileTarget = action?.targets?.find((target) => target.kind === 'file' || target.kind === 'path')?.value
  const fileArgument = PATH_ARGUMENT_KEYS
    .map((key) => action?.arguments?.[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (action?.kind === 'file' || fileTarget || FILE_TOOL_NAMES.has(toolName)) {
    const path = (fileTarget ?? fileArgument ?? '').trim()
    if (path) {
      // Same shortening as the approval card: workspace-relative, else ~/...
      const display = approvalDisplayPath(path, action?.workspace ?? action?.cwd)
      return display === path ? { topic: 'file', target: path } : { topic: 'file', target: display, fullTarget: path }
    }
    if (action?.kind === 'file' || FILE_TOOL_NAMES.has(toolName)) {
      return { topic: 'file', target: toolName || null }
    }
  }
  return { topic: 'other', target: toolName || null }
}

const ALLOWED_KEYS: Record<ApprovalRecordTopic, string> = {
  command: 'composerRecords.allowedRun',
  file: 'composerRecords.allowedEdit',
  email: 'composerRecords.allowedSend',
  other: 'composerRecords.allowed'
}

const DENIED_KEYS: Record<ApprovalRecordTopic, string> = {
  command: 'composerRecords.deniedRun',
  file: 'composerRecords.deniedEdit',
  email: 'composerRecords.deniedSend',
  other: 'composerRecords.denied'
}

/** Copy key of a settled record's leading label. */
export function approvalRecordLabelKey(status: ApprovalBlock['status'], topic: ApprovalRecordTopic): string {
  if (status === 'allowed') return ALLOWED_KEYS[topic]
  if (status === 'denied') return DENIED_KEYS[topic]
  if (status === 'expired') return 'composerRecords.expired'
  if (status === 'error') return 'composerRecords.failed'
  return 'composerRecords.approvalWaiting'
}

function RecordChip({ subject }: { subject: ApprovalRecordSubject }): ReactElement | null {
  const { topic, target, fullTarget } = subject
  if (!target) return null
  const title = fullTarget ?? target
  // A path is cut from the start so its file name stays readable.
  if (topic === 'file') {
    return (
      <span className="ds-timeline-record-chip font-mono" data-truncate="start" title={title}>
        <bdi dir="ltr">{target}</bdi>
      </span>
    )
  }
  return <span className="ds-timeline-record-chip font-mono" title={title}>{target}</span>
}

/**
 * A pending approval that the card in the composer's place is handling:
 * the transcript only points at it, so the decision lives in one place.
 */
export function ApprovalWaitingRecord({ block }: { block: ApprovalBlock }): ReactElement {
  const { t } = useTranslation('common')
  const subject = approvalRecordSubject(block)
  return (
    <section
      className="ds-timeline-record"
      aria-label={t('approvalTitle')}
      data-testid="approval-docked-pointer"
      data-approval-record="waiting"
      data-timeline-block-id={block.id}
    >
      <RecordWaitingDot />
      <span className="ds-timeline-record-label">{t('composerRecords.approvalWaiting')}</span>
      <RecordChip subject={subject} />
      <span className="ds-timeline-record-faint" data-yield="true">{t('composerRecords.approvalHandleBelow')}</span>
    </section>
  )
}

/**
 * Settled approval (allowed, denied, expired, failed) as one line. The line
 * is a disclosure: the evidence the decision was made on (summary, diff,
 * mail) stays one click away instead of filling the transcript.
 */
export function ApprovalSettledRecord({ block }: { block: ApprovalBlock }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const denyNote = useApprovalDenyNote(block.id)
  const subject = approvalRecordSubject(block)
  const kind = approvalKind(block.action)
  const status = block.status
  const icon = status === 'allowed'
    ? <RecordCheckIcon />
    : status === 'denied'
      ? (
          <span className="ds-timeline-record-icon" data-tone="danger" aria-hidden="true">
            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
        )
      : status === 'error'
        ? <RecordAlertIcon />
        : status === 'expired'
          ? (
              <span className="ds-timeline-record-icon" aria-hidden="true">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
            )
          : <RecordDashIcon />
  const note = status === 'denied' && denyNote ? denyNote : null
  return (
    <div className="ds-timeline-record-group" data-approval-record={status} data-timeline-block-id={block.id}>
      <button
        type="button"
        className="ds-timeline-record ds-timeline-record-toggle"
        data-tone={status === 'error' ? 'danger' : undefined}
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        title={open ? t('composerRecords.hideDetails') : t('composerRecords.showDetails')}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="ds-timeline-record-label">{t(approvalRecordLabelKey(status, subject.topic))}</span>
        <RecordChip subject={subject} />
        {/* The note and the error only take what the chip leaves: what ran is cut last. */}
        {note ? (
          <span className="ds-timeline-record-faint" data-yield="true" title={note}>
            {`· ${t('composerRecords.denyNote', { note })}`}
          </span>
        ) : null}
        {status === 'error' && block.errorMessage ? (
          <span className="ds-timeline-record-faint" data-yield="true" title={block.errorMessage}>{block.errorMessage}</span>
        ) : null}
        <span className="ds-timeline-record-chevron">
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </button>
      {open ? (
        <div id={detailId} className="ds-timeline-record-detail" data-approval-record-detail>
          {kind.kind === 'email' ? <ApprovalEmailPreview email={kind.email} t={t} compact /> : <>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{block.summary}</p>
            <ApprovalDetails action={block.action} />
          </>}
          <MemoryApprovalHint toolName={block.toolName} action={block.action} t={t} />
          {note ? <p className="mt-2 text-[12px] leading-[18px] text-ds-muted">{t('composerRecords.denyNote', { note })}</p> : null}
          {block.errorMessage ? (
            <p className="ds-timeline-record-danger mt-2 text-[12px] leading-[18px]">{block.errorMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
