import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelContextThresholds } from './model-context-profile.js'
import {
  PROMPT_TOKEN_TRUST_FACTOR,
  type CompactionMode
} from './context-compactor-types.js'

export function trimTrailingToolCalls(history: TurnItem[]): TurnItem[] {
  let end = history.length
  while (end > 0) {
    const item = history[end - 1]
    if (item.kind !== 'tool_call') break
    end -= 1
  }
  return end === history.length ? history : history.slice(0, end)
}

export function repairTailStartForToolResults(history: TurnItem[], start: number): number {
  let tailStart = Math.max(0, Math.min(history.length, start))
  while (tailStart > 0) {
    const orphanCallIds = orphanToolResultCallIds(history.slice(tailStart))
    if (orphanCallIds.length === 0) return tailStart

    const latestUserStart = findLatestUserMessageBefore(history, tailStart)
    if (latestUserStart > 0) return latestUserStart

    let expandedStart = tailStart
    for (const callId of orphanCallIds) {
      const callIndex = findMatchingToolCallBefore(history, callId, tailStart)
      if (callIndex < 0) {
        // The persisted history is already malformed. Leave it unchanged
        // instead of committing a compaction that would strand a result
        // behind the summary and silently drop it during model-history repair.
        return 0
      }
      expandedStart = Math.min(expandedStart, toolCallBatchStart(history, callIndex))
    }
    if (expandedStart >= tailStart) return 0
    tailStart = expandedStart
  }
  return tailStart
}

function findLatestUserMessageBefore(history: TurnItem[], before: number): number {
  for (let index = Math.min(before, history.length) - 1; index >= 0; index -= 1) {
    if (history[index].kind === 'user_message') return index
  }
  return -1
}

function orphanToolResultCallIds(items: TurnItem[]): string[] {
  const callIds = new Set<string>()
  for (const item of items) {
    if (item.kind === 'tool_call') callIds.add(item.callId)
  }
  return [...new Set(
    items
      .filter((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
      .filter((item) => !callIds.has(item.callId))
      .map((item) => item.callId)
  )]
}

function findMatchingToolCallBefore(history: TurnItem[], callId: string, before: number): number {
  for (let index = Math.min(before, history.length) - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind === 'tool_call' && item.callId === callId) return index
  }
  return -1
}

function toolCallBatchStart(history: TurnItem[], callIndex: number): number {
  const turnId = history[callIndex]?.turnId
  let start = callIndex
  while (
    start > 0 &&
    history[start - 1]?.kind === 'tool_call' &&
    history[start - 1]?.turnId === turnId
  ) {
    start -= 1
  }
  return start
}

export function aggressiveCompactionThreshold(thresholds: ModelContextThresholds): number {
  const span = Math.max(0, thresholds.hardThreshold - thresholds.softThreshold)
  return thresholds.softThreshold + Math.floor(span * 0.6)
}

const inflationWarnedAt = new Map<string, number>()
const INFLATION_WARN_INTERVAL_MS = 60_000
const MAX_INFLATION_WARNING_MODELS = 256

/**
 * Returns the provider `prompt_tokens` when it is consistent with our local
 * estimate, or `undefined` when it exceeds it by more than
 * `PROMPT_TOKEN_TRUST_FACTOR` (treated as a provider accounting artifact and
 * dropped so the estimate drives the decision instead).
 */
export function trustworthyPromptTokens(
  reported: number | undefined,
  estimate: number,
  model?: string
): number | undefined {
  if (reported === undefined) return undefined
  if (estimate > 0 && reported > estimate * PROMPT_TOKEN_TRUST_FACTOR) {
    warnInflatedPromptTokens(reported, estimate, model)
    return undefined
  }
  return reported
}

function warnInflatedPromptTokens(reported: number, estimate: number, model?: string): void {
  const key = model || 'unknown'
  const now = Date.now()
  if (now - (inflationWarnedAt.get(key) ?? 0) < INFLATION_WARN_INTERVAL_MS) return
  inflationWarnedAt.delete(key)
  inflationWarnedAt.set(key, now)
  if (inflationWarnedAt.size > MAX_INFLATION_WARNING_MODELS) {
    const oldest = inflationWarnedAt.keys().next().value
    if (oldest !== undefined) inflationWarnedAt.delete(oldest)
  }
  console.warn(
    `[kun] ignoring inflated prompt_tokens for model "${key}": reported ${reported} vs local estimate ${estimate} ` +
      `(>${PROMPT_TOKEN_TRUST_FACTOR}x). Falling back to the estimate for context/compaction; the provider is likely ` +
      `summing cumulative cache reads into prompt_tokens.`
  )
}

export function normalizeFrozenMessageCount(value: number | undefined, historyLength: number): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(historyLength, Math.floor(value)))
}

export function appendDigestMarker(summary: string, digestMarker: string): string {
  const trimmed = summary.trim()
  if (trimmed.includes(digestMarker)) return trimmed
  return `${trimmed}\n\nCompaction digest marker: ${digestMarker}`
}

export function buildCompactionSummary(input: {
  history: TurnItem[]
  head: TurnItem[]
  tail: TurnItem[]
  prefix: ImmutablePrefix
  skillPins?: readonly string[]
  reason?: string
  mode?: CompactionMode
  budgetTokens?: number
}): string {
  const contentBudget = summaryCharBudget(input.budgetTokens)
  const lines: string[] = []
  if (input.reason) {
    lines.push(`Reason: ${input.reason}`)
  }
  if (input.mode) {
    lines.push(`Mode: ${input.mode}`)
  }
  if (input.budgetTokens !== undefined) {
    lines.push(`Budget: ${input.budgetTokens} tokens`)
  }
  lines.push('Pinned constraints (preserved across compaction):')
  if (input.prefix.pinnedConstraints.length === 0) {
    lines.push('- (none)')
  } else {
    for (const pinned of input.prefix.pinnedConstraints) {
      lines.push(`- ${pinned}`)
    }
  }
  const skillPins = input.skillPins ?? extractSkillPins(input.history)
  if (skillPins.length > 0) {
    lines.push('Pinned skills (preserved across compaction):')
    for (const skillPin of skillPins) {
      lines.push(`- ${skillPin}`)
    }
    lines.push('')
  }
  lines.push('')
  lines.push(
    `Summarized ${input.history.length} item(s); ${input.tail.length} recent item(s) are also kept verbatim for the current request.`
  )
  // The previous canonical summary is carried forward as its own section
  // rather than being re-summarized as an "Earlier compaction" transcript
  // line. Re-summarizing the old summary nested state inside state and made
  // consecutive compactions grow instead of shrink.
  const previousSummary = latestCompactionSummary(input.history)
  const outlineSource = input.history.filter((item) => item.kind !== 'compaction')
  if (previousSummary) {
    lines.push('Carried-forward conversation state (rewritten, not nested):')
    const carried = fitLinesToBudget(
      previousSummary
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .filter((line) => !/^Compaction digest marker:/.test(line.trim())),
      Math.floor(contentBudget * 0.45)
    )
    lines.push(...carried)
    lines.push('')
  }
  const durableOutlineLines = fitLinesToBudget(
    extractDurableOutlineLines(outlineSource),
    Math.floor(contentBudget * (previousSummary ? 0.3 : 0.75))
  )
  if (durableOutlineLines.length > 0) {
    lines.push('Durable outline and open items:')
    lines.push(...durableOutlineLines)
    lines.push('')
  }
  lines.push('Conversation and work summary:')
  const usedBudget = lines.join('\n').length
  const remainingBudget = Math.max(1_200, contentBudget - usedBudget)
  const summaryLines = fitLinesToBudget(
    selectSummaryLines(outlineSource.map(summarizeItem).filter((line) => line.length > 0)),
    remainingBudget
  )
  if (summaryLines.length === 0 && !previousSummary) {
    lines.push('- No user-visible content before compaction.')
  } else {
    lines.push(...summaryLines)
  }
  return lines.join('\n')
}

function latestCompactionSummary(history: readonly TurnItem[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind === 'compaction' && item.replacedTokens > 0) return item.summary
  }
  return null
}

export function extractSkillPins(history: readonly TurnItem[]): string[] {
  const pins = new Set<string>()
  for (const item of history) {
    if (item.kind !== 'assistant_text' && item.kind !== 'user_message' && item.kind !== 'compaction') continue
    const text = item.kind === 'compaction' ? item.summary : item.text
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (/^(Active Skill:|Skill Pin:|Pinned Skill:)/i.test(trimmed)) {
        pins.add(clipText(trimmed, 600))
      }
    }
  }
  return [...pins]
}

function summaryCharBudget(budgetTokens: number | undefined): number {
  if (budgetTokens === undefined) return 12_000
  return Math.max(1_200, Math.min(24_000, budgetTokens * 4))
}

function extractDurableOutlineLines(history: TurnItem[]): string[] {
  const lines: string[] = []
  for (const item of history) {
    switch (item.kind) {
      case 'user_message':
        lines.push(...durableTextLines('User request', item.text, { fallback: true }))
        break
      case 'goal_context':
      case 'model_context':
      case 'runtime_context_source':
      case 'interruption_note':
        break
      case 'assistant_text':
        lines.push(...durableTextLines('Assistant finding', item.text))
        break
      case 'compaction':
        if (item.replacedTokens > 0) {
          lines.push(...durableTextLines('Earlier compaction', item.summary))
        }
        break
      case 'tool_call': {
        const text = item.summary || stringifyCompact(item.arguments)
        if (isDurableTextLine(text)) {
          lines.push(`- Tool call ${item.toolName}: ${clipText(text, 520)}`)
        }
        break
      }
      case 'tool_result': {
        const text = stringifyCompact(item.output)
        if (item.isError || isDurableTextLine(text)) {
          lines.push(`- Tool result ${item.toolName}${item.isError ? ' error' : ''}: ${clipText(text, 520)}`)
        }
        break
      }
      case 'approval':
        if (item.status !== 'allowed') {
          lines.push(`- Approval ${item.status} for ${item.toolName}: ${clipText(item.summary, 520)}`)
        }
        break
      case 'user_input':
        lines.push(`- User input ${item.status}: ${clipText(item.prompt, 520)}`)
        break
      case 'review':
        lines.push(...durableTextLines('Review', item.reviewText || stringifyCompact(item.output)))
        break
      case 'error':
        lines.push(`- Error${item.code ? ` ${item.code}` : ''}: ${clipText(item.message, 520)}`)
        break
      case 'assistant_reasoning':
        break
    }
  }
  return dedupeLines(lines)
}

function durableTextLines(
  label: string,
  text: string,
  options?: { fallback?: boolean }
): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const selected = rawLines.filter(isDurableTextLine)
  if (selected.length === 0 && options?.fallback) {
    const clipped = clipText(text, 520)
    return clipped ? [`- ${label}: ${clipped}`] : []
  }
  return selected.map((line) => `- ${label}: ${clipText(line, 520)}`)
}

const DURABLE_OUTLINE_LINE =
  /^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX-]\]\s*)?|\d{1,4}[.)]\s+|[A-Za-z][.)]\s+|(?:problems?|issues?|tasks?|todos?|bugs?|fixes?|steps?)\s*#?\d{0,4}\b)/i
const DURABLE_KEYWORD_LINE =
  /\b(?:issue|bug|problem|task|todo|open|done|next|remaining|scope|constraint|requirement|decision|root cause|fix|blocked|error|exception|failed|failing|command|test|file|path|must|need|expected|actual)\b/i
const DURABLE_IDENTIFIER_LINE =
  /(?:https?:\/\/|#[0-9]+\b|`[^`]+`|(?:^|[ ./])[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|c|cpp|h|hpp|css|scss|html|yml|yaml)\b|\/[\w./-]+)/

function isDurableTextLine(text: string): boolean {
  const line = text.trim()
  if (!line) return false
  if (DURABLE_OUTLINE_LINE.test(line)) return true
  if (DURABLE_KEYWORD_LINE.test(line)) return true
  return DURABLE_IDENTIFIER_LINE.test(line)
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const key = line.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

function summarizeItem(item: TurnItem): string {
  switch (item.kind) {
    case 'user_message':
      return `- User: ${clipText(item.text)}`
    case 'goal_context':
    case 'model_context':
    case 'runtime_context_source':
    case 'interruption_note':
      return ''
    case 'assistant_text':
      return `- Assistant: ${clipText(item.text)}`
    case 'assistant_reasoning':
      return ''
    case 'tool_call':
      return `- Tool call ${item.toolName}: ${clipText(item.summary || stringifyCompact(item.arguments))}`
    case 'tool_result':
      return `- Tool result ${item.toolName}${item.isError ? ' error' : ''}: ${clipText(stringifyCompact(item.output))}`
    case 'approval':
      return `- Approval ${item.status} for ${item.toolName}: ${clipText(item.summary)}`
    case 'user_input':
      return `- User input ${item.status}: ${clipText(item.prompt)}`
    case 'compaction':
      return item.replacedTokens > 0
        ? `- Earlier compaction summary: ${clipText(item.summary, 600)}`
        : ''
    case 'review':
      return `- Review ${item.title}: ${clipText(item.reviewText || stringifyCompact(item.output))}`
    case 'error':
      return `- Error${item.code ? ` ${item.code}` : ''}: ${clipText(item.message)}`
  }
}

function selectSummaryLines(lines: string[]): string[] {
  if (lines.length <= 40) return lines
  const start = lines.slice(0, 6)
  const end = lines.slice(-18)
  const middle = lines.slice(start.length, lines.length - end.length)
  const criticalMiddle = middle.filter(isCriticalSummaryLine)
  const selected = dedupeLines([...start, ...criticalMiddle, ...end])
  const omitted = lines.length - selected.length
  if (omitted > 0) {
    selected.splice(
      Math.min(start.length + criticalMiddle.length, selected.length),
      0,
      `- ${omitted} lower-priority transcript line(s) omitted after preserving detected user requests, task lists, errors, paths, and decisions.`
    )
  }
  return selected
}

function isCriticalSummaryLine(line: string): boolean {
  if (/^- User:/.test(line)) return true
  if (/\b(?:error|failed|failing|exception|denied|cancelled)\b/i.test(line)) return true
  const content = line.replace(/^- [^:]+:\s*/, '')
  return isDurableTextLine(content)
}

function fitLinesToBudget(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const nextCost = line.length + 1
    if (used + nextCost <= budget) {
      out.push(line)
      used += nextCost
      continue
    }
    const remaining = budget - used
    if (remaining > 80) out.push(clipText(line, remaining))
    break
  }
  return out
}

function stringifyCompact(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clipText(text: string, max = 360): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

/**
 * Normalizes optional token budget inputs so missing, negative, or
 * non-finite values never poison the compaction math. Returns 0 for
 * anything that is not a finite non-negative number, which keeps legacy
 * callers (that omit these fields entirely) on the old behavior.
 */
export function finiteNonNegative(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
