import { redactSecrets } from '../config/secret-redaction.js'
import type { TurnItem } from '../contracts/items.js'
import { truncateToWidth } from './ansi-text.js'
import { sanitizeTerminalText } from './safe-text.js'
import type { ThreadProjection } from './state.js'

export function plainLines(value: string, width: number, padding: number): string[] {
  const safe = sanitizeTerminalText(value || '')
  return safe.split('\n').map((line) => `${' '.repeat(padding)}${truncateToWidth(line, Math.max(1, width - padding))}`)
}

export function summarize(value: unknown): string {
  try {
    return truncateToWidth(JSON.stringify(redactSecrets(value)), 100)
  } catch {
    return String(value)
  }
}

export function outputText(value: unknown): string {
  if (typeof value === 'string') return sanitizeTerminalText(value)
  try { return sanitizeTerminalText(JSON.stringify(redactSecrets(value))) } catch { return sanitizeTerminalText(String(value)) }
}

export function elapsedDuration(
  start: string | undefined,
  end: string | undefined,
  live: boolean,
  nowMs = Date.now()
): string {
  if (!start) return live ? '0.0s' : ''
  if (!end && !live) return ''
  const startMs = Date.parse(start)
  const endMs = end ? Date.parse(end) : nowMs
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return ''
  return formatDurationMs(Math.max(0, endMs - startMs))
}

export function elapsedStartGapMs(earlier: string | undefined, later: string | undefined): number {
  if (!earlier || !later) return 0
  const earlierMs = Date.parse(earlier)
  const laterMs = Date.parse(later)
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) return 0
  return Math.max(0, laterMs - earlierMs)
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

export function formatGoalDuration(seconds: number): string {
  return formatDurationMs(Math.max(0, seconds) * 1_000)
}

export function itemDuration(item: TurnItem, live: boolean, inferredEnd?: string): string {
  return elapsedDuration(item.createdAt, item.finishedAt ?? inferredEnd, live)
}

export function resolveReasoningEndAt(
  item: Extract<TurnItem, { kind: 'assistant_reasoning' }>,
  items: readonly TurnItem[],
  projection: ThreadProjection | undefined
): string | undefined {
  if (item.finishedAt) return item.finishedAt

  const itemIndex = items.findIndex((candidate) => candidate.id === item.id)
  if (itemIndex >= 0) {
    const next = items.slice(itemIndex + 1).find((candidate) =>
      candidate.turnId === item.turnId && candidate.id !== item.id
    )
    if (next?.createdAt) return next.createdAt
  }

  const activity = projection?.activity
  if (activity?.turnId === item.turnId && activity.phase !== 'thinking') {
    return activity.startedAt
  }

  const turn = projection?.thread.turns.find((candidate) => candidate.id === item.turnId)
  if (turn?.finishedAt) return turn.finishedAt

  if (activity?.turnId === item.turnId) return activity.updatedAt
  return undefined
}

export function childIdFromToolResult(
  result: Extract<TurnItem, { kind: 'tool_result' }> | undefined
): string | undefined {
  if (!result || !result.output || typeof result.output !== 'object') return undefined
  const value = result.output as Record<string, unknown>
  return typeof value.childId === 'string' ? value.childId : undefined
}

export function humanizeToolName(name: string): string {
  const normalized = sanitizeTerminalText(name).replaceAll('_', ' ').trim()
  return normalized ? `${normalized[0]!.toUpperCase()}${normalized.slice(1)}` : 'Tool'
}
export function toolAction(item: Extract<TurnItem, { kind: 'tool_call' }>): { verb: string; subject: string } {
  const args = item.arguments
  const value = (...keys: string[]): string => {
    for (const key of keys) {
      const candidate = args[key]
      if (typeof candidate === 'string' && candidate.trim()) return oneLine(candidate)
    }
    return ''
  }
  const name = item.toolName.toLowerCase()
  if (['bash', 'exec', 'exec_command', 'shell'].some((entry) => name.includes(entry))) {
    return { verb: 'Run', subject: value('command', 'cmd') || item.summary || '' }
  }
  if (name.includes('read') || name.includes('view')) {
    return { verb: 'Read', subject: value('path', 'file_path', 'url') || item.summary || '' }
  }
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) {
    return { verb: 'Edit', subject: value('path', 'file_path') || item.summary || '' }
  }
  if (name.includes('search') || name.includes('grep') || name === 'rg' || name.includes('find')) {
    return { verb: 'Search', subject: value('query', 'pattern', 'path') || item.summary || '' }
  }
  if (name.includes('web') || name.includes('fetch') || name.includes('open_url')) {
    return { verb: 'Fetch', subject: value('url', 'query') || item.summary || '' }
  }
  if (name === 'delegate_task') {
    return { verb: 'Delegate', subject: value('label', 'prompt') || item.summary || '' }
  }
  if (name === 'fast_context' || name === 'explore_agent') {
    const count = Array.isArray(args.tasks) ? args.tasks.length : 0
    return {
      verb: 'Fast Context',
      subject: count > 0 ? `${count} task${count === 1 ? '' : 's'}` : item.summary || ''
    }
  }
  return { verb: humanizeToolName(item.toolName), subject: item.summary ?? summarize(args) }
}

export function sourcePageSuffix(output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ''
  const record = output as Record<string, unknown>
  const start = record.start_line
  const end = record.end_line
  const total = record.total_lines
  if (typeof start === 'number' && typeof end === 'number' && typeof total === 'number') {
    return ` (lines ${start}-${end}/${total}${record.has_more === true ? ', more' : ''})`
  }
  const matches = Array.isArray(record.matches) ? record.matches.length : undefined
  if (matches !== undefined) return ` (${matches} result${matches === 1 ? '' : 's'}${record.has_more === true ? ', more' : ''})`
  return ''
}

export function toolResultSummary(value: unknown): string {
  return conciseToolResultSummary(value) ?? outputText(value)
}

export function conciseToolResultSummary(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['summary', 'message', 'error', 'output', 'text']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  }
  return undefined
}

export function isModelConnectionError(item: Extract<TurnItem, { kind: 'error' }>): boolean {
  return item.code === 'http_401' || item.code === 'unauthorized' ||
    /\b401\b|invalid or expired credentials|no auth context|authentication|unauthori[sz]ed/iu.test(item.message)
}

export function friendlyRuntimeError(message: string): string {
  if (/\b401\b|invalid or expired credentials|no auth context|unauthori[sz]ed/iu.test(message)) {
    return 'The selected provider rejected its saved credentials (HTTP 401).'
  }
  if (/\b403\b|permission denied|forbidden/iu.test(message)) {
    return 'The selected provider refused this request (HTTP 403). Check the account permissions and model access.'
  }
  if (/\b429\b|rate.?limit/iu.test(message)) {
    return 'The selected provider is rate limited. Wait briefly or choose another model.'
  }
  return sanitizeTerminalText(message).slice(0, 800)
}

export function oneLine(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/gu, ' ').trim().slice(0, 160) || '(empty)'
}

/** Decode plain and Kitty printable input without treating escape sequences as text. */
