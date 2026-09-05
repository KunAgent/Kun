import type { ToolCallProviderMetadata, TurnItem } from '../contracts/items.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ToolProviderKind } from './tool-host.js'
import type { ModelFailureMetadata } from '../contracts/model-route-pool.js'
import type { TurnServiceTier } from '../contracts/turns.js'

/**
 * One streaming chunk from a model response. The loop consumes these
 * chunks to drive assistant text and reasoning deltas, tool call
 * accumulation, and usage reporting.
 */
export type ModelRouteTargetMetadata = {
  routePoolId: string
  targetId: string
  providerId: string
  modelId: string
  requestedModelId: string
}

/**
 * Durable route identity for a historical turn. This contains no credential
 * material; it is used only to decide whether provider-private reasoning can
 * be replayed to the current model route.
 */
export type ModelHistoryRoute = {
  model: string
  providerId?: string
  accountId?: string
}

export type ModelStreamChunk = (
  | { kind: 'assistant_text_delta'; text: string }
  | { kind: 'assistant_reasoning_delta'; text: string }
  | { kind: 'tool_call_delta'; callId: string; toolName?: string; argumentsDelta?: string }
  | {
      kind: 'tool_call_complete'
      callId: string
      toolName: string
      arguments: Record<string, unknown>
      providerMetadata?: ToolCallProviderMetadata
    }
  | {
      kind: 'retrying'
      status?: number
      attempt: number
      maxAttempts: number
      delayMs: number
      reason?: 'network' | 'stream_transport'
      /** Safe, concise provider diagnostic displayed from the retry status. */
      failureSummary?: string
    }
  | { kind: 'image_generation_complete'; imageBase64: string; mimeType: string }
  | { kind: 'usage'; usage: UsageSnapshot }
  | { kind: 'completed'; stopReason: 'stop' | 'tool_calls' | 'length' | 'error' }
  | { kind: 'error'; message: string; code?: string; failure?: ModelFailureMetadata }
) & { route?: ModelRouteTargetMetadata }

/**
 * A single model turn request: the immutable prefix items, the running
 * conversation history, and any tools that are currently advertised.
 */
export type ModelRequest = {
  threadId: string
  turnId: string
  /** Internal correlation carried through every concrete Provider attempt. */
  trace?: {
    roundId: string
    step: number
    purpose: 'assistant' | 'retry' | 'resume' | 'compaction' | 'subagent' | 'title'
  }
  model: string
  /**
   * Optional provider id override. Routed by `MultiProviderModelClient`
   * to a per-provider client when set; falls back to the runtime's
   * default provider only when omitted or explicitly `default`. Unknown
   * providers fail closed so requests never cross credential boundaries. Lets a workflow / scheduled
   * task / IM bridge pick a non-runtime provider per request while
   * reusing the single Kun process (kun#workflow-multi-provider).
   */
  providerId?: string
  /** Runtime-owned diagnostic run id used to correlate route-test progress. */
  routeTestId?: string
  /** Opaque account selection for custom/extension providers. Never a credential. */
  accountId?: string
  systemPrompt?: string
  /**
   * Optional thread-scoped persona/profile. Emitted as a separate system
   * message after the stable Kun contract so per-thread customization never
   * mutates the immutable prefix field.
   */
  threadProfileInstruction?: string
  /**
   * Legacy/direct-caller mode instruction. Native AgentLoop requests persist
   * mode policy as chronological `model_context` history instead.
   */
  modeInstruction?: string
  /**
   * Legacy/direct-caller dynamic context. Native AgentLoop requests persist
   * the rendered blocks as chronological `model_context` history instead.
   */
  contextInstructions?: string[]
  /** Exact private request-local strings removed from retained diagnostics only. */
  redactedRequestValues?: string[]
  prefix: TurnItem[]
  history: TurnItem[]
  /**
   * Persisted acting routes for historical turns. Thinking adapters must not
   * replay a tool-use round's private reasoning unless this route exactly
   * matches the current request route.
   */
  historyRoutesByTurnId?: Readonly<Record<string, ModelHistoryRoute>>
  attachments?: ModelInputAttachment[]
  attachmentTextFallbacks?: ModelTextAttachmentFallback[]
  attachmentDocuments?: ModelDocumentAttachment[]
  /** Transient attachment payloads keyed by their persisted user-message id. */
  messageAttachments?: Readonly<Record<string, ModelMessageAttachments>>
  tools: ModelToolSpec[]
  /**
   * Hard named-tool constraint. The caller MUST expose this tool alone and
   * the adapter MUST serialize the protocol's named tool-choice form. A
   * provider that cannot enforce the exact name must fail closed rather than
   * falling back to generic/automatic tool selection.
   *
   * This is intentionally not a soft post-condition for workflows that can
   * legitimately ask questions or answer in prose (for example Plan mode).
   */
  requiredToolName?: string
  /** Optional per-request streaming override. Defaults to adapter configuration. */
  stream?: boolean
  /** Optional output cap forwarded to OpenAI-compatible providers. */
  maxTokens?: number
  /** Optional sampling controls for classifier-style calls. */
  temperature?: number
  topP?: number
  /** Optional structured response mode for short JSON classifier paths. */
  responseFormat?: 'json_object'
  /**
   * Optional DeepSeek-style thinking control. `off` disables thinking;
   * `high` and `max` enable it with a concrete reasoning effort.
   */
  reasoningEffort?: string
  /** Optional provider request class, captured from the initiating turn. */
  serviceTier?: TurnServiceTier
  /** Short runtime-owned namespace for provider-native prompt caches. */
  promptCachePartition?: string
  abortSignal: AbortSignal
}

export type ModelInputAttachment = {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  width?: number
  height?: number
  localFilePath?: string
}

export type ModelTextAttachmentFallback = {
  id: string
  name: string
  mimeType: string
  dataBase64: string
  byteSize: number
  width?: number
  height?: number
  localFilePath?: string
  wasCompressed?: boolean
}

export type ModelDocumentAttachment = {
  id: string
  name: string
  mimeType: string
  text: string
  byteSize: number
  documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
  sourceSha256?: string
  pageCount?: number
  truncated?: boolean
  localFilePath?: string
}

export type ModelUnavailableAttachment = {
  id: string
  text: string
}

export type ModelMessageAttachments = {
  images: ModelInputAttachment[]
  textFallbacks: ModelTextAttachmentFallback[]
  documents: ModelDocumentAttachment[]
  unavailable: ModelUnavailableAttachment[]
  /** Original per-message attachment order across wire representation kinds. */
  order?: ModelMessageAttachmentOrderEntry[]
}

export type ModelMessageAttachmentOrderEntry =
  | { kind: 'image'; index: number }
  | { kind: 'text_fallback'; index: number }
  | { kind: 'document'; index: number }
  | { kind: 'unavailable'; index: number }

export type ModelToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  /** Host-authored side-effect classification; never forwarded to model providers. */
  sideEffect?: 'read-only' | 'unknown'
  /** Local execution provenance. Provider serializers must not forward it. */
  providerKind?: ToolProviderKind
  /** Stable local provider id (for example `builtin` or `mcp:filesystem`). */
  providerId?: string
}

/**
 * Port for talking to a model provider. Adapters implement this with
 * a DeepSeek-compatible HTTP client, with `pi-ai`, or with a test
 * double. The loop never depends on a concrete implementation.
 */
export interface ModelClient {
  readonly provider: string
  readonly model: string
  /**
   * True when the concrete provider/model target is selected only after the
   * stream starts (for example a failover route pool). Callers must not freeze
   * the public alias as the acting route before a route-bearing chunk arrives.
   */
  selectsRouteTargetDuringStream?(
    request: Pick<ModelRequest, 'model' | 'providerId'>
  ): boolean
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}
