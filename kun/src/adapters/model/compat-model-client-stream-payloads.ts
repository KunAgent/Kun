import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { PendingToolCall } from './model-stream-resource-budget.js'
import type { ModelStreamLimits, ModelStreamResourceBudget } from './model-stream-resource-budget.js'
import { decodeChatCompletionsStreamPayload } from './chat-completions-stream-decoder.js'
import {
  type ResponsesContentTracker,
  decodeResponsesStreamPayload
} from './responses-stream-decoder.js'
import {
  type AnthropicThinkingState,
  decodeAnthropicMessagesStreamPayload
} from './anthropic-messages-stream-decoder.js'
import { decodeCompatNonStreamingResponse } from './compat-non-streaming-decoder.js'
import type { ChatCompletionResponse, StreamPayloadResult } from './compat-model-types.js'
import {
  enforceNonStreamingLimits,
  modelPayloadError,
  modelPayloadFailure
} from './compat-model-support.js'

export type CompatStreamPayloadDeps = {
  normalizeUsage: (usage: Record<string, unknown>, model?: string) => UsageSnapshot
  parseToolArguments: (raw: string) => Record<string, unknown>
}

export function consumeCompatStreamPayload(
  payload: Record<string, unknown>,
  pendingArguments: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>,
  completedToolCalls: Set<string>,
  sawTextDelta: boolean,
  responsesContentTracker: ResponsesContentTracker,
  anthropicThinkingState: AnthropicThinkingState,
  endpointFormat: ModelEndpointFormat,
  model: string,
  budget: ModelStreamResourceBudget,
  deps: CompatStreamPayloadDeps
): StreamPayloadResult {
  const payloadError = modelPayloadError(payload)
  if (payloadError) {
    return {
      chunks: [{
        kind: 'error',
        message: payloadError.message,
        ...(payloadError.code ? { code: payloadError.code } : {}),
        failure: modelPayloadFailure(payloadError)
      }],
      sawTextDelta,
      finishReason: 'error',
      usage: null
    }
  }
  if (endpointFormat === 'responses') {
    return decodeResponsesStreamPayload({
      payload,
      pendingArguments,
      pendingByIndex,
      completedToolCalls,
      sawTextDelta,
      contentTracker: responsesContentTracker,
      budget,
      parseToolArguments: deps.parseToolArguments,
      normalizeUsage: (usage) => deps.normalizeUsage(usage, model)
    })
  }
  if (endpointFormat === 'messages') {
    return decodeAnthropicMessagesStreamPayload({
      payload,
      pendingArguments,
      pendingByIndex,
      completedToolCalls,
      thinkingState: anthropicThinkingState,
      sawTextDelta,
      budget,
      normalizeUsage: (usage) => deps.normalizeUsage(usage, model),
      parseToolArguments: deps.parseToolArguments
    })
  }
  return decodeChatCompletionsStreamPayload({
    payload,
    pendingArguments,
    pendingByIndex,
    sawTextDelta,
    budget,
    normalizeUsage: (usage) => deps.normalizeUsage(usage, model),
    parseToolArguments: deps.parseToolArguments
  })
}

export function* materializeCompatNonStreaming(
  payload: ChatCompletionResponse,
  endpointFormat: ModelEndpointFormat,
  model: string,
  limits: ModelStreamLimits,
  deps: CompatStreamPayloadDeps
): Generator<ModelStreamChunk> {
  yield* enforceNonStreamingLimits(
    decodeCompatNonStreamingResponse(
      payload as unknown as Record<string, unknown>,
      endpointFormat,
      {
        normalizeUsage: (usage) => deps.normalizeUsage(usage, model),
        parseToolArguments: deps.parseToolArguments,
        payloadError: modelPayloadError
      }
    ),
    limits
  )
}
