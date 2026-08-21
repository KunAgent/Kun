import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
import type { ModelClient, ModelStreamChunk } from '../../ports/model-client.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelStreamLimits } from './model-stream-resource-budget.js'
import type { CompatChatMessage } from './compat-request-codecs.js'

export type CompatModelClientConfig = {
  /** Stable configured provider identity retained in durable usage. */
  providerId?: string
  baseUrl: string
  apiKey: string
  model: string
  /** Compatible request/response protocol to use for custom providers. */
  endpointFormat?: ModelEndpointFormat
  /** Optional extra headers, e.g. project or session ids. */
  headers?: Record<string, string>
  /**
   * Resolves protected request credentials immediately before each HTTP call.
   * Passing the rejected access token after a 401 lets OAuth implementations
   * rotate it once without racing concurrent requests.
   */
  resolveCredentials?: (
    rejectedAccessToken?: string
  ) => Promise<{ apiKey: string; headers?: Record<string, string>; refreshable: boolean }>
  /** HTTP fetch implementation. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Optional proxy URL used only for model HTTP requests. */
  modelProxyUrl?: string
  /** Maximum number of messages to send. Defaults to the entire history. */
  historyLimit?: number
  /** When true, the client requests a non-streaming response. */
  nonStreaming?: boolean
  /** Maximum idle time between streaming chunks before the turn fails. */
  streamIdleTimeoutMs?: number
  /** Resource ceilings for one provider SSE response. */
  streamLimits?: Partial<ModelStreamLimits>
  /** 流式响应开始前,遇到临时失败或限流响应时使用的 HTTP 重试策略。 */
  retry?: ModelRequestRetryConfig
  /** Optional model capability resolver used for provider-specific reasoning translation. */
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  /** Optional troubleshooting sink that captures each request body + raw output. */
  debugSink?: LlmDebugSink
  /** Non-sensitive billing attribution used only for usage aggregation. */
  billingKind?: 'subscription'
}

export type ChatMessage = CompatChatMessage
export type ModelStopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']
export type ChatCompletionResponse = {
  id: string
  model: string
  choices: {
    index: number
    finish_reason: string
    message: ChatMessage & {
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_eval_count?: number
    eval_count?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export type StreamReadResult =
  | { kind: 'chunk'; value?: Uint8Array; done: boolean }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }
export type StreamPayloadResult = {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
}
export type CompatPostResult =
  | { kind: 'response'; response: Response }
  | {
      kind: 'error'
      message: string
      code?: string
      failure: import('../../contracts/model-route-pool.js').ModelFailureMetadata
    }
