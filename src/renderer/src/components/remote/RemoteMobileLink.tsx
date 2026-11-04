import { useState, type ReactElement } from 'react'
import { Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import { MobileScopeOptions, PERSONAL_SCOPES } from './MobileScopeOptions'
import { MobileGrantRow } from './MobileGrantRow'
import { runTrustedUserActivation } from '../../extensions/protected-user-activation'
import type { MobileLink } from './useMobileLink'
import { RemoteCompactRow, REMOTE_FOCUS } from './remote-compact-ui'
import { mobileRequirement } from './remote-access-state'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS, RemoteSwitch } from './remote-panel-ui'

/** Requests remain mounted across detail navigation; advanced consent is opt-in. */
export function MobilePairingRequests({ link }: { link: MobileLink }): ReactElement | null {
  const { t } = useTranslation('common')
  const { zh, enabled, state, busy, confirm } = link
  const [choices, setChoices] = useState<Record<string, MobileLinkScope[]>>({})
  if (!enabled || !state?.pairings.length) return null
  return <div className="flex flex-col gap-2">
    {state.pairings.map(pairing => <div key={pairing.id} className="rounded-2xl bg-accent-soft p-3">
      <div className="flex items-center gap-3">
        <Smartphone size={17} className="shrink-0 text-ds-muted" aria-hidden />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-ds-ink">{t('remoteCompact.pairRequest', { name: pairing.name })}</span>
        <button type="button" className={REMOTE_PRIMARY_BUTTON_CLASS} disabled={Boolean(busy) || !link.mobileAllowed}
          onClick={event => runTrustedUserActivation(event, () => confirm(pairing.id, choices[pairing.id] ?? PERSONAL_SCOPES))}>
          {t('remoteCompact.allow')}
        </button>
      </div>
      {!link.mobileAllowed ? <p className="mt-1 text-[12px] text-ds-muted">{mobileRequirement(link, t)}</p> : null}
      <details className="mt-1 text-[12px] text-ds-muted">
        <summary className={`cursor-pointer rounded-md py-1 ${REMOTE_FOCUS}`}>{t('remoteCompact.adjustPermissions')}</summary>
        <MobileScopeOptions zh={zh} disabled={Boolean(busy) || !link.mobileAllowed} value={choices[pairing.id] ?? PERSONAL_SCOPES}
          onChange={value => setChoices(current => ({ ...current, [pairing.id]: value }))} />
      </details>
    </div>)}
  </div>
}

export function MobileChannelRow({ link }: { link: MobileLink }): ReactElement {
  const { t } = useTranslation('common')
  const { api, account, signedIn, state, busy, starting, canStop, enabled, toggle } = link
  const on = enabled || starting
  const requirement = mobileRequirement(link, t)
  const subtitle = busy === 'stop' ? t('remoteCompact.stopping') : requirement || (starting
    ? t('remoteCompact.starting') : state?.online ? t('remoteCompact.mobileConnected')
      : enabled ? t('remoteCompact.connecting') : t('remoteCompact.mobileOff'))
  const error = link.mobileAllowed ? link.connectionError : ''
  return <div>
    <RemoteCompactRow icon={Smartphone} title={t('remoteCompact.phone')} subtitle={subtitle} locked={Boolean(requirement) && !on}>
      <RemoteSwitch checked={on} label={starting ? t('remoteCompact.cancelStart') : on ? t('remoteCompact.stopPhone') : t('remoteCompact.startPhone')}
        disabled={!api || !signedIn || !state || busy === 'stop' || (!canStop && (!link.mobileAllowed || Boolean(busy)))} onToggle={toggle} />
    </RemoteCompactRow>
    {!signedIn && account.api ? <div className="px-3 pb-2">
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(account.busy)}
        onClick={() => void account.run(account.state.status === 'authorizing' ? 'cancelLogin' : 'login')}>
        {account.state.status === 'authorizing' ? t('remoteAccessCancel') : t('remoteCompact.signIn')}
      </button>
    </div> : null}
    {link.membershipState === 'unavailable' ? <div className="px-3 pb-2"><button type="button" className={REMOTE_BUTTON_CLASS}
      disabled={Boolean(busy)} onClick={link.refreshMembership}>{t('remoteCompact.retry')}</button></div> : null}
    {error ? <div className="space-y-2 px-3 pb-3 text-[12px] leading-4">
      <p role="alert" className="text-ds-danger">{error}</p>
      {['VIP_REQUIRED', 'ENTITLEMENTS_UNAVAILABLE'].includes(state?.error ?? '') ? <button type="button" className={REMOTE_BUTTON_CLASS}
        disabled={Boolean(busy)} onClick={link.retryVip}>{t('remoteCompact.reconnect')}</button> : null}
    </div> : null}
    {signedIn && state?.error === 'DEVICE_AUTHORIZATION_REQUIRED' && !on ? <div className="px-3 pb-3">
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={Boolean(busy)}
        onClick={event => runTrustedUserActivation(event, link.resetIdentity)}>{t('remoteCompact.resetDevice')}</button>
    </div> : null}
  </div>
}

export function MobileGrantRows({ link }: { link: MobileLink }): ReactElement[] {
  if (!link.enabled || !link.state) return []
  return link.state.grants.map(grant => <MobileGrantRow key={grant.id} link={link} grant={grant} />)
}
