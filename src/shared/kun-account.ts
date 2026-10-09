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
  onState(handler: (state: KunAccountState) => void): () => void
}

export const KUN_ACCOUNT_CHANNELS = {
  state: 'kun-account:state', get: 'kun-account:get', login: 'kun-account:login',
  cancel: 'kun-account:cancel', refresh: 'kun-account:refresh', logout: 'kun-account:logout',
  manage: 'kun-account:manage', reopen: 'kun-account:reopen'
} as const
