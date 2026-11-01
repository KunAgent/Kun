import type { KunAccountError, KunAccountState } from '@shared/kun-account'

/** What the account panel shows for a given redacted state. */
export type KunAccountView = 'none' | 'waiting' | 'welcome' | 'menu' | 'guest' | 'error'
/** Red asks the user to sign in again; amber means the profile could not sync. */
export type KunAccountBadge = 'none' | 'attention' | 'warning'
export type KunAccountArt = 'laptop' | 'cheer' | 'greet' | 'sleep' | 'headset' | 'wrench'
export type KunAccountErrorAction = 'retry' | 'login' | 'dismiss'

/**
 * A failed sign-in explains itself once, in the panel it pops open (`failure`). Opened from the
 * card afterwards, a signed-out account shows the guest menu, which offers sign-in again.
 */
export function kunAccountView(state: KunAccountState, welcome: boolean, failure = false): KunAccountView {
  if (state.status === 'authorizing') return 'waiting'
  if (state.user) return welcome ? 'welcome' : 'menu'
  if (state.status === 'loading') return 'none'
  if (failure && state.error && state.error !== 'unavailable') return 'error'
  return 'guest'
}

export function kunAccountBadge(state: KunAccountState): KunAccountBadge {
  if (!state.error || state.error === 'unavailable') return 'none'
  if (state.user) return 'warning'
  return state.error === 'cancelled' ? 'none' : 'attention'
}

export type KunAccountCardTone = 'plain' | 'live' | 'warn' | 'bad'
/** The card's two lines; a null title or hint means the account's own name or email. */
export type KunAccountCardCopy = { title: string | null; hint: string | null; tone: KunAccountCardTone }

/** Second-line priority: signing in, then an expired or failed sign-in, then a sync warning, then the email. */
export function kunAccountCardCopy(state: KunAccountState): KunAccountCardCopy {
  if (state.status === 'authorizing') return { title: 'kunAccountSigningIn', hint: 'kunAccountCardWaitingHint', tone: 'live' }
  if (state.user) {
    return state.error && state.error !== 'unavailable'
      ? { title: null, hint: 'kunAccountCardSyncHint', tone: 'warn' }
      : { title: null, hint: null, tone: 'plain' }
  }
  if (state.error === 'expired') return { title: 'kunAccountCardExpired', hint: 'kunAccountCardExpiredHint', tone: 'bad' }
  if (kunAccountBadge(state) === 'attention') return { title: 'kunAccountCardSignedOut', hint: 'kunAccountCardFailedHint', tone: 'bad' }
  // Signed out the card invites rather than reports: "Sign in to Kun", not "Not signed in".
  return { title: 'kunAccountSignInLabel', hint: 'kunAccountCardSignedOutHint', tone: 'plain' }
}

type ErrorCopy = { title: string; body: string; action: KunAccountErrorAction; art: KunAccountArt }

/** i18n keys per error; secure storage names the macOS keychain only on macOS. */
export function kunAccountErrorCopy(error: KunAccountError, platform: string): ErrorCopy {
  switch (error) {
    case 'network': return { title: 'kunAccountErrorNetworkTitle', body: 'kunAccountErrorNetworkBody', action: 'retry', art: 'headset' }
    case 'timeout': return { title: 'kunAccountErrorTimeoutTitle', body: 'kunAccountErrorTimeoutBody', action: 'login', art: 'sleep' }
    case 'cancelled': return { title: 'kunAccountErrorCancelledTitle', body: 'kunAccountErrorCancelledBody', action: 'login', art: 'greet' }
    case 'expired': return { title: 'kunAccountErrorExpiredTitle', body: 'kunAccountErrorExpiredBody', action: 'login', art: 'sleep' }
    case 'port_busy': return { title: 'kunAccountErrorPortTitle', body: 'kunAccountErrorPortBody', action: 'retry', art: 'wrench' }
    case 'secure_storage': return platform === 'darwin'
      ? { title: 'kunAccountErrorKeychainTitle', body: 'kunAccountErrorKeychainBody', action: 'retry', art: 'wrench' }
      : { title: 'kunAccountErrorCredentialTitle', body: 'kunAccountErrorCredentialBody', action: 'retry', art: 'wrench' }
    case 'configuration': return { title: 'kunAccountErrorConfigTitle', body: 'kunAccountErrorConfigBody', action: 'dismiss', art: 'wrench' }
    default: return { title: 'kunAccountErrorServiceTitle', body: 'kunAccountErrorServiceBody', action: 'retry', art: 'headset' }
  }
}

export const KUN_ACCOUNT_PANEL_WIDTH = 296
const MARGIN = 12
const GAP = 8

/**
 * Opens above the account card, left edges aligned, clamped into the window.
 * Rects arrive in zoomed viewport pixels; results are layout pixels for a
 * fixed element under the zoomed body.
 */
export function kunAccountPanelPlacement({ anchor, viewportWidth, viewportHeight, scale = 1 }: {
  anchor: Pick<DOMRect, 'top' | 'left'>
  viewportWidth: number
  viewportHeight: number
  scale?: number
}): { left: number; bottom: number; width: number; maxHeight: number } {
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1
  const vw = viewportWidth / zoom
  const vh = viewportHeight / zoom
  const width = Math.max(0, Math.min(KUN_ACCOUNT_PANEL_WIDTH, vw - MARGIN * 2))
  const left = Math.min(Math.max(anchor.left / zoom, MARGIN), Math.max(MARGIN, vw - MARGIN - width))
  const top = anchor.top / zoom
  return { left, bottom: Math.max(MARGIN, vh - top + GAP), width, maxHeight: Math.max(160, top - GAP - MARGIN) }
}
