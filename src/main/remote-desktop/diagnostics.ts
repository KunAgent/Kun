export type DesktopDiagnostic = {
  event: 'start_failed' | 'viewing' | 'media_ready' | 'controlling' | 'ended'
  stage?: 'origin' | 'permission' | 'ice' | 'capture_open' | 'capture_identity' | 'input_start' | 'input_lease' | 'capture_start'
  code?: string
}

const CODES = new Set([
  'SCREEN_PERMISSION_REQUIRED', 'INPUT_PERMISSION_REQUIRED', 'DESKTOP_ICE_UNAVAILABLE',
  'DESKTOP_CAPTURE_FAILED', 'DESKTOP_CAPTURE_LOAD_FAILED', 'DESKTOP_CAPTURE_TIMEOUT', 'DESKTOP_CAPTURE_NOT_ISOLATED',
  'DESKTOP_INPUT_LOST', 'DESKTOP_INPUT_TIMEOUT', 'DESKTOP_UNSUPPORTED',
  'DESKTOP_SESSION_EXPIRED', 'DESKTOP_AUTHORITY_CHANGED', 'DESKTOP_SOURCE_CHANGED',
  'DESKTOP_CLEANUP_UNCONFIRMED', 'DESKTOP_CONNECTION_FAILED',
  'start_failed', 'media_closed', 'guard_lost', 'input_helper_lost', 'input_cleanup_failed',
  'lease_or_authority_expired', 'configuration_changed', 'host_user_ended', 'user_ended',
  'connection_failed', 'setup_timeout', 'reconnect_failed', 'application_quit',
  'authorization_changed', 'display_changed', 'invalid_signaling', 'signal_limit',
  'conversation_left', 'cancelled', 'host_stopped', 'host_inactive', 'host_closing',
  'background', 'foreground_recovery', 'provider_changed', 'replaced', 'cleanup_retry',
  'ice_refresh_failed', 'signaling_failed', 'invalid_message', 'invalid_media_message',
  'DESKTOP_CAPTURE_CLOSED', 'DESKTOP_START_CANCELLED', 'DESKTOP_INPUT_BACKPRESSURE',
  'CONTROL_RPC_TIMEOUT', 'CONTROL_PROCESS_CLOSED', 'CONTROL_PROCESS_UNAVAILABLE',
  'CONTROL_RPC_REJECTED', 'CONTROL_OPERATION_FAILED'
])

/** Do not record remote messages, input text, SDP, ICE candidates or credentials. */
export function desktopDiagnosticCode(value: unknown): string {
  const code = value instanceof Error ? value.message : value
  return typeof code === 'string' && CODES.has(code) ? code : 'unknown'
}
