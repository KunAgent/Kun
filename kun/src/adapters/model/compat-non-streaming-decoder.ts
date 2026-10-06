import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ToolCallProviderMetadata } from '../../contracts/items.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'

type ModelStopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']

export type CompatNonStreamingDecoderDeps = {
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
  payloadError: (payload: Record<string, unknown>) => { message: string; code?: string } | null
}

/** Decodes one complete endpoint-family response into the public stream contract. */
export function decodeCompatNonStreamingResponse(
  payload: Record<string, unknown>,
  endpointFormat: ModelEndpointFormat,
  deps: CompatNonStreamingDecoderDeps
): ModelStreamChunk[] {
  const payloadError = deps.payloadError(payload)
  if (payloadError) {
    return [{
      kind: 'error',
      message: payloadError.message,
      ...(payloadError.code ? { code: payloadError.code } : {})
    }]
  }
  if (endpointFormat === 'responses') return decodeResponses(payload, deps)
  if (endpointFormat === 'messages') return decodeAnthropicMessages(payload, deps)
  return decodeChatCompletions(payload, deps)
}

function decodeChatCompletions(
  payload: Record<string, unknown>,
  deps: CompatNonStreamingDecoderDeps
): ModelStreamChunk[] {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const choice = recordValue(choices[0])
  if (!choice) return [{ kind: 'error', message: 'model response contained no choices' }]
  const message = recordValue(choice, 'message')
  const chunks: ModelStreamChunk[] = []
  const reasoning = message
    ? recordString(message, 'reasoning_content') || recordString(message, 'reasoning')
    : ''
  const text = message ? recordString(message, 'content') : recordString(choice, 'text')
  if (reasoning) chunks.push({ kind: 'assistant_reasoning_delta', text: reasoning })
  if (text) chunks.push({ kind: 'assistant_text_delta', text })
  const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : []
  for (const value of toolCalls) {
    const call = recordValue(value)
    const fn = call ? recordValue(call, 'function') : null
    if (!call || !fn) continue
    chunks.push({
      kind: 'tool_call_complete',
      callId: recordString(call, 'id'),
      toolName: recordString(fn, 'name'),
      arguments: deps.parseToolArguments(recordString(fn, 'arguments') || '{}')
    })
  }
  const usage = recordValue(payload, 'usage')
  if (usage) chunks.push({ kind: 'usage', usage: deps.normalizeUsage(usage) })
  chunks.push({ kind: 'completed', stopReason: chatStopReason(recordString(choice, 'finish_reason')) })
  return chunks
}

function decodeResponses(
  payload: Record<string, unknown>,
  deps: CompatNonStreamingDecoderDeps
): ModelStreamChunk[] {
  const chunks: ModelStreamChunk[] = []
  const error = recordValue(payload, 'error')
  if (error && recordString(error, 'message')) {
    return [{ kind: 'error', message: recordString(error, 'message'), code: recordString(error, 'type') }]
  }
  const output = Array.isArray(payload.output) ? payload.output : []
  const outputText = recordString(payload, 'output_text') || responsesOutputText(output)
  if (outputText) chunks.push({ kind: 'assistant_text_delta', text: outputText })
  let sawToolCall = false
  for (const value of output) {
    const item = recordValue(value)
    if (!item) continue
    const itemType = recordString(item, 'type')
    if (itemType !== 'function_call' && itemType !== 'custom_tool_call') continue
    const callId = recordString(item, 'call_id') || recordString(item, 'id')
    const toolName = recordString(item, 'name')
    if (!callId || !toolName) continue
    sawToolCall = true
    chunks.push({
      kind: 'tool_call_complete',
      callId,
      toolName,
      arguments: deps.parseToolArguments(recordString(item, 'arguments') || recordString(item, 'input') || '{}')
    })
  }
  const usage = recordValue(payload, 'usage')
  if (usage) chunks.push({ kind: 'usage', usage: deps.normalizeUsage(usage) })
  chunks.push({ kind: 'completed', stopReason: responsesStopReason(payload, sawToolCall) })
  return chunks
}

function decodeAnthropicMessages(
  payload: Record<string, unknown>,
  deps: CompatNonStreamingDecoderDeps
): ModelStreamChunk[] {
  const chunks: ModelStreamChunk[] = []
  let sawToolCall = false
  let attachedThinkingMetadata = false
  const content = Array.isArray(payload.content) ? payload.content : []
  const thinkingBlocks = anthropicThinkingBlocks(content)
  for (const value of content) {
    const block = recordValue(value)
    if (!block) continue
    const type = recordString(block, 'type')
    if (type === 'text') {
      const text = recordString(block, 'text')
      if (text) chunks.push({ kind: 'assistant_text_delta', text })
    } else if (type === 'thinking') {
      const thinking = recordString(block, 'thinking')
      if (thinking) chunks.push({ kind: 'assistant_reasoning_delta', text: thinking })
    } else if (type === 'tool_use') {
      const callId = recordString(block, 'id')
      const toolName = recordString(block, 'name')
      if (!callId || !toolName) continue
      sawToolCall = true
      chunks.push({
        kind: 'tool_call_complete',
        callId,
        toolName,
        arguments: recordValue(block, 'input') ?? {},
        ...(!attachedThinkingMetadata && thinkingBlocks.length > 0
          ? {
              providerMetadata: {
                anthropic: { thinkingBlocks }
              } satisfies ToolCallProviderMetadata
            }
          : {})
      })
      attachedThinkingMetadata ||= thinkingBlocks.length > 0
    }
  }
  const usage = recordValue(payload, 'usage')
  if (usage) chunks.push({ kind: 'usage', usage: deps.normalizeUsage(usage) })
  chunks.push({
    kind: 'completed',
    stopReason: anthropicStopReason(payload.stop_reason) ?? (sawToolCall ? 'tool_calls' : 'stop')
  })
  return chunks
}

function anthropicThinkingBlocks(
  content: unknown[]
): NonNullable<NonNullable<ToolCallProviderMetadata['anthropic']>['thinkingBlocks']> {
  const blocks: NonNullable<NonNullable<ToolCallProviderMetadata['anthropic']>['thinkingBlocks']> = []
  for (const value of content) {
    const block = recordValue(value)
    if (!block) continue
    const type = recordString(block, 'type')
    if (type !== 'thinking' && type !== 'redacted_thinking') continue
    if (blocks.length >= 16) return []
    if (type === 'thinking') {
      const signature = recordString(block, 'signature')
      const thinking = recordString(block, 'thinking')
      if (!signature || thinking.length > 262_144 || signature.length > 262_144) return []
      blocks.push({
        type: 'thinking',
        thinking,
        signature
      })
    } else if (type === 'redacted_thinking') {
      const data = recordString(block, 'data')
      if (!data || data.length > 262_144) return []
      blocks.push({ type: 'redacted_thinking', data })
    }
  }
  return blocks
}

function chatStopReason(value: string): ModelStopReason {
  if (value === 'tool_calls') return 'tool_calls'
  if (value === 'length') return 'length'
  if (value === 'error') return 'error'
  return 'stop'
}

function responsesStopReason(payload: Record<string, unknown>, sawToolCall: boolean): ModelStopReason {
  const incomplete = recordValue(payload, 'incomplete_details')
  if (recordString(incomplete, 'reason') === 'max_output_tokens') return 'length'
  if (recordString(payload, 'status') === 'failed') return 'error'
  return sawToolCall ? 'tool_calls' : 'stop'
}

function responsesOutputText(output: unknown[]): string {
  const texts: string[] = []
  for (const value of output) {
    const item = recordValue(value)
    if (!item || recordString(item, 'type') !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const contentValue of content) {
      const block = recordValue(contentValue)
      const type = recordString(block, 'type')
      if (type === 'output_text' || type === 'text') {
        const text = recordString(block, 'text')
        if (text) texts.push(text)
      }
    }
  }
  return texts.join('')
}

function anthropicStopReason(value: unknown): ModelStopReason | undefined {
  if (value === 'tool_use') return 'tool_calls'
  if (value === 'max_tokens') return 'length'
  if (value === 'end_turn' || value === 'stop_sequence' || value === 'pause_turn') return 'stop'
  return undefined
}

function recordValue(value: unknown, key?: string): Record<string, unknown> | null {
  const candidate = key && value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : value
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null
}

function recordString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return ''
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate : ''
}
