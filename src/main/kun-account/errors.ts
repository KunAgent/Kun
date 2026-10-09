import type { KunAccountError } from '../../shared/kun-account'

export class AccountError extends Error {
  constructor(readonly code: KunAccountError) { super(code); this.name = 'AccountError' }
}
export const accountErrorCode = (error: unknown): KunAccountError => error instanceof AccountError ? error.code : 'service'
