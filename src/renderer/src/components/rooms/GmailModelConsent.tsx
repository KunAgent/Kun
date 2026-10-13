import { useTranslation } from 'react-i18next'
import type { GmailConversationStatus, GmailModelRecipient } from '@shared/gmail-api'

export function gmailModelRecipient(status: GmailConversationStatus | null): GmailModelRecipient | undefined {
  const recipient = status?.modelProcessingRecipient
  return recipient === 'kun-managed-local' || recipient === 'deepseek-api' ? recipient : undefined
}

/** A local grant is never a cloud grant, including when an older server returns only a boolean. */
export function hasCurrentGmailModelConsent(status: GmailConversationStatus | null): boolean {
  const recipient = gmailModelRecipient(status)
  return !!recipient && status?.allowModelSharing === true && status.modelSharingRecipient === recipient
}

export function gmailModelSharingAvailable(status: GmailConversationStatus | null): boolean {
  return !!gmailModelRecipient(status) && status?.modelSharingAvailable === true && !!status.modelProcessingConsentId
}

function restrictionKey(status: GmailConversationStatus): string {
  if (gmailModelRecipient(status) !== 'deepseek-api') return 'gmailModelRestricted'
  return status.modelSharingReason === 'deepseek_api_account_not_reviewed' ? 'gmailDeepSeekAccountReviewRequired' : 'gmailDeepSeekUnavailable'
}

type Props = {
  status: GmailConversationStatus | null
  sharing: boolean
  busy: boolean
  pending: boolean
  skipped: boolean
  onChange: (value: boolean) => void
}

export function GmailModelConsent({ status, sharing, busy, pending, skipped, onChange }: Props) {
  const { t } = useTranslation('common')
  const recipient = gmailModelRecipient(status)
  const available = gmailModelSharingAvailable(status)
  const deepseek = recipient === 'deepseek-api'
  return <div className="gmail-model-consent" data-recipient={recipient ?? 'unavailable'}>
    {recipient ? <p className="gmail-data-recipient">
      <strong>{t(deepseek ? 'gmailDeepSeekRecipient' : 'gmailLocalRecipient')}</strong>
      {deepseek ? <small>{t('gmailDeepSeekRetention')}</small> : null}
    </p> : null}
    {status && !available ? <p role="status">{t(restrictionKey(status))}</p> : null}
    {!skipped ? <label className="gmail-sharing-consent">
      <input type="checkbox" checked={sharing}
        disabled={busy || pending || !status?.configured || (!available && !sharing)}
        onChange={(event) => onChange(event.target.checked)} />
      <span>{t(deepseek ? 'gmailDeepSeekSharingConsent' : 'gmailSharingConsent')}
        <small>{t(deepseek ? 'gmailDeepSeekSharingDetails' : 'gmailSharingDetails')}</small>
        <small>{t('gmailHistoryAndRemoteViewing')}</small>
      </span>
    </label> : null}
    <small>{t('gmailSharingScope')}</small>
  </div>
}
