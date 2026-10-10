import type { ReactElement, Ref } from 'react'
import { ChevronsUpDown, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunAccountState } from '@shared/kun-account'
import { kunWardrobeRules, kunWardrobeItems } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { useWardrobe, wardrobeShelf } from '../rooms/room-wardrobe'
import { kunAccountBadge, kunAccountCardCopy } from './kun-account-view'
import '../rooms/room-wardrobe.css'

export type KunRuntimeConnection = 'ready' | 'checking' | 'idle' | 'offline'

const RUNTIME_KEYS = {
  ready: 'sidebarKunStatusReady',
  checking: 'sidebarKunStatusStarting',
  idle: 'sidebarKunStatusStarting',
  offline: 'sidebarKunStatusOffline'
} as const

/** Kun's runtime state as one short line: "Kun · Ready". */
export function useKunRuntimeStatus(): { connection: KunRuntimeConnection; label: string } {
  const { t } = useTranslation('common')
  const connection = useChatStore((state) => state.runtimeConnection) as KunRuntimeConnection
  return { connection, label: `Kun · ${t(RUNTIME_KEYS[connection] ?? RUNTIME_KEYS.checking)}` }
}

/** What the wardrobe already loaded says about the account; nothing here makes a request of its own. */
export function useAccountWardrobeSummary() {
  const { wardrobe, mode, unlockAll } = useWardrobe()
  const bottles = wardrobeShelf(wardrobe).length
  const items = kunWardrobeItems()
  const owned = wardrobe ? (unlockAll ? items.length : items.filter((item) => (wardrobe.items[item.key] ?? 0) > 0).length) : null
  return { loaded: Boolean(wardrobe), bottles, ready: Boolean(wardrobe?.progress?.tenPull) && bottles >= kunWardrobeRules(wardrobe).tenPull, feathers: wardrobe?.feathers ?? null, owned, mode }
}

/** Bottles waiting on the shelf, gold once a ten-pull is ready. */
export function AccountBottleBadge({ bottles, ready }: { bottles: number; ready: boolean }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <span className="ds-sidebar-kun-bottles" data-ready={ready || undefined} data-sidebar-bottles={bottles} aria-hidden="true">
      <WardrobeBottleIcon size={16} state="sealed" />
      {ready ? t('wardrobePageBadgeReady') : bottles}
    </span>
  )
}

export type SidebarAccountCardProps = {
  variant: 'card' | 'compact'
  state: KunAccountState
  open: boolean
  panelId?: string
  cardRef: Ref<HTMLDivElement>
  triggerRef: Ref<HTMLButtonElement>
  onToggle: () => void
  onLogin: () => void
}

/**
 * The whole footer block is the Kun account: the dressed-up Kun (its corner dot is the runtime
 * state), the name and email, and the bottles waiting. A click opens the account menu above it;
 * signed out, a second button starts the browser sign-in directly.
 */
export function SidebarAccountCard({ variant, state, open, panelId, cardRef, triggerRef, onToggle, onLogin }: SidebarAccountCardProps): ReactElement {
  const { t } = useTranslation('common')
  const runtime = useKunRuntimeStatus()
  const summary = useAccountWardrobeSummary()
  const onWardrobe = useChatStore((value) => value.route === 'wardrobe')
  const compact = variant === 'compact'
  const loading = state.status === 'loading'
  const busy = state.status === 'authorizing'
  const user = state.user
  const signIn = !user && !busy && !loading
  const copy = kunAccountCardCopy(state)
  // The one-line form has no room for the sign-in button, so its title says what a click leads to.
  const name = compact && signIn ? t('kunAccountSignInLabel') : copy.title ? t(copy.title) : user?.name || user?.email || ''
  const hint = copy.hint ? t(copy.hint) : user?.email ?? ''
  // A guest's shelf is always empty; the local debug wardrobe has bottles without an account.
  const bottles = summary.mode === 'guest' ? 0 : summary.bottles
  const shelf = bottles ? t(summary.ready ? 'wardrobePageBadgeReadyHint' : 'wardrobePageBadgeHint', { n: bottles }) : ''
  const label = [t('kunAccountOpenMenu', { name }), compact ? '' : hint, runtime.label, shelf].filter(Boolean).join('. ')
  return (
    <div
      ref={cardRef}
      className="kun-account-card"
      data-kun-account-card
      data-variant={variant}
      data-account={loading ? 'loading' : busy ? 'busy' : user ? 'signed-in' : 'signed-out'}
      data-open={open || undefined}
      data-active={onWardrobe || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="kun-account-card-main"
        data-kun-account-login
        data-cursor-spotlight-target
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={loading ? t('kunAccountLabel') : `${label}. ${t('kunAccountCardOpen')}`}
        title={user ? `${user.name} · ${user.email}` : undefined}
        disabled={loading}
        onClick={onToggle}
      >
        {loading ? (
          <>
            <span className="kun-account-card-skeleton is-face" aria-hidden="true" />
            <span className="kun-account-card-text" aria-hidden="true" style={{ gap: 6 }}>
              <span className="kun-account-card-skeleton" style={{ width: 64, height: 10 }} />
              {compact ? null : <span className="kun-account-card-skeleton" style={{ width: 120, height: 8 }} />}
            </span>
          </>
        ) : (
          <>
            <span className="kun-account-card-face" aria-hidden="true">
              <RoomAvatar user id="user" label="" size={compact ? 22 : 32} />
              <i className="kun-account-presence" data-runtime={runtime.connection} title={runtime.label} />
            </span>
            <span className="kun-account-card-text">
              <span className="kun-account-card-name">{name}</span>
              {compact ? null : <span className="kun-account-card-hint" data-tone={copy.tone}>{hint}</span>}
            </span>
            {bottles ? <AccountBottleBadge bottles={bottles} ready={summary.ready} /> : null}
            {busy ? <span className="kun-account-spinner" aria-hidden="true" />
              : signIn && !compact ? null
                : <ChevronsUpDown className="kun-account-card-chevron" size={14} strokeWidth={2} aria-hidden="true" />}
          </>
        )}
      </button>
      {signIn && !compact ? (
        <button type="button" className="kun-account-card-login" data-badge={kunAccountBadge(state) === 'attention' || undefined} onClick={onLogin}>
          <LogIn size={13} aria-hidden="true" />{t('kunAccountSignIn')}
        </button>
      ) : null}
    </div>
  )
}
