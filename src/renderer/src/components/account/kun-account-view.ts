import type { KunAccountError, KunAccountState, KunAccountUser } from '@shared/kun-account'

/** What the account panel shows for a given redacted state. */
export type KunAccountView = 'none' | 'waiting' | 'welcome' | 'menu' | 'error'
export type KunAccountEntry = 'loading' | 'login' | 'busy' | 'avatar'
/** Red asks the user to sign in again; amber means the profile could not sync. */
export type KunAccountBadge = 'none' | 'attention' | 'warning'
export type KunAccountArt = 'laptop' | 'cheer' | 'greet' | 'sleep' | 'headset' | 'wrench'
export type KunAccountErrorAction = 'retry' | 'login' | 'dismiss'

export function kunAccountView(state: KunAccountState, welcome: boolean): KunAccountView {
  if (state.status === 'authorizing') return 'waiting'
  if (state.user) return welcome ? 'welcome' : 'menu'
  if (state.error && state.error !== 'unavailable') return 'error'
  return 'none'
}

export function kunAccountEntry(state: KunAccountState): KunAccountEntry {
  if (state.status === 'loading') return 'loading'
  if (state.status === 'authorizing') return 'busy'
  return state.user ? 'avatar' : 'login'
}

export function kunAccountBadge(state: KunAccountState): KunAccountBadge {
  if (!state.error || state.error === 'unavailable') return 'none'
  if (state.user) return 'warning'
  return state.error === 'cancelled' ? 'none' : 'attention'
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

/** The first visible character of the display name, for the avatar disc. */
export function kunAccountInitial(user: Pick<KunAccountUser, 'name' | 'email'> | null): string {
  const source = (user?.name || user?.email || 'K').trim() || 'K'
  return (Array.from(source)[0] ?? 'K').toUpperCase()
}

export const KUN_ACCOUNT_PANEL_WIDTH = 312
const MARGIN = 12
const GAP = 8

/**
 * Opens above the entry, right edges aligned, clamped into the window.
 * Rects arrive in zoomed viewport pixels; results are layout pixels for a
 * fixed element under the zoomed body.
 */
export function kunAccountPanelPlacement({ anchor, viewportWidth, viewportHeight, scale = 1 }: {
  anchor: Pick<DOMRect, 'top' | 'right'>
  viewportWidth: number
  viewportHeight: number
  scale?: number
}): { left: number; bottom: number; width: number; maxHeight: number } {
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1
  const vw = viewportWidth / zoom
  const vh = viewportHeight / zoom
  const width = Math.max(0, Math.min(KUN_ACCOUNT_PANEL_WIDTH, vw - MARGIN * 2))
  const left = Math.min(Math.max(anchor.right / zoom - width, MARGIN), Math.max(MARGIN, vw - MARGIN - width))
  const top = anchor.top / zoom
  return { left, bottom: Math.max(MARGIN, vh - top + GAP), width, maxHeight: Math.max(160, top - GAP - MARGIN) }
}
