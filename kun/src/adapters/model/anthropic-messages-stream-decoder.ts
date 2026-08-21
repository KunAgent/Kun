import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ToolCallProviderMetadata } from '../../contracts/items.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'
import { resolvePendingToolCall } from './tool-call-stream-identity.js'

type AnthropicThinkingBlock = NonNullable<
  NonNullable<ToolCallProviderMetadata['anthropic']>['thinkingBlocks']
>[number]

export type AnthropicThinkingState = {
  blocks: AnthropicThinkingBlock[]
  blockByIndex: Map<number, number>
  metadataAttached: boolean
  invalid: boolean
}

export function createAnthropicThinkingState(): AnthropicThinkingState {
  return { blocks: [], blockByIndex: new Map(), metadataAttached: false, invalid: false }
}

const MAX_ANTHROPIC_THINKING_BLOCKS = 16
const MAX_ANTHROPIC_THINKING_FIELD_CHARS = 262_144

export function decodeAnthropicMessagesStreamPayload(input: {
  payload: Record<string, unknown>
  pendingArguments: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  completedToolCalls: Set<string>
  thinkingState: AnthropicThinkingState
  sawTextDelta: boolean
  budget: ModelStreamResourceBudget
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
}): {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
} {
  const chunks: ModelStreamChunk[] = []
  let sawText = input.sawTextDelta
  let finishReason: string | null = null
  let usage: UsageSnapshot | null = null
  const type = recordString(input.payload, 'type')
  const index = numericIndex(input.payload.index)
  if (type === 'message_start') {
    const message = recordValue(input.payload, 'message')
    const usagePayload = message ? recordValue(message, 'usage') : null
    if (usagePayload) usage = input.normalizeUsage(usagePayload)
  } else if (type === 'content_block_start') {
    const block = recordValue(input.payload, 'content_block')
    const blockType = block ? recordString(block, 'type') : ''
    if (block && (blockType === 'thinking' || blockType === 'redacted_thinking')) {
      rememberThinkingBlock(input.thinkingState, index, block, blockType)
    } else if (block && blockType === 'tool_use') {
      const { pending } = resolvePendingToolCall({
        explicitId: recordString(block, 'id') || undefined,
        ...(index !== undefined ? { index } : {}),
        pending: input.pendingArguments,
        pendingByIndex: input.pendingByIndex,
        budget: input.budget
      })
      const name = recordString(block, 'name')
      if (name) pending.name = name
      const initial = recordValue(block, 'input')
      if (initial && Object.keys(initial).length) {
        input.budget.replaceArguments(pending, JSON.stringify(initial))
      }
    }
  } else if (type === 'content_block_delta') {
    const delta = recordValue(input.payload, 'delta')
    const deltaType = delta ? recordString(delta, 'type') : ''
    if (deltaType === 'text_delta') {
      const text = recordString(delta!, 'text')
      if (text) {
        sawText = true
        chunks.push({ kind: 'assistant_text_delta', text })
      }
    } else if (deltaType === 'thinking_delta') {
      const text = recordString(delta!, 'thinking')
      if (text) {
        appendThinkingDelta(input.thinkingState, index, text)
        chunks.push({ kind: 'assistant_reasoning_delta', text })
      }
    } else if (deltaType === 'signature_delta') {
      const signature = recordString(delta!, 'signature')
      if (signature) setThinkingSignature(input.thinkingState, index, signature)
    } else if (deltaType === 'input_json_delta') {
      const { callId, pending } = resolvePendingToolCall({
        ...(index !== undefined ? { index } : {}),
        pending: input.pendingArguments,
        pendingByIndex: input.pendingByIndex,
        budget: input.budget
      })
      const value = recordString(delta!, 'partial_json')
      if (index !== undefined) input.budget.bindPendingIndex(input.pendingByIndex, index, callId)
      if (value) {
        input.budget.appendArguments(pending, value)
        chunks.push({ kind: 'tool_call_delta', callId, toolName: pending.name, argumentsDelta: value })
      }
    }
  } else if (type === 'content_block_stop') {
    const callId = index === undefined
      ? (input.pendingArguments.size === 1 ? input.pendingArguments.keys().next().value as string : undefined)
      : input.pendingByIndex.get(index)
    const pending = callId ? input.pendingArguments.get(callId) : undefined
    if (callId && pending?.name) {
      const raw = input.budget.pendingArguments(pending)
      input.budget.completeToolCall(raw)
      chunks.push({
        kind: 'tool_call_complete', callId, toolName: pending.name,
        arguments: input.parseToolArguments(raw || '{}'),
        ...anthropicProviderMetadata(input.thinkingState)
      })
      input.completedToolCalls.add(callId)
      input.budget.removePendingCall(input.pendingArguments, callId)
      if (index !== undefined) input.pendingByIndex.delete(index)
    }
  } else if (type === 'message_delta') {
    const delta = recordValue(input.payload, 'delta')
    const stopReason = delta ? anthropicStopReason(recordString(delta, 'stop_reason')) : null
    if (stopReason) finishReason = stopReason
    const usagePayload = recordValue(input.payload, 'usage')
    if (usagePayload) usage = input.normalizeUsage(usagePayload)
  } else if (type === 'message_stop') {
    // `message_delta` carries the semantic reason. The outer stream merger
    // preserves it when this generic terminal frame arrives.
    finishReason = 'stop'
  } else if (type === 'error') {
    chunks.push({ kind: 'error', message: responseErrorMessage(input.payload), code: 'messages_stream_error' })
    finishReason = 'error'
  }
  return { chunks, sawTextDelta: sawText, finishReason, usage }
}

function rememberThinkingBlock(
  state: AnthropicThinkingState,
  index: number | undefined,
  block: Record<string, unknown>,
  blockType: 'thinking' | 'redacted_thinking'
): void {
  if (state.blocks.length >= MAX_ANTHROPIC_THINKING_BLOCKS) {
    state.invalid = true
    return
  }
  const next = blockType === 'thinking'
    ? {
        type: 'thinking' as const,
        thinking: recordString(block, 'thinking'),
        signature: recordString(block, 'signature')
      }
    : {
        type: 'redacted_thinking' as const,
        data: recordString(block, 'data')
      }
  if (
    (next.type === 'thinking' && (
      next.thinking.length > MAX_ANTHROPIC_THINKING_FIELD_CHARS ||
      next.signature.length > MAX_ANTHROPIC_THINKING_FIELD_CHARS
    )) ||
    (next.type === 'redacted_thinking' && next.data.length > MAX_ANTHROPIC_THINKING_FIELD_CHARS)
  ) {
    state.invalid = true
    return
  }
  state.blocks.push(next)
  if (index !== undefined) state.blockByIndex.set(index, state.blocks.length - 1)
}

function appendThinkingDelta(
  state: AnthropicThinkingState,
  index: number | undefined,
  text: string
): void {
  const block = thinkingBlockAt(state, index)
  if (block?.type === 'thinking') {
    if (block.thinking.length + text.length > MAX_ANTHROPIC_THINKING_FIELD_CHARS) {
      state.invalid = true
      return
    }
    block.thinking += text
  }
}

function setThinkingSignature(
  state: AnthropicThinkingState,
  index: number | undefined,
  signature: string
): void {
  const block = thinkingBlockAt(state, index)
  if (block?.type === 'thinking') {
    if (block.signature.length + signature.length > MAX_ANTHROPIC_THINKING_FIELD_CHARS) {
      state.invalid = true
      return
    }
    block.signature += signature
  }
}

function thinkingBlockAt(
  state: AnthropicThinkingState,
  index: number | undefined
): AnthropicThinkingBlock | undefined {
  if (index !== undefined) {
    const blockIndex = state.blockByIndex.get(index)
    if (blockIndex !== undefined) return state.blocks[blockIndex]
  }
  return state.blocks.at(-1)
}

function anthropicProviderMetadata(
  state: AnthropicThinkingState
): { providerMetadata?: ToolCallProviderMetadata } {
  if (state.invalid || state.metadataAttached || state.blocks.length === 0) return {}
  const complete = state.blocks.every((block) =>
    block.type === 'thinking' ? Boolean(block.signature) : Boolean(block.data)
  )
  if (!complete) return {}
  state.metadataAttached = true
  return {
    providerMetadata: {
      anthropic: {
        thinkingBlocks: state.blocks.map((block) => ({ ...block }))
      }
    }
  }
}

function anthropicStopReason(value: string): 'stop' | 'tool_calls' | 'length' | 'error' | null {
  if (value === 'tool_use') return 'tool_calls'
  if (value === 'max_tokens') return 'length'
  if (value === 'end_turn' || value === 'stop_sequence' || value === 'pause_turn') return 'stop'
  if (value === 'refusal') return 'error'
  return null
}

function responseErrorMessage(payload: Record<string, unknown>): string {
  const error = recordValue(payload, 'error')
  return (error ? recordString(error, 'message') : '') || recordString(payload, 'message') ||
    'model stream reported an error'
}

function recordString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numericIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
