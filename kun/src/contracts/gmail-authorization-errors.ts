/** Safe diagnostic categories only. Never include Google's descriptions or response payloads. */
export const GMAIL_AUTHORIZATION_ERROR_CODES = [
  'authorization_failed', 'access_denied', 'browser_unavailable', 'callback_unavailable',
  'authorization_expired', 'authorization_cancelled', 'consent_changed',
  'token_invalid_client', 'token_invalid_grant', 'token_invalid_request', 'token_client_secret_required', 'token_unauthorized_client',
  'token_invalid_scope', 'token_temporarily_unavailable', 'token_network_error', 'token_invalid_response',
  'profile_access_expired', 'profile_access_denied', 'profile_unavailable', 'profile_invalid_response',
  'scope_missing', 'storage_protection_required', 'storage_write_failed',
  'google_admin_policy_enforced', 'google_org_internal', 'google_deleted_client',
  'google_redirect_uri_mismatch', 'google_invalid_request', 'google_invalid_scope',
  'google_unauthorized_client', 'google_temporarily_unavailable', 'google_server_error'
] as const

export type GmailAuthorizationErrorCode = typeof GMAIL_AUTHORIZATION_ERROR_CODES[number]
export type GmailAuthorizationFailure = {
  authorizationId: string
  scopeId: string
  errorCode: GmailAuthorizationErrorCode
  failedAt: string
}
