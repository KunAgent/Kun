import type { TurnItem } from '../contracts/items.js'

/** Loop bookkeeping errors a completed Fast Context result can outrank. */
export const FAST_CONTEXT_RECOVERABLE_LOOP_ERROR_CODES = new Set([
  'model_empty_response',
  'empty_post_tool_continuation',
  'tool_loop_suppressed'
])

/** Whether result materialization had to fall back to tool/error text. */
export function childResultUsedNoTextSummary(
  items: readonly TurnItem[],
  turnId: string
): boolean {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const hasAssistantText = turnItems.some(
    (item) => item.kind === 'assistant_text' && item.text.trim().length > 0
  )
  if (hasAssistantText) return false
  return turnItems.some(
    (item) => item.kind === 'tool_result' || item.kind === 'error'
  )
}

export function childToolEvidence(items: readonly TurnItem[], turnId: string): string[] {
  const results = new Map(items
    .filter((item): item is Extract<TurnItem, { kind: 'tool_result' }> =>
      item.turnId === turnId && item.kind === 'tool_result')
    .map((item) => [item.callId, item]))
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'tool_call' }> =>
      item.turnId === turnId && item.kind === 'tool_call')
    .filter((item) => {
      const result = results.get(item.callId)
      return Boolean(result && !result.isError && result.status === 'completed')
    })
    .slice(0, 32)
    .map((item) => {
      const result = results.get(item.callId)!
      const target = toolEvidenceTarget(item.arguments)
      const digest = evidenceDigest(result.output)
      return `${item.toolName}${target ? ` ${target}` : ''}: completed${digest ? ` — ${digest}` : ''}`
    })
}

function evidenceDigest(output: unknown): string {
  const serialized = typeof output === 'string' ? output : safeJson(output)
  return serialized.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toolEvidenceTarget(args: Record<string, unknown>): string {
  for (const key of ['path', 'filePath', 'file_path', 'query', 'command']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300)
  }
  return ''
}
