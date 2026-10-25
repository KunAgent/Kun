import { VipEntitlements } from './VipEntitlements'
import type { ReactElement, ReactNode } from 'react'
import { ArrowUpRight, Feather, Gift, LoaderCircle, LockKeyhole, LogIn, LogOut, RefreshCw, Shirt, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountState } from '@shared/kun-account'
import { useChatStore } from '../../store/chat-store'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import type { WardrobeTabRequest } from '../wardrobe/wardrobe-tab-request'
import type { KunAccountAction } from './useKunAccount'
import { kunAccountErrorCopy } from './kun-account-view'
import { KunAccountSky } from './KunAccountPanel'
import { AccountBottleBadge, useAccountWardrobeSummary, useKunRuntimeStatus } from './SidebarAccountCard'

type MenuProps = {
  state: KunAccountState
  busy: KunAccountAction | null
  titleId: string
  onAction: (action: KunAccountAction) => void
  onNavigate: (tab: WardrobeTabRequest) => void
}

function Row({ icon, label, hint, trailing, disabled, nav, onClick }: {
  icon: ReactNode; label: string; hint?: string; trailing?: ReactNode; disabled?: boolean; nav?: WardrobeTabRequest; onClick: () => void
}): ReactElement {
  return (
    <button type="button" className="kun-account-row" disabled={disabled} data-kun-account-nav={nav} onClick={onClick}>
      {icon}
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
      {trailing}
    </button>
  )
}

function WardrobeRow({ hint, onNavigate }: { hint: string; onNavigate: (tab: WardrobeTabRequest) => void }): ReactElement {
  const { t } = useTranslation('common')
  const summary = useAccountWardrobeSummary()
  const here = useChatStore((state) => state.route === 'wardrobe')
  const trailing = here ? <span className="kun-account-row-tag" data-tone="here">{t('kunAccountMenuViewing')}</span>
    : summary.bottles && summary.mode !== 'guest' ? <AccountBottleBadge bottles={summary.bottles} ready={summary.ready} /> : null
  return <Row icon={<Shirt size={16} aria-hidden="true" />} label={t('kunAccountMenuWardrobe')} hint={hint} trailing={trailing} nav="items" onClick={() => onNavigate('items')} />
}

function MenuFoot({ children }: { children?: ReactNode }): ReactElement {
  const runtime = useKunRuntimeStatus()
  return (
    <div className="kun-account-menu-foot">
      <span><i data-runtime={runtime.connection} aria-hidden="true" />{runtime.label}</span>
      {children}
    </div>
  )
}

/** Signed in: who you are, what the wardrobe holds, where it leads, and the account itself. */
export function KunAccountMenu({ state, busy, titleId, onAction, onNavigate, platform, refreshed, manageFailed, onManage }: MenuProps & {
  platform: string; refreshed: boolean; manageFailed: boolean; onManage: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = useAccountWardrobeSummary()
  const user = state.user
  if (!user) return null
  const signingOut = busy === 'logout'
  const value = (n: number | null) => summary.loaded && n !== null ? String(n) : '—'
  const account = summary.mode !== 'local'
  return (
    <div className="kun-account-view kun-account-menu" key="menu">
      <div className="kun-account-menu-head">
        <span className="kun-account-glow is-a" aria-hidden="true" />
        <span className="kun-account-glow is-b" aria-hidden="true" />
        <span className="kun-account-menu-face" aria-hidden="true"><RoomAvatar user id="user" label="" size={46} /></span>
        <span className="kun-account-menu-who">
          <strong id={titleId}>{user.name || user.email}</strong>
          <span>{user.email}</span>
        </span>
      </div>
      <VipEntitlements owner={user.id} />
      <dl className="kun-account-stats">
        <div className="kun-account-stat" data-ready={summary.ready || undefined}>
          <dt>{t(summary.ready ? 'kunAccountMenuBottlesReady' : 'kunAccountMenuBottles')}</dt>
          <dd><WardrobeBottleIcon size={14} state="sealed" />{value(summary.bottles)}</dd>
        </div>
        <div className="kun-account-stat">
          <dt>{t('kunAccountMenuFeathers')}</dt>
          <dd><Feather size={13} aria-hidden="true" />{value(summary.feathers)}</dd>
        </div>
        <div className="kun-account-stat">
          <dt>{t('kunAccountMenuItems')}</dt>
          <dd><Shirt size={13} aria-hidden="true" />{value(summary.owned)}</dd>
        </div>
      </dl>
      {state.error ? (
        <div className="kun-account-warning" role="alert">
          <span>{t('kunAccountSyncWarning')}</span>
          <button type="button" disabled={busy !== null} onClick={() => onAction('refresh')}>{t('kunAccountRetry')}</button>
        </div>
      ) : null}
      {refreshed && !state.error ? <p className="kun-account-note" role="status">{t('kunAccountRefreshed')}</p> : null}
      {manageFailed ? <p className="kun-account-warning" role="alert"><span>{t('kunAccountManageFailed')}</span></p> : null}
      <div className="kun-account-rows" role="group" aria-label={t('kunAccountLabel')}>
        <WardrobeRow hint={t('kunAccountMenuWardrobeHint')} onNavigate={onNavigate} />
        {account ? (
          <>
            <Row icon={<ShoppingBag size={16} aria-hidden="true" />} label={t('kunAccountMenuShop')} hint={t('kunAccountMenuShopHint')} nav="shop" onClick={() => onNavigate('shop')} />
            <Row icon={<Gift size={16} aria-hidden="true" />} label={t('kunAccountMenuInvite')} hint={t('kunAccountMenuInviteHint')} nav="invite" onClick={() => onNavigate('invite')} />
          </>
        ) : null}
        <span className="kun-account-separator" />
        <Row icon={<ArrowUpRight size={16} aria-hidden="true" />} label={t('kunAccountManage')} disabled={signingOut}
          trailing={<span className="kun-account-row-tag">{t('kunAccountMenuBrowser')}</span>} onClick={onManage} />
        <Row icon={busy === 'refresh' ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          label={t('kunAccountRefresh')} disabled={busy !== null} onClick={() => onAction('refresh')} />
        <Row icon={signingOut ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}
          label={signingOut ? t('kunAccountSigningOut') : t('kunAccountSignOut')} hint={signingOut ? undefined : t('kunAccountSignOutHint')}
          disabled={busy !== null} onClick={() => onAction('logout')} />
      </div>
      <MenuFoot>
        <span><LockKeyhole size={13} aria-hidden="true" />{platform === 'darwin' ? t('kunAccountKeychainShort') : t('kunAccountCredentialShort')}</span>
      </MenuFoot>
    </div>
  )
}

/** Signed out: why to sign in, one button to do it, and the wardrobe's starter look. */
export function KunAccountGuestMenu({ state, busy, titleId, onAction, onNavigate, platform }: MenuProps & { platform: string }): ReactElement {
  const { t } = useTranslation('common')
  const problem = state.error && state.error !== 'unavailable' && state.error !== 'cancelled' ? kunAccountErrorCopy(state.error, platform) : null
  return (
    <div className="kun-account-view kun-account-guest" key="guest">
      <KunAccountSky art="greet" chip={t('kunAccountCardSignedOut')} />
      <div className="kun-account-body">
        <h2 id={titleId} className="kun-account-title">{t('kunAccountSignInLabel')}</h2>
        <p className="kun-account-text">{t('kunAccountGuestBody')}</p>
        {problem ? <p className="kun-account-warning" role="alert"><span>{t(problem.title)}</span></p> : null}
        <div className="kun-account-actions">
          <button type="button" className="kun-account-button is-grow" disabled={busy === 'login'} onClick={() => onAction('login')}>
            {busy === 'login' ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <LogIn size={14} aria-hidden="true" />}
            {t('kunAccountGuestSignIn')}
          </button>
        </div>
      </div>
      <span className="kun-account-separator" />
      <div className="kun-account-rows" role="group" aria-label={t('kunAccountMenuWardrobe')}>
        <WardrobeRow hint={t('kunAccountMenuWardrobeGuestHint')} onNavigate={onNavigate} />
      </div>
      <MenuFoot />
    </div>
  )
}
