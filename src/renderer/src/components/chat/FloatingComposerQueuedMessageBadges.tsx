import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { kunToolPermissionModeFromSettings } from '@shared/app-settings'
import { writePromptQuotesFromComposerContexts } from '../../write/write-composer-context-quotes'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
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
  const quoteCount = writePromptQuotesFromComposerContexts(message.composerContexts).length

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
