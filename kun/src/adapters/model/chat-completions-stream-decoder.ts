import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'
import {
  assertPendingToolCallsComplete,
  resolvePendingToolCall
} from './tool-call-stream-identity.js'

export type ChatCompletionsStreamDecodeResult = {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
}

export function decodeChatCompletionsStreamPayload(input: {
  payload: Record<string, unknown>
  pendingArguments: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  sawTextDelta: boolean
  budget: ModelStreamResourceBudget
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
}): ChatCompletionsStreamDecodeResult {
  const chunks: ModelStreamChunk[] = []
  let sawText = input.sawTextDelta
  let finishReason: string | null = null
  let usage: UsageSnapshot | null = null
  const choice = (input.payload.choices as Record<string, unknown>[] | undefined)?.[0]
  if (choice && typeof choice === 'object') {
    const delta = choice.delta as Record<string, unknown> | undefined
    if (delta && typeof delta === 'object') {
      const content = delta.content
      if (typeof content === 'string' && content.length > 0) {
        sawText = true
        chunks.push({ kind: 'assistant_text_delta', text: content })
      }
      const reasoning = delta.reasoning_content ?? delta.reasoning
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        chunks.push({ kind: 'assistant_reasoning_delta', text: reasoning })
      }
      const toolCalls = delta.tool_calls as Array<{
        index?: number
        id?: unknown
        function?: { name?: string; arguments?: string }
      }> | undefined
      for (const call of toolCalls ?? []) {
        const index = numericIndex(call.index)
        const { callId, pending } = resolvePendingToolCall({
          ...(call.id !== undefined ? { explicitId: call.id } : {}),
          ...(index !== undefined ? { index } : {}),
          pending: input.pendingArguments,
          pendingByIndex: input.pendingByIndex,
          budget: input.budget
        })
        if (call.function?.name) pending.name = call.function.name
        if (typeof call.function?.arguments === 'string') {
          input.budget.appendArguments(pending, call.function.arguments)
          chunks.push({
            kind: 'tool_call_delta',
            callId,
            toolName: pending.name,
            argumentsDelta: call.function.arguments
          })
        }
      }
    }
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
  }
  const usagePayload = input.payload.usage as Record<string, unknown> | undefined
  if (usagePayload) usage = input.normalizeUsage(usagePayload)
  if (finishReason === 'tool_calls' && input.pendingArguments.size > 0) {
    assertPendingToolCallsComplete(input.pendingArguments)
    for (const [callId, pending] of input.pendingArguments) {
      const toolName = pending.name!
      const raw = input.budget.pendingArguments(pending)
      input.budget.completeToolCall(raw)
      chunks.push({
        kind: 'tool_call_complete',
        callId,
        toolName,
        arguments: input.parseToolArguments(raw || '{}')
      })
    }
    input.budget.clearPendingCalls(input.pendingArguments)
    input.pendingByIndex.clear()
  }
  return { chunks, sawTextDelta: sawText, finishReason, usage }
}

function numericIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
