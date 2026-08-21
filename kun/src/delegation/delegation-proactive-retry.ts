import type { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import type { ProactiveRetryStatus } from '../contracts/subagent-retry.js'
import {
  isResumableChildRun,
  type ChildRunRecord
} from './delegation-runtime-contracts.js'

export function proactiveRetryStatus(
  record: ChildRunRecord,
  policy: SubagentsCapabilityConfig['proactiveRetry']
): ProactiveRetryStatus {
  const count = record.proactiveRetryCount ?? 0
  const eligibleFailure = record.status === 'failed' &&
    (record.terminationReason === 'child_error' || record.terminationReason === 'runtime_restart') &&
    record.resumable === true &&
    hasResumableChildSnapshot(record)
  const remaining = Math.max(0, policy.maxAttempts - count)
  return {
    enabled: policy.enabled,
    eligible: policy.enabled && eligibleFailure && remaining > 0,
    count,
    limit: policy.maxAttempts,
    remaining
  }
}

export function hasResumableChildSnapshot(record: ChildRunRecord): boolean {
  return isResumableChildRun(record) && Boolean(
    record.profileSnapshot && record.security && record.workspace
  )
}

export function formatDetachedChildNotice(
  record: ChildRunRecord,
  retry?: ProactiveRetryStatus
): string {
  const label = record.label?.trim() || record.profile?.trim() || record.id
  const lines = [
    '<background_subagent_completed>',
    `<child_id>${escapeXml(record.id)}</child_id>`,
    `<label>${escapeXml(label)}</label>`,
    `<status>${record.status}</status>`
  ]
  if (record.terminationReason) {
    lines.push(`<termination_reason>${record.terminationReason}</termination_reason>`)
  }
  lines.push(`<resumable>${record.resumable === true}</resumable>`)
  if (record.failure) {
    lines.push('<failure>')
    lines.push(`<source>${record.failure.source}</source>`)
    if (record.failure.code) lines.push(`<code>${escapeXml(record.failure.code)}</code>`)
    if (record.failure.category) lines.push(`<category>${record.failure.category}</category>`)
    if (record.failure.httpStatus !== undefined) lines.push(`<http_status>${record.failure.httpStatus}</http_status>`)
    if (record.failure.retryAfterMs !== undefined) lines.push(`<retry_after_ms>${record.failure.retryAfterMs}</retry_after_ms>`)
    lines.push('</failure>')
  }
  if (retry) {
    lines.push(
      `<proactive_retry enabled="${retry.enabled}" eligible="${retry.eligible}" ` +
      `count="${retry.count}" limit="${retry.limit}" remaining="${retry.remaining}" />`
    )
  }
  if (record.summary?.trim()) {
    lines.push(`<summary>${escapeXml(record.summary.trim())}</summary>`)
  }
  if (record.resultRef) {
    lines.push(
      `<result_artifact id="${escapeXml(record.resultRef.artifactId)}" ` +
      `bytes="${record.resultRef.byteSize}" lines="${record.resultRef.lineCount}" ` +
      'mime_type="text/markdown">Use read_artifact with bounded ranges.</result_artifact>'
    )
  }
  if (record.resultUnavailableReason?.trim()) {
    lines.push(`<result_unavailable>${escapeXml(record.resultUnavailableReason.trim())}</result_unavailable>`)
  }
  if (record.error?.trim()) {
    lines.push(`<error>${escapeXml(record.error.trim())}</error>`)
  }
  lines.push('</background_subagent_completed>')
  return lines.join('\n')
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
