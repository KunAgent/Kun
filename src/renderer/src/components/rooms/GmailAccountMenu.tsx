import { Ban, CirclePause, LogOut, Repeat2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  busy: boolean
  canStop: boolean
  confirmRevoke: boolean
  onSwitch: () => void
  onStop: () => void
  onDisconnect: () => void
  onAskRevoke: () => void
  onCancelRevoke: () => void
  onRevoke: () => void
}

/** Account management stays behind "Manage" so the card itself is only the sign-in. */
export function GmailAccountMenu({ busy, canStop, confirmRevoke, onSwitch, onStop, onDisconnect, onAskRevoke, onCancelRevoke, onRevoke }: Props) {
  const { t } = useTranslation('common')
  return <div className="gmail-account-menu">
    <button type="button" disabled={busy} onClick={onSwitch}><Repeat2 size={15} />{t('gmailSwitchAccount')}</button>
    {canStop ? <button type="button" disabled={busy} onClick={onStop}><CirclePause size={15} />{t('gmailStopSharing')}</button> : null}
    <button type="button" disabled={busy} title={t('gmailDisconnectDetails')} onClick={onDisconnect}><LogOut size={15} />{t('gmailDisconnect')}</button>
    <button type="button" className="is-danger" disabled={busy} onClick={onAskRevoke}><Ban size={15} />{t('gmailRevoke')}</button>
    {confirmRevoke ? <div className="gmail-revoke-confirm" role="group" aria-label={t('gmailRevoke')}>
      <p>{t('gmailRevokeWarning')}</p>
      <div className="gmail-revoke-actions">
        <button type="button" className="gmail-ghost-button" disabled={busy} onClick={onCancelRevoke}>{t('gmailCancel')}</button>
        <button type="button" className="gmail-danger-button" disabled={busy} onClick={onRevoke}><TriangleAlert size={13} />{t('gmailConfirmRevoke')}</button>
      </div>
    </div> : null}
  </div>
}
