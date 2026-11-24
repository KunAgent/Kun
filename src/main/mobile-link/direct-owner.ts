import { hasKunAccountSession, type KunAccountState } from '../../shared/kun-account'

/** Owns only local direct grants and runtime receipts. Never used to acquire an account token. */
export const LOCAL_DIRECT_OWNER = 'local-guest'

export function directOwner(state: KunAccountState): string | null {
  if (state.status === 'anonymous' && !state.user) return LOCAL_DIRECT_OWNER
  const id = state.user?.id
  return id && id !== LOCAL_DIRECT_OWNER && hasKunAccountSession(state) ? id : null
}
