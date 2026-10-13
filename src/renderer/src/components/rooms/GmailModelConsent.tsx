import { useTranslation } from 'react-i18next'
import type { GmailConversationStatus } from '@shared/gmail-api'

/** Legacy provider-specific grants need one fresh conversation-wide confirmation. */
export function hasCurrentGmailModelConsent(status: GmailConversationStatus | null): boolean {
  return status?.allowModelSharing === true && status.modelSharingRecipient === 'configured-models'
}

export function gmailModelSharingAvailable(status: GmailConversationStatus | null): boolean {
  return status?.configured === true
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
  return <div className="gmail-model-consent">
    {!skipped ? <label className="gmail-sharing-consent">
      <input type="checkbox" checked={sharing}
        disabled={busy || pending || !status?.configured}
        onChange={(event) => onChange(event.target.checked)} />
      <span>{t('gmailSharingConsent')}<small>{t('gmailSharingDetails')}</small></span>
    </label> : null}
    <small className="gmail-sharing-scope">{t('gmailSharingScope')}</small>
    <details className="gmail-data-details">
      <summary>{t('gmailDataDetails')}</summary>
      <p>{t('gmailModelDataPolicy')}</p>
      <p>{t('gmailHistoryAndRemoteViewing')}</p>
    </details>
  </div>
}
