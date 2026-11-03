import type { ReactElement } from 'react'
import { ArrowUpRight, Check, Gift, Info, LoaderCircle, LockKeyhole, LogIn, Shirt, Sparkles, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountState } from '@shared/kun-account'
import type { KunAccountAction } from '../account/useKunAccount'
import { kunAccountErrorCopy } from '../account/kun-account-view'

/** A failure worth explaining here; a cancelled sign-in or a missing bridge is not one. */
function accountProblem(state: KunAccountState): KunAccountState['error'] {
  if (state.user || !state.error || state.error === 'unavailable' || state.error === 'cancelled') return null
  return state.error
}

const BENEFITS = [
  { key: 'wardrobe', Icon: Shirt },
  { key: 'bottles', Icon: Sparkles },
  { key: 'invite', Icon: Gift }
] as const

/**
 * Optional Kun account sign-in. Everything works signed out; the account only
 * carries the wardrobe, bottles and invite rewards across computers.
 */
export function OnboardingAccountStep({ state, busy, platform, onAction }: {
  state: KunAccountState
  busy: KunAccountAction | null
  platform: string
  onAction: (action: KunAccountAction) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const user = state.user
  const waiting = state.status === 'authorizing'
  const unavailable = !user && state.error === 'unavailable'
  const problem = accountProblem(state)
  const copy = problem ? kunAccountErrorCopy(problem, platform) : null
  const tone = user ? 'ok' : waiting ? 'live' : 'idle'
  return (
    <>
      <div className="kun-onb-account" data-tone={tone} data-onboarding-account={user ? 'signed-in' : waiting ? 'waiting' : 'signed-out'}>
        <span className="kun-onb-account-face" aria-hidden="true">
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" draggable={false} />
            : user ? <b>{(user.name || user.email).slice(0, 1).toUpperCase()}</b>
              : <UserRound size={22} strokeWidth={1.8} />}
        </span>
        <span className="kun-onb-account-text">
          <b>{user ? user.name || user.email : t('onboarding.account.cardTitle')}</b>
          <small>
            {user ? user.email
              : waiting ? <><i className="kun-onb-account-live" aria-hidden="true" />{t('common:kunAccountCardWaitingHint')}</>
                : t('onboarding.account.cardSignedOut')}
          </small>
        </span>
        {user ? (
          <span className="kun-onb-done-chip"><Check size={13} strokeWidth={2.6} aria-hidden="true" />{t('common:kunAccountSignedIn')}</span>
        ) : waiting ? (
          <span className="kun-onb-account-actions">
            <button type="button" className="kun-onb-btn" onClick={() => onAction('reopenLogin')} disabled={busy === 'cancelLogin'}>
              <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />{t('common:kunAccountReopen')}
            </button>
            <button type="button" className="kun-onb-btn" onClick={() => onAction('cancelLogin')} disabled={busy === 'cancelLogin'}>
              {t('common:kunAccountCancel')}
            </button>
          </span>
        ) : (
          <button type="button" className="kun-onb-btn is-accent" onClick={() => onAction('login')}
            disabled={unavailable || busy === 'login' || state.status === 'loading'} data-onboarding-account-login>
            {busy === 'login' ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <LogIn size={14} strokeWidth={2} aria-hidden="true" />}
            {t(problem ? 'common:kunAccountSignInAgain' : 'common:kunAccountGuestSignIn')}
          </button>
        )}
      </div>

      {waiting ? (
        <ol className="kun-onb-account-steps">
          <li data-step="done"><Check size={12} strokeWidth={3} aria-hidden="true" />{t('common:kunAccountStepOpened')}</li>
          <li data-step="current" aria-current="step"><i aria-hidden="true" />{t('common:kunAccountStepVerify')}</li>
          <li><i aria-hidden="true" />{t('common:kunAccountStepReturn')}</li>
        </ol>
      ) : null}

      {copy ? (
        <div className="kun-onb-callout" data-tone="danger" role="alert">
          <Info size={16} strokeWidth={1.9} aria-hidden="true" />
          <span><b>{t(`common:${copy.title}`)}</b> {t(`common:${copy.body}`)}</span>
        </div>
      ) : null}

      <section aria-labelledby="kun-onb-account-benefits">
        <div className="kun-onb-section-label">
          <span id="kun-onb-account-benefits">{t(user ? 'onboarding.account.benefitsSignedIn' : 'onboarding.account.benefits')}</span>
          <small>{t('onboarding.account.benefitsHint')}</small>
        </div>
        <ul className="kun-onb-benefits">
          {BENEFITS.map(({ key, Icon }) => (
            <li key={key} className="kun-onb-benefit" data-on={user ? 'true' : undefined}>
              <span className="kun-onb-benefit-icon" data-kind={key}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="kun-onb-benefit-text">
                <b>{t(`onboarding.account.benefit.${key}.title`)}</b>
                <small>{t(`onboarding.account.benefit.${key}.body`)}</small>
              </span>
              {user ? <Check size={16} strokeWidth={2.4} className="kun-onb-benefit-check" aria-hidden="true" /> : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="kun-onb-callout">
        {unavailable ? <Info size={16} strokeWidth={1.8} aria-hidden="true" /> : <LockKeyhole size={16} strokeWidth={1.8} aria-hidden="true" />}
        <span>{t(unavailable ? 'onboarding.account.unavailable' : user ? 'onboarding.account.signedInNote' : 'onboarding.account.optionalNote')}</span>
      </div>
    </>
  )
}
