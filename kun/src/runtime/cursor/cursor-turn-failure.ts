import { cursorSdkErrorCode, sanitizeCursorSdkError } from './cursor-sdk-runtime-support.js'
import { cursorAuthenticationFailureMessage } from './cursor-sdk-runtime-trace.js'

/** One sanitized failure description shared by trace and terminal turn state. */
export function cursorTurnFailure(error: unknown, apiKey: string, input: {
  timedOut: boolean
  maxWallTimeMs: number
  authenticationRecoveryAttempted: boolean
}): { code: string; message: string; safeTraceError: Error } {
  const code = input.timedOut ? 'turn_wall_time_limit' : cursorSdkErrorCode(error)
  const message = input.timedOut
    ? `Cursor SDK turn exceeded ${input.maxWallTimeMs}ms wall time`
    : code === 'cursor_sdk_authentication_failed' && input.authenticationRecoveryAttempted
      ? cursorAuthenticationFailureMessage()
      : sanitizeCursorSdkError(error, apiKey)
  const safeTraceError = new Error(message)
  safeTraceError.name = error instanceof Error ? error.name : 'CursorSdkError'
  return { code, message, safeTraceError }
}
