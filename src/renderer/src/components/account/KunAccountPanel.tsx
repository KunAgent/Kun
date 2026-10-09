import type { ReactElement, ReactNode } from 'react'
import { ArrowUpRight, Check, LoaderCircle, LockKeyhole, LogOut, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountState } from '@shared/kun-account'
import laptopArt from '../../../../asset/img/kun-account/laptop.webp'
import cheerArt from '../../../../asset/img/kun-account/cheer.webp'
import greetArt from '../../../../asset/img/kun-account/greet.webp'
import sleepArt from '../../../../asset/img/kun-account/sleep.webp'
import headsetArt from '../../../../asset/img/kun-account/headset.webp'
import wrenchArt from '../../../../asset/img/kun-account/wrench.webp'
import type { KunAccountAction } from './useKunAccount'
import { kunAccountErrorCopy, type KunAccountArt, type KunAccountView } from './kun-account-view'
import { KunAccountAvatar } from './KunAccountAvatar'

/** Painted Kun poses; the art is never redrawn as vectors. */
const ART: Record<KunAccountArt, string> = {
  laptop: laptopArt, cheer: cheerArt, greet: greetArt, sleep: sleepArt, headset: headsetArt, wrench: wrenchArt
}

export type KunAccountPanelProps = {
  view: Exclude<KunAccountView, 'none'>
  state: KunAccountState
  busy: KunAccountAction | null
  platform: string
  reopened: boolean
  refreshed: boolean
  manageFailed: boolean
  titleId: string
  onAction: (action: KunAccountAction) => void
  onManage: () => void
  onClose: () => void
}

function Sky({ art, chip, tone }: { art: KunAccountArt; chip?: ReactNode; tone?: 'live' | 'ok' }): ReactElement {
  return (
    <div className="kun-account-sky" data-art={art} aria-hidden="true">
      <span className="kun-account-glow is-a" />
      <span className="kun-account-glow is-b" />
      <i className="kun-account-star is-a" /><i className="kun-account-star is-b" /><i className="kun-account-star is-c" />
      {chip ? <span className="kun-account-chip" data-tone={tone}>{chip}</span> : null}
      <img key={art} className="kun-account-art" src={ART[art]} alt="" draggable={false} />
    </div>
  )
}

export function KunAccountPanel(props: KunAccountPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const { view, state, busy, titleId, onAction } = props
  const user = state.user
  if (view === 'waiting') {
    return (
      <div className="kun-account-view" key="waiting">
        <Sky art="laptop" tone="live" chip={<><i className="kun-account-live" />{t('kunAccountWaitingChip')}</>} />
        <div className="kun-account-body">
          <h2 id={titleId} className="kun-account-title">{t('kunAccountWaitingTitle')}</h2>
          <p className="kun-account-text">{t('kunAccountWaitingBody')}</p>
          <ol className="kun-account-steps">
            <li data-step="done"><span className="kun-account-step-dot"><Check size={11} strokeWidth={3} aria-hidden="true" /></span>{t('kunAccountStepOpened')}</li>
            <li data-step="current" aria-current="step"><span className="kun-account-step-dot"><i /></span>{t('kunAccountStepVerify')}</li>
            <li><span className="kun-account-step-dot" />{t('kunAccountStepReturn')}</li>
          </ol>
          {props.reopened ? <p className="kun-account-ok" role="status"><Check size={13} strokeWidth={2.6} aria-hidden="true" />{t('kunAccountReopened')}</p> : null}
          <div className="kun-account-actions">
            <button type="button" className="kun-account-button is-ghost is-grow" disabled={busy === 'cancelLogin'} onClick={() => onAction('reopenLogin')}>
              <ArrowUpRight size={14} aria-hidden="true" />{t('kunAccountReopen')}
            </button>
            <button type="button" className="kun-account-button is-quiet" disabled={busy === 'cancelLogin'} onClick={() => onAction('cancelLogin')}>{t('kunAccountCancel')}</button>
          </div>
          <p className="kun-account-hint">{t('kunAccountWaitingHint')}</p>
        </div>
      </div>
    )
  }
  if (view === 'welcome' && user) {
    return (
      <div className="kun-account-view" key="welcome" role="status" aria-live="polite">
        <Sky art="cheer" tone="ok" chip={<><Check size={12} strokeWidth={2.6} aria-hidden="true" />{t('kunAccountSignedIn')}</>} />
        <div className="kun-account-body">
          <h2 id={titleId} className="kun-account-title">{t('kunAccountWelcomeTitle', { name: user.name })}</h2>
          <p className="kun-account-text">{t('kunAccountWelcomeBody', { email: user.email })}</p>
          <div className="kun-account-drain" aria-hidden="true"><i /></div>
          <div className="kun-account-actions">
            <button type="button" className="kun-account-button is-grow" onClick={props.onClose}>{t('kunAccountWelcomeOk')}</button>
          </div>
        </div>
      </div>
    )
  }
  if (view === 'menu' && user) {
    const signingOut = busy === 'logout'
    return (
      <div className="kun-account-view" key="menu">
        <div className="kun-account-who">
          <KunAccountAvatar user={user} size={40} large />
          <span className="kun-account-who-text">
            <strong id={titleId}>{user.name}</strong>
            <span>{user.email}</span>
          </span>
          {state.error ? null : <span className="kun-account-pill">{t('kunAccountSignedIn')}</span>}
        </div>
        {state.error ? (
          <div className="kun-account-warning" role="alert">
            <span>{t('kunAccountSyncWarning')}</span>
            <button type="button" disabled={busy !== null} onClick={() => onAction('refresh')}>{t('kunAccountRetry')}</button>
          </div>
        ) : null}
        {props.refreshed && !state.error ? <p className="kun-account-note" role="status">{t('kunAccountRefreshed')}</p> : null}
        {props.manageFailed ? <p className="kun-account-warning" role="alert"><span>{t('kunAccountManageFailed')}</span></p> : null}
        <div className="kun-account-rows" role="group" aria-label={t('kunAccountLabel')}>
          <button type="button" className="kun-account-row" disabled={signingOut} onClick={props.onManage}>
            <ArrowUpRight size={16} aria-hidden="true" />
            <span>{t('kunAccountManage')}<small>{t('kunAccountManageHint')}</small></span>
          </button>
          <button type="button" className="kun-account-row" disabled={busy !== null} onClick={() => onAction('refresh')}>
            {busy === 'refresh' ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            <span>{t('kunAccountRefresh')}</span>
          </button>
          <span className="kun-account-separator" />
          <button type="button" className="kun-account-row" disabled={busy !== null} onClick={() => onAction('logout')}>
            {signingOut ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}
            <span>{signingOut ? t('kunAccountSigningOut') : t('kunAccountSignOut')}{signingOut ? null : <small>{t('kunAccountSignOutHint')}</small>}</span>
          </button>
        </div>
        <p className="kun-account-footnote">
          <LockKeyhole size={13} aria-hidden="true" />
          {props.platform === 'darwin' ? t('kunAccountKeychainNote') : t('kunAccountCredentialNote')}
        </p>
      </div>
    )
  }
  const copy = kunAccountErrorCopy(state.error ?? 'service', props.platform)
  const primary = copy.action === 'dismiss' ? t('kunAccountGotIt') : copy.action === 'login' ? t('kunAccountSignInAgain') : t('kunAccountRetry')
  return (
    <div className="kun-account-view" key={`error-${state.error ?? 'service'}`}>
      <Sky art={copy.art} />
      <div className="kun-account-body">
        <h2 id={titleId} className="kun-account-title">{t(copy.title)}</h2>
        <p className="kun-account-text">{t(copy.body)}</p>
        <div className="kun-account-actions">
          <button type="button" className="kun-account-button is-grow" disabled={busy === 'login'}
            onClick={() => copy.action === 'dismiss' ? props.onClose() : onAction('login')}>
            {busy === 'login' ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}{primary}
          </button>
          {copy.action === 'dismiss' ? null : (
            <button type="button" className="kun-account-button is-quiet" onClick={props.onClose}>
              {state.error === 'expired' ? t('kunAccountLater') : t('kunAccountClose')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The close affordance shared by every view. */
export function KunAccountPanelClose({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button type="button" className="kun-account-close" aria-label={t('kunAccountClose')} onClick={onClose}>
      <X size={14} aria-hidden="true" />
    </button>
  )
}
