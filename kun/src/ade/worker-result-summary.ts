import type { DispatchRecord } from '../contracts/ade.js'

const TRUNCATED = '\n[truncated]'

/** Keep the conclusion at the start of a report, and make omitted evidence explicit. */
export function clipWorkerResult(text: string, maxChars: number): string {
  const value = text.trim()
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - TRUNCATED.length).trimEnd()}${TRUNCATED}`
}

/** Bounded, worker-reported evidence shared by the wake-up notice and result card. */
export function workerResultSummary(dispatch: Pick<DispatchRecord,
  'state' | 'failureReason' | 'workerReport' | 'resultExcerpt'>): string | undefined {
  const report = dispatch.workerReport
  const summary = report?.summary.trim() || dispatch.resultExcerpt?.trim()
  const rows: string[] = []
  if (dispatch.state !== 'completed' && dispatch.failureReason?.trim()) {
    rows.push(clipWorkerResult(dispatch.failureReason, 500))
    if (summary) rows.push(`Last worker output: ${clipWorkerResult(summary, 1_400)}`)
  } else if (summary) {
    rows.push(clipWorkerResult(summary, 1_500))
  }
  if (report) {
    rows.push(`Worker-reported outcome: ${report.outcome}`)
    const checks = report.checks ?? []
    if (checks.length) {
      // Failures and unverified checks must not be crowded out by passing checks.
      const ordered = ['failed', 'skipped', 'passed'].flatMap((status) => checks.filter((check) => check.status === status))
      const counts = ['failed', 'skipped', 'passed'].map((status) => `${checks.filter((check) => check.status === status).length} ${status}`).join(', ')
      rows.push(`Worker-reported checks (${counts}):\n${clipWorkerResult(ordered.map((check) =>
        clipWorkerResult(`[${check.status}] ${check.name}${check.detail ? `: ${check.detail}` : ''}`, 240)).join('\n'), 1_200)}`)
    }
    if (report.risks?.length) rows.push(`Worker-reported risks:\n${clipWorkerResult(report.risks.join('\n'), 600)}`)
  }
  return rows.length ? clipWorkerResult(rows.join('\n\n'), 4_000) : undefined
}
