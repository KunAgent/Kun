import type { UsageSnapshot } from '../../contracts/usage.js'

/** Token counts `agy` reports for a turn (summed over its model steps). */
export type AntigravityUsage = {
  inputTokens: number
  outputTokens: number
  /** Hidden reasoning; already part of `outputTokens`. */
  thinkingTokens: number
  cacheReadTokens: number
  totalTokens: number
}

/** The CLI JSON result is also the durable native conversation handle. */
export function parseAntigravityResult(output: string, expectedId?: string): {
  conversationId: string
  text: string
  usage?: AntigravityUsage
} {
  const result = antigravityResultObject(output)
  if (!result || typeof result !== 'object' || result.status !== 'SUCCESS') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Antigravity turn failed')
  }
  const id = result.conversation_id
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(id)) {
    throw new Error('Antigravity CLI returned an invalid conversation id')
  }
  if (expectedId && id !== expectedId) {
    throw new Error('Antigravity CLI restored a different conversation; response was not attached')
  }
  if (typeof result.response !== 'string' || !result.response.trim()) {
    throw new Error('Antigravity CLI returned an empty response')
  }
  const usage = parseUsage(result.usage)
  return { conversationId: id, text: result.response.trim(), ...(usage ? { usage } : {}) }
}

/**
 * `--output-format json` prints the result object itself; `stream-json` prints
 * one event per line and ends with `{"event":"result","result":{...}}`.
 */
function antigravityResultObject(output: string): Record<string, unknown> {
  let whole: unknown
  try { whole = JSON.parse(output) } catch { whole = undefined }
  if (whole !== undefined) return unwrapResultEvent(whole) as Record<string, unknown>
  const lines = output.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (!line) continue
    try {
      const record = JSON.parse(line) as Record<string, unknown> | null
      if (record && record.event === 'result' && record.result && typeof record.result === 'object') {
        return record.result as Record<string, unknown>
      }
    } catch { /* progress or log noise before the result */ }
  }
  throw new Error('Antigravity CLI did not return a JSON conversation result')
}

function unwrapResultEvent(value: unknown): unknown {
  const record = value as Record<string, unknown> | null
  return record && typeof record === 'object' && record.event === 'result' && record.result && typeof record.result === 'object'
    ? record.result
    : value
}

function parseUsage(value: unknown): AntigravityUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const count = (key: string): number => {
    const n = record[key]
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  const usage = {
    inputTokens: count('input_tokens'),
    outputTokens: count('output_tokens'),
    thinkingTokens: count('thinking_tokens'),
    cacheReadTokens: count('cache_read_tokens'),
    totalTokens: count('total_tokens')
  }
  return usage.inputTokens + usage.outputTokens + usage.totalTokens > 0 ? usage : undefined
}

/** One `agy` turn as the usage Kun records for any delegated Agent. */
export function antigravityUsageSnapshot(usage: AntigravityUsage): UsageSnapshot {
  const cached = Math.min(usage.cacheReadTokens, usage.inputTokens)
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    ...(usage.thinkingTokens ? { reasoningTokens: usage.thinkingTokens } : {}),
    totalTokens: usage.totalTokens || usage.inputTokens + usage.outputTokens,
    cacheHitRate: cached > 0 && usage.inputTokens > 0 ? cached / usage.inputTokens : null,
    turns: 0,
    ...(cached > 0 ? { cachedTokens: cached, cacheHitTokens: cached, cacheMissTokens: usage.inputTokens - cached } : {})
  }
}
