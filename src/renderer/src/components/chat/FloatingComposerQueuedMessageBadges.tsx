import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { kunToolPermissionModeFromSettings } from '@shared/app-settings'
import { writePromptQuotesFromComposerContexts } from '../../write/write-composer-context-quotes'
import { messageQuotesFromComposerContexts } from '../../lib/message-quote'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import { queuedAttachmentSummary, type QueuedMessageStatus } from './composer-queue-row-state'
import css from './FloatingComposerQueuedMessages.module.css'

/**
 * Compact indicators for the settings a queued message froze when it was
 * submitted. They make the deferred-execution contract visible: the row runs
 * with the mode/approval policy captured at enqueue time, not whatever is
 * selected in the composer by the time the queue drains.
 */
export function QueuedMessageSnapshotBadges({
  message
}: {
  message: QueuedComposerMessage
}): ReactElement | null {
  const { t } = useTranslation('common')
  const badges: ReactElement[] = []
  const quoteCount = writePromptQuotesFromComposerContexts(message.composerContexts).length +
    messageQuotesFromComposerContexts(message.composerContexts).length

  if (quoteCount > 0) {
    badges.push(
      <span key="quote" className={css.badge} data-queued-message-badge="quote">
        {t('writePromptReferencesCount', { count: quoteCount })}
      </span>
    )
  }

  if (message.mode === 'plan') {
    badges.push(
      <span key="plan" className={css.badge} data-queued-message-badge="plan">
        {t('planMode')}
      </span>
    )
  }

  if (message.approvalPolicy && message.sandboxMode) {
    const permissionMode = kunToolPermissionModeFromSettings({
      approvalPolicy: message.approvalPolicy,
      sandboxMode: message.sandboxMode,
      approvalReviewer: message.approvalReviewer
    })
    if (permissionMode === 'full-access') {
      badges.push(
        <span key="full-access" className={css.badge} data-queued-message-badge="full-access">
          {t('toolPermissionFullAccessShort')}
        </span>
      )
    } else if (permissionMode === 'approve-for-me') {
      badges.push(
        <span key="approve-for-me" className={css.badge} data-queued-message-badge="approve-for-me">
          {t('toolPermissionApproveForMeShort')}
        </span>
      )
    }
  }

  if (badges.length === 0) return null
  return <span className={css.badges}>{badges}</span>
}

/** One attachment by name, otherwise "2 images" / "1 file" counts. */
export function QueuedMessageAttachments({
  message
}: {
  message: QueuedComposerMessage
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = queuedAttachmentSummary(message)
  if (summary.imageCount === 0 && summary.documentCount === 0) return null
  const parts = summary.singleName
    ? [summary.singleName]
    : [
        summary.imageCount > 0 ? t('composerQueue.images', { count: summary.imageCount }) : '',
        summary.documentCount > 0 ? t('composerQueue.files', { count: summary.documentCount }) : ''
      ].filter(Boolean)
  return (
    <span
      className={css.attachments}
      data-queued-message-images={summary.imageCount > 0 ? summary.imageCount : undefined}
      title={summary.names || undefined}
    >
      {parts.join(' · ')}
    </span>
  )
}

/** Delivery state in its tone: confirming, paused, withdrawn, failed + reason. */
export function QueuedMessageDeliveryStatus({
  status
}: {
  status: QueuedMessageStatus | null
}): ReactElement | null {
  if (!status) return null
  const detail = status.tone === 'danger' ? status.detail : undefined
  return (
    <span
      className={css.status}
      data-tone={status.tone}
      data-queued-message-status
      title={detail ? `${status.label} · ${detail}` : status.label}
    >
      <span className={css.statusLabel}>{status.label}</span>
      {detail ? <span className={css.statusDetail}>{detail}</span> : null}
    </span>
  )
}
