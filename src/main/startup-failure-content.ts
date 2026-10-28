import { join } from 'node:path'
import { defaultKunControlDir } from '../../kun/src/manager/manager-discovery.js'
import { ManagerStartLockError } from '../../kun/src/manager/manager-start-lock-support.js'
import { WindowsStartupIntegrityError } from '../../kun/src/process/windows-startup-native.js'
import { ServiceManagerUnavailableError } from '../../kun/src/manager/manager-resolution-error.js'
import { OrphanedAppSessionError } from '../../kun/src/manager/app-session-reservation.js'
import { KunHandoffError } from './runtime/kun-installed-build-handoff'
import { STARTUP_ACTION_PROTOCOL } from './startup-failure-page'

const MAX_FAILURE_MESSAGE_LENGTH = 1_200
const STARTUP_FAILURE_ACTIONS = ['retry', 'open-logs', 'open-log-file', 'copy-diagnostics', 'quit'] as const

export type StartupFailureAction = 'retry' | 'open-logs' | 'open-log-file' | 'copy-diagnostics' | 'quit'
export type StartupFailureKind =
  | 'integrity'
  | 'start-lock'
  | 'orphaned'
  | 'manager-leftover'
  | 'manager-unavailable'
  | 'manager-exited'
  | 'runtime-auth'
  | 'client-busy'
  | 'handoff'
  | 'generic'
export type StartupFailurePresentation = {
  kind: StartupFailureKind
  message: string
  handoff: boolean
  retryable: boolean
  recheck?: boolean
  orphaned?: boolean
}

export function sanitizeStartupFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|refresh_token|id_token|code|client_secret)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/("(?:access_token|refresh_token|id_token|client_secret|password|runtimeToken|managerToken|apiKey)"\s*:\s*")[^"]+/gi, '$1[redacted]')
    .replace(/\b(runtimeToken|managerToken|apiKey)=\S+/gi, '$1=[redacted]')
    .slice(0, MAX_FAILURE_MESSAGE_LENGTH)
}

export function startupFailurePresentation(error: unknown): StartupFailurePresentation {
  if (error instanceof WindowsStartupIntegrityError) {
    return { kind: 'integrity', message: sanitizeStartupFailureMessage(error), handoff: false, retryable: false }
  }
  if (error instanceof ManagerStartLockError) {
    const hint = error.reason === 'busy'
      ? 'Another Kun window or terminal may still be starting or closing. Let it finish, or quit that client, then Recheck Kun.'
      : error.reason === 'io'
        ? 'Check that your Windows account can access the lock directory and that it is available. Recheck after correcting the access problem.'
        : 'Kun could not safely confirm the previous startup owner. Quit the other Kun client and Recheck, or share the startup log for diagnosis.'
    return {
      kind: 'start-lock',
      message: sanitizeStartupFailureMessage(`${hint}\n\n${error.message}\n\nRecheck preserves saved conversations and settings. It does not delete unknown ownership records or stop another live client.`),
      handoff: false, retryable: true, recheck: true
    }
  }
  if (error instanceof OrphanedAppSessionError) {
    return {
      kind: 'orphaned',
      message: sanitizeStartupFailureMessage(`${error.message}\n\nRecover Kun verifies the previous application has exited, stops its recorded leftover Runtime processes, then stops its data service. Processes whose ownership cannot be verified are left untouched. Saved conversations and settings are preserved.`),
      handoff: false, retryable: true, orphaned: true
    }
  }
  if (error instanceof ServiceManagerUnavailableError) {
    const leftover = error.kind === 'capability_incompatible' || error.kind === 'protocol_incompatible'
    const lines = leftover
      ? [
        `A leftover Kun data service from another build is still running${error.pid ? ` (pid ${error.pid})` : ''}.`,
        'This desktop cannot reuse that Service Manager.',
        'Recheck confirms the previous owner and Runtime slots are gone, then shuts the leftover down without deleting saved conversations.',
        'If another Kun window is still open, quit it first. Recheck will not stop a live owner or live Runtime work.',
        error.message,
        `Manager log: ${join(defaultKunControlDir(), 'manager.log')}`
      ]
      : [
        error.message,
        `Manager log: ${join(defaultKunControlDir(), 'manager.log')}`,
        'Recheck verifies ownership before recovery. If ownership cannot be verified, no process or saved data will be changed.'
      ]
    return {
      kind: leftover ? 'manager-leftover' : 'manager-unavailable',
      message: sanitizeStartupFailureMessage(lines.join('\n')),
      handoff: false, retryable: true, recheck: true
    }
  }
  if (!(error instanceof KunHandoffError)) {
    const sanitized = sanitizeStartupFailureMessage(error)
    const parsed = parseStartupRuntimeError(error)
    if (parsed.code === 'runtime_auth_required' || parsed.code === 'unauthorized') {
      return {
        kind: 'runtime-auth',
        message: 'The local Kun Runtime rejected the desktop access credential. Retry will stop only this desktop app\'s Runtime and start it again with the saved credential.',
        handoff: false,
        retryable: true
      }
    }
    if (parsed.code === 'client_runtime_owner_busy') {
      return {
        kind: 'client-busy',
        message: `${parsed.message || 'Another Kun client owns this Runtime.'}\nClose the other Kun GUI or TUI, then retry. Kun will not stop another client automatically because it may have active work.`,
        handoff: false,
        retryable: true
      }
    }
    return {
      kind: /\bexited before readiness\b/i.test(sanitized) ? 'manager-exited' : 'generic',
      message: sanitized,
      handoff: false,
      retryable: true
    }
  }
  const owner = error.owner
  const unverifiable = error.code === 'identity_unverifiable'
  const detail = [
    error.message,
    ...(unverifiable
      ? ['Kun failed closed and left the process, active work, and saved data untouched. Close the other Kun process or retry once the system process-inspection (WMI/CIM) is available.']
      : []),
    `Phase: ${error.phase}`,
    ...(owner?.kind ? [`Owner: ${owner.kind}${owner.flavor ? `/${owner.flavor}` : ''}`] : []),
    ...(owner?.pid ? [`PID: ${owner.pid}`] : []),
    ...(owner?.buildId ? [`Build: ${owner.buildId.slice(0, 12)}`] : [])
  ].join('\n')
  return {
    kind: 'handoff',
    message: sanitizeStartupFailureMessage(detail),
    handoff: true,
    retryable: error.retryable
  }
}

function parseStartupRuntimeError(error: unknown): { code: string; message: string } {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const directCode = typeof record.code === 'string' ? record.code : ''
  const rawMessage = typeof record.message === 'string' ? record.message : String(error)
  if (directCode) return { code: directCode, message: sanitizeStartupFailureMessage(rawMessage) }
  try {
    const parsed = JSON.parse(rawMessage) as { code?: unknown; message?: unknown }
    return {
      code: typeof parsed.code === 'string' ? parsed.code : '',
      message: typeof parsed.message === 'string' ? sanitizeStartupFailureMessage(parsed.message) : ''
    }
  } catch {
    return { code: '', message: '' }
  }
}

export function parseStartupFailureAction(targetUrl: string): StartupFailureAction | null {
  if (!targetUrl.startsWith(STARTUP_ACTION_PROTOCOL)) return null
  const action = targetUrl.slice(STARTUP_ACTION_PROTOCOL.length).replace(/^\/+/, '')
  return (STARTUP_FAILURE_ACTIONS as readonly string[]).includes(action)
    ? action as StartupFailureAction
    : null
}

export { startupFailureHtml } from './startup-failure-page'
