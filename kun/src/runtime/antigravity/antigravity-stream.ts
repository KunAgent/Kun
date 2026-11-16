/** What one line of `agy --print --output-format stream-json` means for a Kun turn. */
export type AntigravityStreamSignal =
  | { kind: 'prompt-accepted'; model?: string }
  | { kind: 'text'; text: string; inputTokens?: number }
  | { kind: 'response-usage'; inputTokens: number }
  | { kind: 'tool-started' }
  | { kind: 'tool-finished' }

function nonnegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined
}

function stepInputTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  // In `agy`, `step_update.usage.input_tokens` counts uncached prompt tokens
  // only (`total_tokens === input_tokens + output_tokens`), while cached prefix
  // tokens live in `cache_read_tokens`. Context occupancy is their sum.
  const uncached = nonnegativeInt(record.input_tokens)
  const cached = nonnegativeInt(record.cache_read_tokens)
  if (uncached === undefined && cached === undefined) return undefined
  return (uncached ?? 0) + (cached ?? 0)
}

/**
 * The CLI prints newline-delimited events: `init` once the conversation exists,
 * `step_update` per step (the user input, each model response with its streamed
 * `text_delta` pieces, each tool) and a final `result`. Only the signals Kun
 * acts on are returned; everything else, including malformed lines, is ignored.
 */
export function antigravityStreamSignal(line: string): AntigravityStreamSignal | undefined {
  let event: Record<string, unknown> | null
  try { event = JSON.parse(line) as Record<string, unknown> | null } catch { return undefined }
  if (!event || typeof event !== 'object') return undefined
  if (event.event === 'init') {
    const init = event.init as Record<string, unknown> | undefined
    const model = typeof init?.model === 'string' && init.model.trim() ? init.model.trim() : undefined
    return model ? { kind: 'prompt-accepted', model } : { kind: 'prompt-accepted' }
  }
  if (event.event !== 'step_update') return undefined
  const step = event.step_update as Record<string, unknown> | undefined
  if (!step || typeof step !== 'object') return undefined
  switch (step.step_type) {
    case 'user_input':
      return step.state === 'DONE' ? { kind: 'prompt-accepted' } : undefined
    case 'agent_response': {
      const inputTokens = stepInputTokens(step.usage)
      if (typeof step.text_delta === 'string' && step.text_delta) {
        return inputTokens !== undefined
          ? { kind: 'text', text: step.text_delta, inputTokens }
          : { kind: 'text', text: step.text_delta }
      }
      return inputTokens !== undefined ? { kind: 'response-usage', inputTokens } : undefined
    }
    case 'tool':
      return step.state === 'ACTIVE'
        ? { kind: 'tool-started' }
        : step.state === 'DONE' ? { kind: 'tool-finished' } : undefined
    default:
      return undefined
  }
}
