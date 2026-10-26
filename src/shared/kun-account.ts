import type { KunAccountWardrobeApi } from './kun-account-economy'

export type KunAccountError = 'network' | 'configuration' | 'expired' | 'cancelled' | 'timeout'
  | 'port_busy' | 'secure_storage' | 'service' | 'unavailable'

export type KunAccountUser = Readonly<{
  id: string
  email: string
  name: string
  avatarUrl: string | null
}>

/** Only this redacted projection crosses IPC. Tokens are main-process-only. */
export type KunAccountState = Readonly<{
  status: 'loading' | 'anonymous' | 'authorizing' | 'authenticated' | 'error'
  user: KunAccountUser | null
  error: KunAccountError | null
}>

export interface KunAccountApi {
  getState(): Promise<KunAccountState>
  login(): Promise<KunAccountState>
  /** Opens the pending sign-in page again; it reuses the same request. */
  reopenLogin(): Promise<KunAccountState>
  cancelLogin(): Promise<KunAccountState>
  refresh(): Promise<KunAccountState>
  logout(): Promise<KunAccountState>
  openAccountCenter(): Promise<void>
  openMembership?(): Promise<void>
  /** The signed-in account's photo as a data URL (the renderer CSP blocks remote images); null without one. */
  photo?(): Promise<string | null>
  onState(handler: (state: KunAccountState) => void): () => void
  /** The account's wardrobe, feather shop and invitations. */
  wardrobe: KunAccountWardrobeApi
}

export const KUN_ACCOUNT_CHANNELS = {
  state: 'kun-account:state', get: 'kun-account:get', login: 'kun-account:login',
  cancel: 'kun-account:cancel', refresh: 'kun-account:refresh', logout: 'kun-account:logout',
  manage: 'kun-account:manage', membership: 'kun-account:membership', reopen: 'kun-account:reopen',
  photo: 'kun-account:photo'
} as const

/** A transient network outage keeps an already verified account signed in locally. */
export function hasKunAccountSession(state: KunAccountState): boolean {
  return Boolean(state.user) && (state.status === 'authenticated' ||
    (state.status === 'error' && (state.error === 'network' || state.error === 'service')))
}
