import type { TurnItem } from '../contracts/items.js'
import {
  IMAGE_TOOL_RESULT_TOKEN_ESTIMATE,
  isModelVisibleImageOutput
} from './tool-result-image.js'

export type RequestHistoryHygieneOptions = {
  maxToolResultLines?: number
  maxToolResultBytes?: number
  maxToolResultTokens?: number
  maxToolArgumentStringBytes?: number
  maxToolArgumentStringTokens?: number
  maxArrayItems?: number
  /**
   * Cumulative token budget for ALL tool results combined across the
   * sent history. Checkpoints sit at whole multiples of this budget:
   * while the raw cumulative total stays within one multiple, nothing
   * is collapsed; each time the total crosses the next multiple, one
   * batch of the oldest results is collapsed to a one-line digest in a
   * single step, so the model-facing projection is append-only between
   * checkpoint advances (prefix-cache friendly) while total context
   * growth stays bounded regardless of how many tool calls a long
   * session accumulates.
   */
  maxCumulativeToolResultTokens?: number
  /**
   * Number of most-recent tool results that are always kept at full
   * per-result fidelity, even if the cumulative budget is exhausted.
   */
  keepRecentToolResults?: number
}

export type RequestHistoryHygieneScope = {
  currentTurnId?: string
}

const DEFAULT_MAX_TOOL_RESULT_LINES = 320
const DEFAULT_MAX_TOOL_RESULT_BYTES = 32 * 1024
const DEFAULT_MAX_TOOL_RESULT_TOKENS = 8_000
const DEFAULT_MAX_TOOL_ARGUMENT_STRING_BYTES = 8 * 1024
const DEFAULT_MAX_TOOL_ARGUMENT_STRING_TOKENS = 2_000
const DEFAULT_MAX_ARRAY_ITEMS = 80
// 0 means "no cumulative cap" (back-compat). A positive value bounds the
// combined size of all tool results in the sent history.
const DEFAULT_MAX_CUMULATIVE_TOOL_RESULT_TOKENS = 0
const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 4
const MAX_SIGNAL_LINES = 48
const MAX_LINE_CHARS = 280
const LONG_ARGUMENT_PREVIEW_CHARS = 160
const ESC = String.fromCharCode(27)

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const SIGNAL_LINE_RE =
  /\b(error|failed?|fatal|panic|exception|traceback|warning|warn|denied|timeout|timed out|not found|cannot|invalid)\b/i
const BASE64_KEY_RE = /(?:^|_)(?:data_)?base64$/i
const DATA_URL_RE = /^data:[^;,]+;base64,/i
const FAILURE_SAFE_ARGUMENT_COMPACTION_TOOLS = new Set([
  'bash',
  'exec_command',
  'shell',
  'read',
  'grep',
  'rg',
  'find',
  'ls'
])
const ATOMIC_SOURCE_TOOL_NAMES = new Set(['read', 'grep', 'glob', 'find'])

type JsonRecord = Record<string, unknown>

type CompactResult<T> = {
  value: T
  changed: boolean
}

/**
 * Applies Reasonix-style send-time history hygiene without mutating the
 * persisted session log. This keeps dynamic tool history bounded so the
 * warmed immutable prefix accounts for a larger share of each request.
 */
export function applyRequestHistoryHygiene(
  items: TurnItem[],
  options: RequestHistoryHygieneOptions = {},
  scope: RequestHistoryHygieneScope = {}
): TurnItem[] {
  const limits = normalizeOptions(options)
  const failureSafeCallIds = new Set(
    items.flatMap((item) =>
      shouldCleanItem(item, scope) &&
      item.kind === 'tool_call' &&
      FAILURE_SAFE_ARGUMENT_COMPACTION_TOOLS.has(item.toolName)
        ? [item.callId]
        : [])
  )
  const compactableToolCallIds = new Set(
    items
      .flatMap((item) =>
        shouldCleanItem(item, scope) &&
        item.kind === 'tool_result' &&
        (item.isError !== true || failureSafeCallIds.has(item.callId))
          ? [item.callId]
          : []
      )
  )
  let changed = false
  const next = items.map((item) => {
    if (!shouldCleanItem(item, scope)) return item
    if (item.kind === 'tool_result') {
      // Forwarded screenshots/images must keep their base64 payload — the
      // model client turns it into a real image part. The agent loop has
      // already capped how many are kept inline.
      if (isModelVisibleImageOutput(item.output)) return item
      // Source tools construct a contiguous page to the execution budget. Do
      // not subsequently turn that page into a head/tail/signal-line collage;
      // the model must see exactly the persisted page and its metadata.
      if (isAtomicSourcePage(item.toolName, item.output)) return item
      const output = compactToolResultOutput(item.output, limits)
      if (!output.changed) return item
      changed = true
      return { ...item, output: output.value }
    }
    if (item.kind === 'tool_call' && compactableToolCallIds.has(item.callId)) {
      const args = compactCompletedToolArguments(item.arguments, {
        toolName: item.toolName,
        maxStringBytes: limits.maxToolArgumentStringBytes,
        maxStringTokens: limits.maxToolArgumentStringTokens,
        maxArrayItems: limits.maxArrayItems
      })
      if (!args.changed) return item
      changed = true
      return { ...item, arguments: args.value }
    }
    return item
  })
  const budgeted = applyCumulativeToolResultBudget(next, limits, scope)
  if (budgeted !== next) changed = true
  return changed ? budgeted : items
}

function shouldCleanItem(item: TurnItem, scope: RequestHistoryHygieneScope): boolean {
  return !scope.currentTurnId || item.turnId === scope.currentTurnId
}

function isAtomicSourcePage(toolName: string, output: unknown): boolean {
  if (!ATOMIC_SOURCE_TOOL_NAMES.has(toolName) || !isRecord(output)) return false
  if (toolName === 'read') {
    return typeof output.content === 'string' &&
      typeof output.start_line === 'number' &&
      typeof output.end_line === 'number' &&
      typeof output.total_lines === 'number'
  }
  return Array.isArray(output.matches) &&
    typeof output.has_more === 'boolean' &&
    (output.next_cursor === null || typeof output.next_cursor === 'string')
}

/**
 * Enforce a combined token budget across all tool results in the sent
 * history using cache-stable checkpoints. Raw cumulative prefix sums are
 * computed oldest -> newest over all in-scope tool results; checkpoint
 * boundaries sit at whole multiples of the high watermark. The active
 * boundary is the largest multiple strictly below the cumulative total,
 * so it is a step function of the persisted history alone: appending a
 * result cannot move the boundary — and therefore cannot change the
 * collapse set or any already-sent item — until the total crosses the
 * next multiple of the budget. Each crossing collapses one batch of the
 * oldest results (a single intentional prefix-cache reset) instead of
 * sliding the cutoff on every request. The most recent
 * `keepRecentToolResults` results and forwarded images are always kept
 * verbatim.
 */
function applyCumulativeToolResultBudget(
  items: TurnItem[],
  limits: Required<RequestHistoryHygieneOptions>,
  scope: RequestHistoryHygieneScope
): TurnItem[] {
  const highWatermark = limits.maxCumulativeToolResultTokens
  if (highWatermark <= 0) return items

  const toolResultIndexes: number[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) continue
    if (shouldCleanItem(item, scope) && item.kind === 'tool_result') toolResultIndexes.push(index)
  }
  if (toolResultIndexes.length === 0) return items

  // Forwarded images are never digested (that would drop the screenshot)
  // and are charged a flat vision-token cost rather than their base64
  // length, which would otherwise be hundreds of thousands of "tokens".
  type Entry = { index: number; cost: number; image: boolean }
  const entries: Entry[] = []
  let total = 0
  for (const index of toolResultIndexes) {
    const item = items[index]
    if (item.kind !== 'tool_result') continue
    const image = isModelVisibleImageOutput(item.output)
    const cost = image ? IMAGE_TOOL_RESULT_TOKEN_ESTIMATE : estimateTokens(stringifyOutput(item.output))
    total += cost
    entries.push({ index, cost, image })
  }
  if (entries.length === 0) return items

  // Cache-stable checkpoint stride in estimated tokens. The raw cumulative
  // total must exceed a whole multiple of the high watermark before any
  // collapse happens, and each further multiple crossed collapses one more
  // batch of the oldest results. The stride is derived, not configurable:
  // checkpoints sit exactly at k * maxCumulativeToolResultTokens.
  const stride = Math.max(1, highWatermark)
  // The active checkpoint boundary is the largest multiple of `stride`
  // strictly below the raw cumulative total. It depends only on the
  // persisted history: appending a result cannot move it until the total
  // crosses the next multiple, which is exactly the hysteresis that keeps
  // the projection append-only between checkpoint advances.
  const boundary = stride * Math.floor((total - 1) / stride)
  if (boundary <= 0) return items

  const alwaysKeep = new Set(toolResultIndexes.slice(-limits.keepRecentToolResults))
  const collapse = new Set<number>()
  let cumulative = 0
  for (const entry of entries) {
    cumulative += entry.cost
    if (cumulative > boundary) break
    if (alwaysKeep.has(entry.index) || entry.image) continue
    collapse.add(entry.index)
  }
  if (collapse.size === 0) return items

  return items.map((item, index) => {
    if (!collapse.has(index) || item.kind !== 'tool_result') return item
    return { ...item, output: digestStaleToolResult(item.toolName, item.isError, item.output) }
  })
}

function digestStaleToolResult(toolName: string, isError: boolean | undefined, output: unknown): string {
  if (ATOMIC_SOURCE_TOOL_NAMES.has(toolName) && isRecord(output)) {
    const path = typeof output.relative_path === 'string'
      ? output.relative_path
      : typeof output.path === 'string' ? output.path : 'source result'
    const range = typeof output.start_line === 'number'
      ? ` lines ${output.start_line}-${output.end_line ?? output.start_line}`
      : ''
    const continuation = typeof output.next_offset === 'number'
      ? ` continue with offset=${output.next_offset}`
      : typeof output.next_cursor === 'string' ? ' continue with the returned next_cursor' : ''
    return `[cache hygiene: older ${toolName}${isError ? ' (error)' : ''} page for ${path}${range} elided to bound context;${continuation || ' re-run the source query if needed.'}]`
  }
  const text = stringifyOutput(output)
  const tokens = estimateTokens(text)
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const preview = firstLine ? ` first line: ${clipInline(firstLine, 160)}` : ''
  return (
    `[cache hygiene: older ${toolName}${isError ? ' (error)' : ''} result elided to bound context, ` +
    `approx ${tokens} token(s); re-run the tool or use narrower read/grep/bash ranges if needed.]${preview}`
  )
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function clipInline(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}

function normalizeOptions(options: RequestHistoryHygieneOptions): Required<RequestHistoryHygieneOptions> {
  const normalizedHighWatermark = Math.max(
    0,
    Math.floor(options.maxCumulativeToolResultTokens ?? DEFAULT_MAX_CUMULATIVE_TOOL_RESULT_TOKENS)
  )
  return {
    maxToolResultLines: Math.max(1, Math.floor(options.maxToolResultLines ?? DEFAULT_MAX_TOOL_RESULT_LINES)),
    maxToolResultBytes: Math.max(512, Math.floor(options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES)),
    maxToolResultTokens: Math.max(128, Math.floor(options.maxToolResultTokens ?? DEFAULT_MAX_TOOL_RESULT_TOKENS)),
    maxToolArgumentStringBytes:
      Math.max(512, Math.floor(options.maxToolArgumentStringBytes ?? DEFAULT_MAX_TOOL_ARGUMENT_STRING_BYTES)),
    maxToolArgumentStringTokens:
      Math.max(128, Math.floor(options.maxToolArgumentStringTokens ?? DEFAULT_MAX_TOOL_ARGUMENT_STRING_TOKENS)),
    maxArrayItems: Math.max(1, Math.floor(options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS)),
    maxCumulativeToolResultTokens: normalizedHighWatermark,
    keepRecentToolResults: Math.max(
      0,
      Math.floor(options.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS)
    )
  }
}

function compactToolResultOutput(
  output: unknown,
  limits: Required<RequestHistoryHygieneOptions>
): CompactResult<unknown> {
  return compactToolResultValue(output, '', limits)
}

function compactToolResultValue(
  value: unknown,
  key: string,
  limits: Required<RequestHistoryHygieneOptions>
): CompactResult<unknown> {
  if (typeof value === 'string') {
    if (shouldOmitBase64(key, value)) {
      return {
        value: `[cache hygiene: omitted base64 data, ${formatBytes(Buffer.byteLength(value, 'utf8'))}]`,
        changed: true
      }
    }
    return compactToolResultText(value, limits)
  }
  if (Array.isArray(value)) {
    return compactArray(value, limits)
  }
  if (!isRecord(value)) return { value, changed: false }

  let changed = false
  const out: JsonRecord = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    const child = compactToolResultValue(childValue, childKey, limits)
    out[childKey] = child.value
    changed ||= child.changed
  }
  return changed ? { value: out, changed: true } : { value, changed: false }
}

function compactArray(
  values: unknown[],
  limits: Required<RequestHistoryHygieneOptions>
): CompactResult<unknown[]> {
  const keepHead = Math.max(1, Math.floor(limits.maxArrayItems * 0.75))
  const keepTail = Math.max(0, limits.maxArrayItems - keepHead)
  const tail = keepTail > 0 ? values.slice(values.length - keepTail) : []
  const selected = values.length > limits.maxArrayItems
    ? [
        ...values.slice(0, keepHead),
        { cache_hygiene_omitted_items: values.length - limits.maxArrayItems },
        ...tail
      ]
    : values
  let changed = selected !== values
  const out = selected.map((value) => {
    const compacted = compactToolResultValue(value, '', limits)
    changed ||= compacted.changed
    return compacted.value
  })
  return changed ? { value: out, changed: true } : { value: values, changed: false }
}

function compactToolResultText(
  text: string,
  limits: Required<RequestHistoryHygieneOptions>
): CompactResult<string> {
  const originalBytes = Buffer.byteLength(text, 'utf8')
  const originalLines = countLines(text)
  const originalTokens = estimateTokens(text)
  if (
    originalBytes <= limits.maxToolResultBytes &&
    originalLines <= limits.maxToolResultLines &&
    originalTokens <= limits.maxToolResultTokens
  ) {
    return { value: text, changed: false }
  }

  const normalized = normalizeTextBlock(text)
  const lines = normalized ? normalized.split('\n') : []
  const selected = selectCacheUsefulLines(lines, limits.maxToolResultLines)
  const omittedBytes = Math.max(0, originalBytes - Buffer.byteLength(selected.join('\n'), 'utf8'))
  const selectedTokens = estimateTokens(selected.join('\n'))
  const omittedTokens = Math.max(0, originalTokens - selectedTokens)
  const marker = [
    `[cache hygiene: omitted ${Math.max(0, lines.length - selected.length)} line(s), `,
    `${formatBytes(omittedBytes)}, approx ${omittedTokens} token(s); use narrower read/grep/bash ranges for details]`
  ].join('')
  const budgetForText = Math.max(0, limits.maxToolResultBytes - Buffer.byteLength(marker, 'utf8') - 1)
  const budgetForTokens = Math.max(0, limits.maxToolResultTokens - estimateTokens(marker) - 1)
  const fitted = fitLinesToBudget(selected.map(compactLine), {
    maxBytes: budgetForText,
    maxTokens: budgetForTokens
  })
  return {
    value: [...fitted, marker].join('\n'),
    changed: true
  }
}

function selectCacheUsefulLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const indexes = new Set<number>()
  const headCount = Math.min(80, Math.max(1, Math.floor(maxLines * 0.25)))
  const tailCount = Math.min(120, Math.max(1, Math.floor(maxLines * 0.35)))
  for (let index = 0; index < Math.min(headCount, lines.length); index += 1) {
    indexes.add(index)
  }
  for (let index = Math.max(0, lines.length - tailCount); index < lines.length; index += 1) {
    indexes.add(index)
  }
  let signalCount = 0
  for (let index = 0; index < lines.length && indexes.size < maxLines; index += 1) {
    if (!SIGNAL_LINE_RE.test(lines[index] ?? '')) continue
    indexes.add(index)
    signalCount += 1
    if (signalCount >= MAX_SIGNAL_LINES) break
  }
  return [...indexes]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map((index) => lines[index] ?? '')
}

function compactCompletedToolArguments(
  args: Record<string, unknown>,
  options: { toolName: string; maxStringBytes: number; maxStringTokens: number; maxArrayItems: number }
): CompactResult<Record<string, unknown>> {
  let changed = false
  const out: JsonRecord = {}
  for (const [key, value] of Object.entries(args)) {
    const compacted = compactArgumentValue(value, key, options)
    out[key] = compacted.value
    changed ||= compacted.changed
  }
  return changed ? { value: out, changed: true } : { value: args, changed: false }
}

function compactArgumentValue(
  value: unknown,
  key: string,
  options: { toolName: string; maxStringBytes: number; maxStringTokens: number; maxArrayItems: number }
): CompactResult<unknown> {
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8')
    const tokens = estimateTokens(value)
    if (bytes <= options.maxStringBytes && tokens <= options.maxStringTokens) return { value, changed: false }
    const preview = value.slice(0, LONG_ARGUMENT_PREVIEW_CHARS).replace(/\s+/g, ' ').trim()
    const suffix = preview ? ` preview=${JSON.stringify(preview)}` : ''
    return {
      value:
        `[cache hygiene: omitted completed ${options.toolName}.${key} argument, ` +
        `${formatBytes(bytes)}, approx ${tokens} token(s), ${countLines(value)} line(s); see following tool result]${suffix}`,
      changed: true
    }
  }
  if (Array.isArray(value)) {
    if (value.length <= options.maxArrayItems) {
      let changed = false
      const out = value.map((child) => {
        const compacted = compactArgumentValue(child, key, options)
        changed ||= compacted.changed
        return compacted.value
      })
      return changed ? { value: out, changed: true } : { value, changed: false }
    }
    return {
      value: [
        ...value.slice(0, Math.max(1, options.maxArrayItems - 1)),
        { cache_hygiene_omitted_items: value.length - options.maxArrayItems }
      ],
      changed: true
    }
  }
  if (!isRecord(value)) return { value, changed: false }
  let changed = false
  const out: JsonRecord = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    const compacted = compactArgumentValue(childValue, childKey, options)
    out[childKey] = compacted.value
    changed ||= compacted.changed
  }
  return changed ? { value: out, changed: true } : { value, changed: false }
}

function shouldOmitBase64(key: string, value: string): boolean {
  return value.length > 256 && (BASE64_KEY_RE.test(key) || DATA_URL_RE.test(value))
}

function normalizeTextBlock(text: string): string {
  const stripped = text.replace(/\r\n/g, '\n').replace(ANSI_RE, '')
  const lines = stripped.split('\n').map((line) => line.trimEnd())
  const out: string[] = []
  let blankRun = 0
  let previous = ''
  let repeatCount = 0
  const flushRepeat = () => {
    if (repeatCount > 1) out.push(`[previous line repeated ${repeatCount - 1} time(s)]`)
    repeatCount = 0
  }
  for (const line of lines) {
    if (!line.trim()) {
      flushRepeat()
      blankRun += 1
      if (blankRun <= 2) out.push('')
      previous = ''
      continue
    }
    blankRun = 0
    if (line === previous) {
      repeatCount += 1
      continue
    }
    flushRepeat()
    out.push(line)
    previous = line
    repeatCount = 1
  }
  flushRepeat()
  return out.join('\n').trim()
}

function fitLinesToBudget(lines: string[], budget: { maxBytes: number; maxTokens: number }): string[] {
  const out: string[] = []
  let bytes = 0
  let tokens = 0
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8') + (out.length > 0 ? 1 : 0)
    const lineTokens = estimateTokens(line) + (out.length > 0 ? 1 : 0)
    if (bytes + lineBytes > budget.maxBytes || tokens + lineTokens > budget.maxTokens) break
    out.push(line)
    bytes += lineBytes
    tokens += lineTokens
  }
  if (out.length === 0 && lines.length > 0 && budget.maxBytes > 0 && budget.maxTokens > 0) {
    out.push(truncateStringToBudget(lines[0] ?? '', budget))
  }
  return out
}

function compactLine(line: string): string {
  const trimmed = line.trimEnd()
  if (trimmed.length <= MAX_LINE_CHARS) return trimmed
  const head = Math.floor(MAX_LINE_CHARS * 0.6)
  const tail = Math.max(0, MAX_LINE_CHARS - head - 5)
  return `${trimmed.slice(0, head).trimEnd()} ... ${trimmed.slice(-tail).trimStart()}`
}

function truncateStringToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1
  }
  return buffer.subarray(0, end).toString('utf8')
}

function truncateStringToBudget(text: string, budget: { maxBytes: number; maxTokens: number }): string {
  let out = ''
  let bytes = 0
  let tokens = 0
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8')
    const charTokens = estimateTokens(char)
    if (bytes + charBytes > budget.maxBytes || tokens + charTokens > budget.maxTokens) break
    out += char
    bytes += charBytes
    tokens += charTokens
  }
  return out || truncateStringToBytes(text, budget.maxBytes)
}

function countLines(text: string): number {
  if (!text) return 0
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.length - 1 : lines.length
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  let asciiRun = 0
  let tokens = 0
  const flushAscii = () => {
    if (asciiRun > 0) {
      tokens += Math.ceil(asciiRun / 4)
      asciiRun = 0
    }
  }
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += 1
      continue
    }
    flushAscii()
    tokens += isCombiningMark(char) ? 0 : 1
  }
  flushAscii()
  return Math.max(1, tokens)
}

function isCombiningMark(char: string): boolean {
  return /[\u0300-\u036f\ufe00-\ufe0f]/u.test(char)
}
