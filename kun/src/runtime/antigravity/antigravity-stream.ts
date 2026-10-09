/** What one line of `agy --print --output-format stream-json` means for a Kun turn. */
export type AntigravityStreamSignal =
  | { kind: 'prompt-accepted' }
  | { kind: 'text'; text: string }
  | { kind: 'tool-started' }
  | { kind: 'tool-finished' }

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
  if (event.event === 'init') return { kind: 'prompt-accepted' }
  if (event.event !== 'step_update') return undefined
  const step = event.step_update as Record<string, unknown> | undefined
  if (!step || typeof step !== 'object') return undefined
  switch (step.step_type) {
    case 'user_input':
      return step.state === 'DONE' ? { kind: 'prompt-accepted' } : undefined
    case 'agent_response':
      return typeof step.text_delta === 'string' && step.text_delta
        ? { kind: 'text', text: step.text_delta }
        : undefined
    case 'tool':
      return step.state === 'ACTIVE'
        ? { kind: 'tool-started' }
        : step.state === 'DONE' ? { kind: 'tool-finished' } : undefined
    default:
      return undefined
  }
}
