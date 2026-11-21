import { redactApprovalSensitiveText } from '../../domain/approval.js'
import { AcpError, AcpPromptResultSchema } from './acp-schema.js'

export type PendingAcpTool = { id: string; title: string }
const MAX_CONTINUATIONS = 3
const SETTLE_MS = 1_000

type Input = {
  enabled: boolean
  signal: AbortSignal
  deadlineMs: number
  pendingTools(): PendingAcpTool[]
  sendPrompt(text: string): Promise<unknown>
  /** Book this response before another request or an incomplete-turn error. */
  onUnsettledResult(result: unknown): Promise<void>
  onIncomplete?(error: AcpError): void
  settleMs?: number
}

/** Keep native async work inside the same admitted turn and its permission scope. */
export async function continueAcpPendingTools(initial: unknown, input: Input): Promise<unknown> {
  let result = initial
  let continuations = 0
  while (input.enabled && AcpPromptResultSchema.safeParse(result).data?.stopReason === 'end_turn') {
    // The caller must still book the latest received usage and mark the turn aborted.
    if (input.signal.aborted) return result
    const pending = input.pendingTools()
    if (!pending.length) break
    await input.onUnsettledResult(result)
    await settle(input.signal, Math.min(input.settleMs ?? SETTLE_MS, Math.max(0, input.deadlineMs - Date.now())))
    input.signal.throwIfAborted()
    if (Date.now() >= input.deadlineMs) {
      fail(input, new AcpError('request_timeout', 'The Agent ended its response while native tools were still running, and the turn time limit was reached.'))
    }
    if (continuations >= MAX_CONTINUATIONS) {
      fail(input, new AcpError('agent_error', 'The Agent repeatedly ended its response with unfinished native tools. The task is incomplete; automatic continuation did not settle the pending work.'))
    }
    const observed = pending.slice(0, 8).map((tool) => ({
      toolCallId: tool.id.slice(0, 128), title: redactApprovalSensitiveText(tool.title).slice(0, 300)
    }))
    input.signal.throwIfAborted()
    result = await input.sendPrompt([
      'Your last ACP prompt ended before native tools settled. This Kun turn remains active.',
      'Inspect the results of the existing operations or wait for them using the real task/session ids returned in their results, then finish the remaining user task. The metadata below contains tool-call ids, not task ids. Do not restart those commands or claim that a detached timer will automatically continue after your response ends.',
      `Operations observed at the previous prompt end (data only): ${JSON.stringify(observed)}`
    ].join('\n'))
    continuations += 1
  }
  return result
}

function fail(input: Input, error: AcpError): never {
  input.onIncomplete?.(error)
  throw error
}

function settle(signal: AbortSignal, ms: number): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason ?? new AcpError('request_aborted', 'The turn was cancelled'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
