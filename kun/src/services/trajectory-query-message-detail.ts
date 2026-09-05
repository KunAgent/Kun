import type { TurnItem } from '../contracts/items.js'
import type {
  TrajectoryMessageRecord,
  TrajectoryRawBlock,
  TrajectoryRequestRecord
} from '../contracts/trajectory.js'
import { redactSecrets } from '../config/secret-redaction.js'

const DETAIL_CONTENT_LIMIT = 16_384
const MAX_SANITIZE_DEPTH = 32

export type MessageDetailProjection = {
  state: 'available' | 'not_captured' | 'truncated' | 'evicted'
  content?: unknown
  truncated?: boolean
  warning?: string
}

export function projectMessageRawDetail(
  record: TrajectoryMessageRecord,
  items: readonly TurnItem[],
  requests: readonly TrajectoryRequestRecord[]
): MessageDetailProjection {
  const selected = rawItems(record, items, requests)
  if (!selected.length) return missingReference()
  const limited = limitBlocks(selected.flatMap(rawBlocksForItem))
  return {
    state: limited.truncated ? 'truncated' : 'available',
    content: { kind: 'blocks', blocks: limited.blocks },
    truncated: limited.truncated,
    ...(limited.truncated ? { warning: 'raw content exceeded the inline detail limit' } : {})
  }
}

export function projectMessageRenderedDetail(
  record: TrajectoryMessageRecord,
  items: readonly TurnItem[]
): MessageDetailProjection {
  const selected = referencedItems(record, items)
  if (!selected.length) return missingReference()
  const text = selected.flatMap(renderedTextForItem).filter(Boolean).join('\n\n')
  if (!text) return { state: 'not_captured', warning: 'rendered message content is unavailable' }
  const limited = boundedText(redactSecrets(text), DETAIL_CONTENT_LIMIT)
  return {
    state: limited.truncated ? 'truncated' : 'available',
    content: limited.value,
    truncated: limited.truncated,
    ...(limited.truncated ? { warning: 'rendered content exceeded the inline detail limit' } : {})
  }
}

export function projectMessageSourceDetail(
  record: TrajectoryMessageRecord,
  items: readonly TurnItem[]
): MessageDetailProjection {
  const selected = referencedItems(record, items)
  if (!selected.length) return missingReference()
  const source = sourceForItem(selected[0]!)
  if (!source) return { state: 'not_captured', warning: 'message source was not recorded' }
  return {
    state: 'available',
    content: { kind: 'message-source', label: source.label, value: source.value }
  }
}

function rawItems(
  record: TrajectoryMessageRecord,
  items: readonly TurnItem[],
  requests: readonly TrajectoryRequestRecord[]
): TurnItem[] {
  if (record.kind !== 'assistant' || !record.parentRequestId) {
    return referencedItems(record, items)
  }
  return items.filter((item) =>
    item.turnId === record.turnId &&
    (item.kind === 'assistant_reasoning' || item.kind === 'assistant_text' || item.kind === 'tool_call') &&
    latestRequestBefore(requests, item.turnId, item.createdAt)?.requestId === record.parentRequestId
  )
}

function referencedItems(record: TrajectoryMessageRecord, items: readonly TurnItem[]): TurnItem[] {
  const ids = new Set([record.itemId, ...record.itemIds])
  return items.filter((item) => ids.has(item.id))
}

function rawBlocksForItem(item: TurnItem): TrajectoryRawBlock[] {
  if (item.kind === 'user_message') {
    return [
      { type: 'text', content: sanitizeDetailValue(item.text), itemId: item.id },
      ...(item.attachmentIds ?? []).map((attachmentId) => ({
        type: 'attachment', attachmentId, itemId: item.id
      }))
    ]
  }
  if (item.kind === 'assistant_reasoning') {
    return [{ type: 'thinking', content: sanitizeDetailValue(item.text), itemId: item.id }]
  }
  if (item.kind === 'assistant_text') {
    return [{ type: 'text', content: sanitizeDetailValue(item.text), itemId: item.id }]
  }
  if (item.kind === 'tool_call') {
    return [{
      type: 'tool-call',
      content: sanitizeDetailValue(item.arguments),
      itemId: item.id,
      callId: item.callId,
      toolName: item.toolName
    }]
  }
  if (item.kind === 'model_context') {
    return [{ type: 'context', content: sanitizeDetailValue(item.text), itemId: item.id }]
  }
  if (item.kind === 'runtime_context_source') {
    return [{ type: 'context', content: sanitizeDetailValue(item.content), itemId: item.id }]
  }
  if (item.kind === 'compaction') {
    return [{ type: 'summary', content: sanitizeDetailValue(item.summary), itemId: item.id }]
  }
  return []
}

function renderedTextForItem(item: TurnItem): string[] {
  if (item.kind === 'user_message') return [item.displayText ?? item.text]
  if (item.kind === 'assistant_reasoning' || item.kind === 'assistant_text') return [item.text]
  if (item.kind === 'model_context') return [item.text]
  if (item.kind === 'runtime_context_source') return [item.content]
  if (item.kind === 'compaction') return [item.summary]
  return []
}

function sourceForItem(item: TurnItem): { label: string; value: unknown } | null {
  if (item.kind === 'user_message') {
    const kind = item.messageSource ?? 'user'
    return { label: humanize(kind), value: { kind } }
  }
  if (item.kind === 'model_context') {
    return {
      label: 'Model context',
      value: {
        kind: 'model_context',
        formatVersion: item.formatVersion,
        baseline: item.baseline === true,
        stepIndex: item.stepIndex,
        contentDigest: item.contentDigest,
        blocks: item.blocks.map(({ key, kind, authority, state, digest }) => ({
          key, kind, authority, state, ...(digest ? { digest } : {})
        }))
      }
    }
  }
  if (item.kind === 'runtime_context_source') {
    return {
      label: 'Runtime context',
      value: { kind: 'runtime_context', contextKind: item.contextKind }
    }
  }
  return null
}

function limitBlocks(blocks: TrajectoryRawBlock[]): {
  blocks: TrajectoryRawBlock[]
  truncated: boolean
} {
  let remaining = DETAIL_CONTENT_LIMIT
  let truncated = false
  const output: TrajectoryRawBlock[] = []
  for (const block of blocks) {
    if (block.content === undefined) {
      output.push(block)
      continue
    }
    if (remaining <= 0) {
      truncated = true
      continue
    }
    const encoded = contentText(block.content)
    const encodedBytes = Buffer.byteLength(encoded, 'utf8')
    if (encodedBytes <= remaining) {
      output.push(block)
      remaining -= encodedBytes
      continue
    }
    const limited = boundedText(encoded, remaining)
    output.push({ ...block, content: limited.value })
    remaining = 0
    truncated = true
  }
  return { blocks: output, truncated }
}

function sanitizeDetailValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[REDACTED: DEPTH LIMIT]'
  if (sensitiveKey(key) || key === 'providerMetadata') return '[REDACTED]'
  const redacted = redactSecrets(value)
  if (typeof redacted === 'string') {
    if (isInlineBinary(redacted) || looksLikeLargeBase64(redacted)) return '[BINARY OMITTED]'
    return redactSensitiveText(redacted)
  }
  if (Array.isArray(redacted)) {
    return redacted.map((entry) => sanitizeDetailValue(entry, key, depth + 1))
  }
  if (!isRecord(redacted)) return redacted
  return Object.fromEntries(Object.entries(redacted).map(([name, entry]) => [
    name,
    sanitizeDetailValue(entry, name, depth + 1)
  ]))
}

function boundedText(value: string, max: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= max) return { value, truncated: false }
  const marker = '… [truncated]'
  const contentBytes = Math.max(0, max - Buffer.byteLength(marker, 'utf8'))
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= contentBytes) low = middle
    else high = middle - 1
  }
  return { value: `${value.slice(0, low)}${marker}`, truncated: true }
}

function latestRequestBefore(
  requests: readonly TrajectoryRequestRecord[],
  turnId: string,
  timestamp: string
): TrajectoryRequestRecord | undefined {
  return requests
    .filter((request) => request.turnId === turnId && request.startedAt <= timestamp)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function humanize(value: string): string {
  return value.split('_').map((part) =>
    `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
  ).join(' ')
}

function sensitiveKey(value: string): boolean {
  return /authorization|(?:^|[_-])auth(?:entication)?(?:$|[_-])|api[_-]?key|access[_-]?key(?:[_-]?id)?|access[_-]?token|refresh[_-]?token|password|cookie|secret|private[_-]?key|credential|signature|aws[_-]?(?:session[_-]?token|access[_-]?key)/i.test(value)
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/data:[^;,\s]+;base64,[a-z0-9+/=_-]+/gi, '[BINARY OMITTED]')
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, '[BINARY OMITTED]')
    .replace(/\b(cookie|set-cookie|authorization|proxy-authorization)\s*:\s*[^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|api[_-]?key|access[_-]?key(?:[_-]?id)?|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|auth)\b\s*[:=]\s*["']?[^"'\s,;}]+["']?/gi, '$1=[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\b(?:sk|rk|api)[_-][A-Za-z0-9._-]{12,}\b/gi, '[REDACTED]')
}

function isInlineBinary(value: string): boolean {
  return /^data:[^;,]+;base64,/i.test(value)
}

function looksLikeLargeBase64(value: string): boolean {
  return value.length > 4_096 && value.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function missingReference(): MessageDetailProjection {
  return { state: 'evicted', warning: 'referenced Session content is unavailable' }
}
