import type { StartupFailureKind } from './startup-failure-content'
import { startupFailureCopy, startupFailureLanguage } from './startup-failure-copy'

export const STARTUP_ACTION_PROTOCOL = 'kun-startup-action:'

const DETAILS_OPEN_KINDS = new Set<StartupFailureKind>(['generic', 'handoff', 'manager-exited', 'manager-unavailable'])

export type StartupFailureLogTail = { path: string; lines: string[] }

export type StartupFailurePageOptions = {
  kind?: StartupFailureKind
  handoff?: boolean
  retryable?: boolean
  busy?: boolean
  recheck?: boolean
  orphaned?: boolean
  appVersion?: string
  execPath?: string
  locale?: string
  notice?: { tone: 'error' | 'info'; text: string }
  // undefined: nothing to show; null: the referenced log file does not exist.
  logTail?: StartupFailureLogTail | null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function actionLink(action: string, label: string, className = 'button'): string {
  return `<a class="${className}" href="${STARTUP_ACTION_PROTOCOL}${action}">${escapeHtml(label)}</a>`
}

const WARNING_ICON = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`
const SHIELD_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`

const STYLES = `
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f0f2f5; --border: #e3e6eb;
      --text: #1b1f27; --muted: #5d6573; --faint: #8a919d;
      --accent: #3b82d8; --accent-text: #ffffff; --accent-soft: rgba(59, 130, 216, 0.12);
      --warn: #c77b12; --warn-soft: rgba(229, 154, 37, 0.14);
      --ok: #1f8a4c; --ok-soft: rgba(31, 138, 76, 0.1);
      --error: #c2412d; --error-soft: rgba(214, 72, 52, 0.1);
      --code: #2a303b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111318; --surface: #191c23; --surface-2: #20242d; --border: #2b303b;
        --text: #eef0f4; --muted: #a8afbc; --faint: #7a8291;
        --accent: #5a9be6; --accent-soft: rgba(90, 155, 230, 0.16);
        --warn: #f0a93b; --warn-soft: rgba(240, 169, 59, 0.14);
        --ok: #4cc27f; --ok-soft: rgba(76, 194, 127, 0.12);
        --error: #ff8a78; --error-soft: rgba(255, 138, 120, 0.1);
        --code: #d9dde5;
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.55; display: flex; flex-direction: column; }
    main { flex: 1; overflow-y: auto; padding: 36px 40px 24px; }
    .inner { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    .hero { display: flex; gap: 16px; align-items: flex-start; }
    .badge { flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--warn); background: var(--warn-soft); }
    h1 { margin: 2px 0 6px; font-size: 21px; line-height: 1.3; font-weight: 650; letter-spacing: -0.01em; }
    .summary { margin: 0; color: var(--muted); }
    .safe { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 3px 10px; border-radius: 999px; font-size: 12px; color: var(--ok); background: var(--ok-soft); }
    .notice { padding: 10px 14px; border-radius: 10px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .notice.error { color: var(--error); background: var(--error-soft); }
    .notice.info { color: var(--accent); background: var(--accent-soft); }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; }
    h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--muted); }
    ol { margin: 0; padding: 0; list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 10px; }
    ol li { counter-increment: step; display: flex; gap: 10px; }
    ol li::before { content: counter(step); flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-soft); }
    details > summary { cursor: default; font-size: 13px; font-weight: 600; color: var(--muted); list-style: none; display: flex; align-items: center; gap: 8px; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: ""; width: 6px; height: 6px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(-45deg); transition: transform 0.15s; }
    details[open] > summary::before { transform: rotate(45deg); }
    .field { margin-top: 14px; }
    .label { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12px; color: var(--faint); margin-bottom: 6px; }
    .label a { color: var(--accent); text-decoration: none; white-space: nowrap; }
    pre, .mono { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); color: var(--code); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow-y: auto; }
    pre.error { color: var(--error); }
    .mono { color: var(--muted); overflow-wrap: anywhere; }
    .empty { font-size: 12px; color: var(--faint); font-style: italic; }
    footer { flex: none; display: flex; align-items: center; gap: 8px; padding: 14px 40px; border-top: 1px solid var(--border); background: var(--surface); }
    .spacer { flex: 1; }
    .button { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13px; text-decoration: none; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); white-space: nowrap; }
    .button:hover { filter: brightness(0.97); }
    .button.ghost { background: transparent; border-color: transparent; color: var(--muted); }
    .button.primary { color: var(--accent-text); background: var(--accent); border-color: var(--accent); font-weight: 600; }
    .working { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13px; color: var(--accent); background: var(--accent-soft); }
    .spinner { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 640px) { main { padding: 24px 18px 16px; } footer { padding: 12px 18px; flex-wrap: wrap; } }
`

export function startupFailureHtml(
  message: string,
  logDir: string,
  options: StartupFailurePageOptions = {}
): string {
  const language = startupFailureLanguage(options.locale)
  const copy = startupFailureCopy(language)
  const handoff = options.handoff === true
  const busy = options.busy === true
  const retryable = options.retryable !== false
  const kind: StartupFailureKind = handoff ? 'handoff' : options.kind ?? 'generic'
  const kindCopy = copy.kinds[kind]
  const summary = kind === 'handoff'
    ? retryable ? copy.handoffSafe : copy.handoffUnverified
    : kindCopy.summary
  const steps = kind === 'handoff' && !retryable ? [copy.handoffUnverifiedStep] : kindCopy.steps
  const primaryLabel = options.orphaned ? copy.recover : options.recheck ? copy.recheck : handoff ? copy.handoffRetry : copy.retry
  const busyLabel = options.orphaned ? copy.busyRecover : options.recheck ? copy.busyRecheck : handoff ? copy.busyHandoff : copy.busyRetry
  const primaryAction = busy
    ? `<span class="working"><span class="spinner"></span>${escapeHtml(busyLabel)}</span>`
    : retryable ? actionLink('retry', primaryLabel, 'button primary') : ''
  const notice = busy
    ? { tone: 'info' as const, text: copy.busyHint }
    : options.notice
  const noticeHtml = notice
    ? `<div class="notice ${notice.tone}" role="status">${escapeHtml(notice.text)}</div>`
    : ''

  const logTail = options.logTail
  const logHtml = logTail === undefined
    ? ''
    : logTail === null
      ? `<div class="field"><div class="label"><span>${escapeHtml(copy.logLabel)}</span></div><div class="empty">${escapeHtml(copy.logMissing)}</div></div>`
      : `<div class="field"><div class="label"><span>${escapeHtml(copy.logLabel)} · <span class="mono">${escapeHtml(logTail.path)}</span></span>${actionLink('open-log-file', copy.openLogFile, '')}</div>${logTail.lines.length > 0
        ? `<pre>${escapeHtml(logTail.lines.join('\n'))}</pre>`
        : `<div class="empty">${escapeHtml(copy.logEmpty)}</div>`}</div>`
  const launchLines = [
    options.appVersion ? `${copy.versionLabel} ${options.appVersion}` : '',
    options.execPath ? `${copy.pathLabel} ${options.execPath}` : ''
  ].filter(Boolean)
  const launchHtml = launchLines.length === 0
    ? ''
    : `<div class="field"><div class="label"><span>${escapeHtml(copy.launchLabel)}</span></div><div class="mono">${launchLines.map(escapeHtml).join('<br>')}</div></div>`
  // Expand the detail where the error text or the service log is the evidence
  // the steps point at; the other kinds are fully explained by their steps.
  const detailsOpen = DETAILS_OPEN_KINDS.has(kind) ? ' open' : ''

  return `<!doctype html>
<html lang="${language === 'zh' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kun startup recovery</title>
  <style>${STYLES}</style>
</head>
<body>
  <main>
    <div class="inner">
      <header class="hero">
        <div class="badge">${WARNING_ICON}</div>
        <div>
          <h1>${escapeHtml(kindCopy.title)}</h1>
          ${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}
          <span class="safe">${SHIELD_ICON}${escapeHtml(copy.safeData)}</span>
        </div>
      </header>
      ${noticeHtml}
      <section class="card">
        <h2>${escapeHtml(copy.stepsHeading)}</h2>
        <ol>${steps.map((step) => `<li><span>${escapeHtml(step)}</span></li>`).join('')}</ol>
      </section>
      <details class="card"${detailsOpen}>
        <summary>${escapeHtml(copy.detailsHeading)}</summary>
        <div class="field">
          <div class="label"><span>${escapeHtml(copy.errorLabel)}</span></div>
          <pre class="error">${escapeHtml(message || 'Unknown startup error')}</pre>
        </div>
        ${logHtml}
        ${launchHtml}
        <div class="field">
          <div class="label"><span>${escapeHtml(copy.logDirLabel)}</span>${actionLink('open-logs', copy.openLogFolder, '')}</div>
          <div class="mono">${escapeHtml(logDir || 'Log directory is unavailable')}</div>
        </div>
      </details>
    </div>
  </main>
  <footer>
    ${actionLink('copy-diagnostics', copy.copyDiagnostics)}
    ${actionLink('open-logs', copy.openLogFolder, 'button ghost')}
    <span class="spacer"></span>
    ${actionLink('quit', copy.quit)}
    ${primaryAction}
  </footer>
</body>
</html>`
}
