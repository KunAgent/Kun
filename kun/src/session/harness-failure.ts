/**
 * Delegated failure → finishTurn code/message mapping (P6-02, generalized
 * from `mapAcpFailure`): startup spawn/init failures read as
 * `harness_not_ready`; mid-turn process death is `harness_crashed`; malformed
 * required frames are `harness_protocol_error`; the agent's own protocol
 * errors are `agent_error`. User-facing text is bounded and never carries
 * environment or credential material.
 */
import { HarnessTransportError } from './harness-session.js'

export type HarnessFailureClass = { code: string; message: string }

export function mapHarnessFailure(
  error: unknown,
  startup: boolean,
  transportLabel: string
): HarnessFailureClass {
  if (error instanceof HarnessTransportError) {
    switch (error.code) {
      case 'request_timeout':
        return startup
          ? {
              code: 'harness_not_ready',
              message: `${transportLabel} agent did not complete startup in time`
            }
          : { code: 'request_timeout', message: sanitize(error.message) }
      case 'harness_not_ready':
        return { code: 'harness_not_ready', message: sanitize(error.message) }
      case 'harness_protocol_error':
        return { code: 'harness_protocol_error', message: sanitize(error.message) }
      case 'harness_crashed':
      case 'connection_closed':
        return { code: 'harness_crashed', message: sanitize(error.message) }
      case 'policy_denied':
        return { code: 'policy_denied', message: sanitize(error.message) }
      case 'request_aborted':
        return { code: 'request_aborted', message: sanitize(error.message) }
      case 'agent_error':
      default:
        return { code: 'agent_error', message: sanitize(error.message) }
    }
  }
  const errno = error as NodeJS.ErrnoException
  if (
    errno?.code === 'ENOENT' ||
    errno?.code === 'EACCES' ||
    errno?.code === 'EPERM'
  ) {
    return {
      code: 'harness_not_ready',
      message: `${transportLabel} agent executable is not available (${errno.code})`
    }
  }
  return {
    code: startup ? 'harness_not_ready' : 'agent_error',
    message: sanitize(error instanceof Error ? error.message : String(error))
  }
}

function sanitize(message: string): string {
  return message.slice(0, 2_000)
}
