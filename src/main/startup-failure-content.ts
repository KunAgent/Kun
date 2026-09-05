import { KunHandoffError } from './runtime/kun-installed-build-handoff'

const STARTUP_ACTION_PROTOCOL = 'kun-startup-action:'
const MAX_FAILURE_MESSAGE_LENGTH = 1_200

export type StartupFailureAction = 'retry' | 'open-logs' | 'quit'
export type StartupFailurePresentation = {
  message: string
  handoff: boolean
  retryable: boolean
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
  if (!(error instanceof KunHandoffError)) {
    const sanitized = sanitizeStartupFailureMessage(error)
    const parsed = parseStartupRuntimeError(error)
    if (parsed.code === 'runtime_auth_required' || parsed.code === 'unauthorized') {
      return {
        message: 'The local Kun Runtime rejected the desktop access credential. Retry will stop only this desktop app\'s Runtime and start it again with the saved credential.',
        handoff: false,
        retryable: true
      }
    }
    if (parsed.code === 'client_runtime_owner_busy') {
      return {
        message: `${parsed.message || 'Another Kun client owns this Runtime.'}\nClose the other Kun GUI or TUI, then retry. Kun will not stop another client automatically because it may have active work.`,
        handoff: false,
        retryable: true
      }
    }
    return {
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
  return action === 'retry' || action === 'open-logs' || action === 'quit'
    ? action
    : null
}

export function startupFailureHtml(
  message: string,
  logDir: string,
  options: { handoff?: boolean; retryable?: boolean; busy?: boolean } = {}
): string {
  const safeMessage = escapeHtml(message || 'Unknown startup error')
  const safeLogDir = escapeHtml(logDir || 'Log directory is unavailable')
  const handoff = options.handoff === true
  const busy = options.busy === true
  const retryable = options.retryable !== false
  const heading = handoff ? 'Kun could not complete the update handoff' : 'Kun could not finish starting'
  const explanation = handoff
    ? retryable
      ? 'Kun identified the previous local owner. It will pause and checkpoint active work before retrying the safe handoff, without deleting your saved conversations.'
      : 'Kun could not safely verify the previous local owner, so it left the process, active work, and saved data untouched.'
    : 'The application is still running so you can inspect the failure or retry. The diagnostic detail is:'
  const primaryAction = busy
    ? `<span class="working">${handoff ? 'Safely stopping old Kun…' : 'Stopping this desktop Runtime safely…'}</span>`
    : retryable
      ? `<a class="primary" href="${STARTUP_ACTION_PROTOCOL}retry">${handoff ? 'Safely stop old Kun and retry' : 'Retry Kun'}</a>`
      : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kun startup recovery</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #f3f4f6; }
    main { max-width: 680px; margin: 0 auto; padding: 44px 40px; }
    h1 { margin: 0 0 14px; font-size: 27px; }
    p { color: #c5c9d3; line-height: 1.55; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px; border-radius: 10px; background: #1c2028; color: #ffcfcc; }
    .path { color: #aeb6c5; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
    a { padding: 10px 16px; border-radius: 8px; color: #f8fafc; background: #303746; text-decoration: none; }
    a.primary { background: #5b5ce2; }
    .working { padding: 10px 16px; border-radius: 8px; color: #d7d9ff; background: #34355f; }
  </style>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <p>${explanation}</p>
    <pre>${safeMessage}</pre>
    <p>Log directory:</p>
    <div class="path">${safeLogDir}</div>
    <div class="actions">
      ${primaryAction}
      <a href="${STARTUP_ACTION_PROTOCOL}open-logs">Open log folder</a>
      <a href="${STARTUP_ACTION_PROTOCOL}quit">Quit</a>
    </div>
  </main>
</body>
</html>`
}
