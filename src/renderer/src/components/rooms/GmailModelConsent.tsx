import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GmailConversationStatus } from '@shared/gmail-api'

const PRIVACY_URL = 'https://www.kun-agent.com/privacy'

/** Legacy provider-specific grants need one fresh conversation-wide confirmation. */
export function hasCurrentGmailModelConsent(status: GmailConversationStatus | null): boolean {
  return status?.allowModelSharing === true && status.modelSharingRecipient === 'configured-models'
}

export function gmailModelSharingAvailable(status: GmailConversationStatus | null): boolean {
  return status?.configured === true
}

/** The consent sits next to the one action: clicking connect (or "use here") is the agreement. */
export function GmailConsentNote({ status, granting }: { status: GmailConversationStatus | null; granting: boolean }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const provider = status?.modelProviderName
  return <div className="gmail-consent-note">
    <p>
      {t(granting ? 'gmailConsentLeadGrant' : 'gmailConsentLead')}
      {provider ? <span className="gmail-model-chip" title={provider}>{provider}</span> : ' '}
      {t('gmailConsentTail')}{' '}
      <button type="button" className="gmail-link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('gmailDataDetails')}<ChevronDown size={12} className={open ? 'is-open' : undefined} />
      </button>
    </p>
    {open ? <div className="gmail-data-details-body">
      <p>{t('gmailModelDataPolicy')}</p>
      <p>{t('gmailHistoryAndRemoteViewing')}</p>
      <p>{t('gmailLocalCredentials')}</p>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer"
        onClick={(event) => { if (window.kunGui?.openExternal) { event.preventDefault(); void window.kunGui.openExternal(PRIVACY_URL) } }}>{t('gmailPrivacy')}</a>
    </div> : null}
  </div>
}
