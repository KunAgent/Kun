import type { HarnessDiagnosticRow } from '../../../../../kun/src/contracts/harness-diagnostics'

/**
 * The plain-text report behind "Copy diagnostics" and "Ask Kun". It is meant
 * to be pasted into a chat or an issue, so it names variables but never
 * prints their values, and every field is written in English.
 */
export type AgentDiagnosticsReport = {
  name: string
  id: string
  version?: string
  transport: string
  connection: string
  platform: string
  checkedAt?: string
  command?: string
  args?: readonly string[]
  envNames?: readonly string[]
  rows?: readonly HarnessDiagnosticRow[]
  /** Fallback when the runtime sent no diagnostic rows. */
  checks?: ReadonlyArray<{ id: string; ok: boolean; detail?: string }>
  error?: string
  detail?: string
}

const LABEL: Record<string, string> = {
  configuration: 'Configuration', command: 'Command', version: 'Version', network: 'Network',
  credentials: 'Credentials', protocol: 'Session handshake', models: 'Models', installation: 'Installation'
}

const STATUS: Record<HarnessDiagnosticRow['status'], string> = { ok: 'ok', warn: 'warning', error: 'failed', info: 'info' }

export function agentDiagnosticsText(report: AgentDiagnosticsReport): string {
  const lines = [
    'Kun third-party Agent diagnostics',
    `Agent: ${report.name} (${report.id})`,
    ...(report.version ? [`Version: ${report.version}`] : []),
    `Transport: ${report.transport}`,
    `Connection: ${report.connection}`,
    `Platform: ${report.platform}`,
    ...(report.checkedAt ? [`Checked at: ${report.checkedAt}`] : []),
    ...(report.command ? [`Command: ${report.command}`] : []),
    ...(report.args?.length ? [`Arguments: ${report.args.join(' ')}`] : []),
    ...(report.envNames?.length ? [`Environment variables (names only): ${[...report.envNames].sort().join(', ')}`] : [])
  ]
  const rows = report.rows?.length
    ? report.rows.map((row) => `[${STATUS[row.status]}] ${LABEL[row.id] ?? row.id}: ${row.value}`)
    : (report.checks ?? []).map((check) => `[${check.ok ? 'ok' : 'failed'}] ${LABEL[check.id] ?? check.id}${check.detail ? `: ${check.detail}` : ''}`)
  if (rows.length) lines.push('', 'Checks:', ...rows)
  if (report.error) lines.push('', `Error: ${report.error}`)
  if (report.detail) lines.push(`Detail: ${report.detail}`)
  return lines.join('\n')
}
