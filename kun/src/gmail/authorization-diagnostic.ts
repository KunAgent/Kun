import { GMAIL_AUTHORIZATION_ERROR_CODES, type GmailAuthorizationErrorCode } from '../contracts/gmail-authorization-errors.js'
import { GmailError } from './ports.js'

/** A fixed category accompanies an existing safe public error, never a raw OAuth payload. */
export class GmailAuthorizationDiagnosticError extends GmailError {
  constructor(code: string, message: string, readonly authorizationErrorCode: GmailAuthorizationErrorCode) {
    super(code, message)
  }
}

export function authorizationFailureCode(error: unknown): GmailAuthorizationErrorCode {
  if (error instanceof GmailAuthorizationDiagnosticError) return GMAIL_AUTHORIZATION_ERROR_CODES.includes(error.authorizationErrorCode)
    ? error.authorizationErrorCode : 'authorization_failed'
  if (!(error instanceof GmailError)) return 'authorization_failed'
  switch (error.code) {
    case 'scope_missing': return 'scope_missing'
    case 'storage_protection_required': return 'storage_protection_required'
    case 'consent_changed': return 'consent_changed'
    case 'authorization_cancelled': case 'cancelled': return 'authorization_cancelled'
    case 'callback_unavailable': return 'callback_unavailable'
    case 'browser_unavailable': return 'browser_unavailable'
    default: return 'authorization_failed'
  }
}

export function tokenFailureCode(error: unknown, status: number, description?: unknown): GmailAuthorizationErrorCode {
  if (error === 'invalid_request' && description === 'client_secret is missing.') return 'token_client_secret_required'
  switch (error) {
    case 'invalid_client': return 'token_invalid_client'
    case 'invalid_grant': return 'token_invalid_grant'
    case 'invalid_request': return 'token_invalid_request'
    case 'unauthorized_client': return 'token_unauthorized_client'
    case 'invalid_scope': return 'token_invalid_scope'
    case 'temporarily_unavailable': case 'server_error': return 'token_temporarily_unavailable'
    default: return status === 429 || status >= 500 ? 'token_temporarily_unavailable' : 'authorization_failed'
  }
}

export function googleCallbackFailureCode(error: string): GmailAuthorizationErrorCode {
  switch (error) {
    case 'access_denied': return 'access_denied'
    case 'admin_policy_enforced': return 'google_admin_policy_enforced'
    case 'org_internal': return 'google_org_internal'
    case 'deleted_client': return 'google_deleted_client'
    case 'redirect_uri_mismatch': return 'google_redirect_uri_mismatch'
    case 'invalid_request': return 'google_invalid_request'
    case 'invalid_scope': return 'google_invalid_scope'
    case 'unauthorized_client': return 'google_unauthorized_client'
    case 'temporarily_unavailable': return 'google_temporarily_unavailable'
    case 'server_error': return 'google_server_error'
    default: return 'authorization_failed'
  }
}
