/**
 * Classification for model stream transport failures that mean "the
 * connection ended before the model finished" rather than "the provider
 * rejected the request". Shared by the model round engine (failure
 * persistence) and the turn lifecycle (settlement) so a disconnect keeps one
 * stable code across events, items, and renderer error cards.
 */

export const STREAM_DISCONNECTED_CODE = 'stream_disconnected'

/**
 * Error codes produced by the compat model clients for transport-level
 * disconnects. Provider business errors (401/404/429/400, context overflow,
 * quota) never appear here.
 */
const TRANSPORT_DISCONNECT_CODES = new Set([
  'stream_read_error',
  'stream_truncated',
  'stream_idle_timeout',
  STREAM_DISCONNECTED_CODE
])

export function isStreamDisconnectCode(code: string | undefined): boolean {
  return typeof code === 'string' && TRANSPORT_DISCONNECT_CODES.has(code)
}

/**
 * Upstream gateways (Responses-protocol relays in particular) report a
 * mid-stream disconnect as a raw payload error whose message mentions the
 * stream closing before the terminal event, with a code like
 * `stream_disconnected`. Detect that shape so it can be reclassified instead
 * of surfacing the gateway's internal wording to the user.
 */
export function looksLikeUpstreamStreamDisconnect(message: string): boolean {
  const lowered = message.toLowerCase()
  return lowered.includes('stream closed before') ||
    lowered.includes('stream disconnected') ||
    (lowered.includes('stream') && lowered.includes('terminated'))
}

export type StreamDisconnectFailureRewrite = {
  error: string
  code: string
  details?: Record<string, unknown>
}

/**
 * Rewrite a transport disconnect failure into a user-facing message that does
 * not blame the model provider. The original message/code are preserved in
 * `details` for logs and the collapsed card detail view.
 */
export function rewriteStreamDisconnectFailure(input: {
  error: string
  code?: string
  details?: unknown
}): StreamDisconnectFailureRewrite | null {
  const byCode = isStreamDisconnectCode(input.code)
  const byMessage = looksLikeUpstreamStreamDisconnect(input.error)
  if (!byCode && !byMessage) return null
  const existingDetails = typeof input.details === 'object' && input.details !== null
    ? input.details as Record<string, unknown>
    : {}
  const rawMessage = typeof existingDetails.rawMessage === 'string'
    ? existingDetails.rawMessage
    : input.error
  const rawCode = typeof existingDetails.rawCode === 'string'
    ? existingDetails.rawCode
    : input.code
  return {
    error:
      'The model connection ended before the response completed. This is a ' +
      'network/gateway interruption, not a provider rejection. You can retry.',
    code: STREAM_DISCONNECTED_CODE,
    details: {
      ...existingDetails,
      ...(rawMessage ? { rawMessage } : {}),
      ...(rawCode ? { rawCode } : {})
    }
  }
}
