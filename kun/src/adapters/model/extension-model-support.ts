import {
  ModelProviderRequestSchema,
  ProviderBindingSchema,
  ProviderModelSchema,
  type ModelContentPart,
  type ModelMessage,
  type ModelProviderAdapter,
  type ModelProviderDeclaration,
  type ModelProviderRequest,
  type ModelProviderStreamEvent,
  type ProviderModel
} from '@kun/extension-api'
import { compileExtensionJsonSchema } from '../../extensions/json-schema-validator.js'
import type { ExtensionPrincipal } from '../../services/extension-agent-service.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { projectCompatMessages } from './compat-message-projector.js'
import { COMPAT_HISTORY_CONTEXT, type CompatChatMessage } from './compat-request-codecs.js'
import { TOOL_ARGUMENT_PART_COMPACTION_WINDOW } from './model-stream-resource-budget.js'
import type { ExtensionModelProviderDiagnostic } from './extension-model-provider.js'

export type ProviderRegistration = {
  providerId: string
  principal: ExtensionPrincipal
  declaration: ModelProviderDeclaration
  adapter: ModelProviderAdapter
  activeRequests: Map<string, AbortController>
  reportDiagnostic(input: Omit<ExtensionModelProviderDiagnostic, 'extensionId' | 'providerId' | 'timestamp'>): void
  disposed: boolean
}

export type PendingProviderToolCall = {
  callId: string
  nameBlocks: string[]
  nameParts: string[]
  argumentBlocks: string[]
  argumentParts: string[]
  argumentBytes: number
  complete?: Extract<ModelProviderStreamEvent, { type: 'toolCallComplete' }>
}

export async function mergedProviderModels(
  registration: ProviderRegistration,
  signal?: AbortSignal,
  accountId?: string
): Promise<ProviderModel[]> {
  let dynamic: ProviderModel[] = []
  try {
    dynamic = await registration.adapter.listModels(
      ProviderBindingSchema.parse({
        providerId: registration.providerId,
        ...(accountId ? { accountId } : {}),
        modelId: 'model-list'
      }),
      { cancellation: cancellationToken(signal ?? new AbortController().signal) }
    )
  } catch (error) {
    if (signal?.aborted) throw error
    registration.reportDiagnostic({
      operation: 'listModels',
      code: 'model_discovery_failed',
      category: 'adapter_failure',
      retryable: false,
      ...(accountId ? { accountId } : {}),
      message: 'Dynamic model discovery failed; using manifest-declared models.'
    })
    return [...registration.declaration.models].sort((left, right) => left.id.localeCompare(right.id))
  }
  const merged = new Map<string, ProviderModel>()
  const dynamicIds = new Set<string>()
  if (dynamic.length > 512) {
    registration.reportDiagnostic({
      operation: 'listModels',
      code: 'model_limit_exceeded',
      category: 'protocol',
      retryable: false,
      ...(accountId ? { accountId } : {}),
      message: 'Dynamic model discovery exceeded 512 entries; extra entries were ignored.'
    })
  }
  for (const model of dynamic.slice(0, 512)) {
    const parsed = ProviderModelSchema.safeParse(model)
    if (!parsed.success) {
      registration.reportDiagnostic({
        operation: 'listModels',
        code: 'invalid_model',
        category: 'protocol',
        retryable: false,
        ...(accountId ? { accountId } : {}),
        message: 'Dynamic model discovery returned an invalid entry; it was ignored.'
      })
      continue
    }
    if (dynamicIds.has(parsed.data.id)) {
      registration.reportDiagnostic({
        operation: 'listModels',
        code: 'duplicate_model',
        category: 'protocol',
        retryable: false,
        ...(accountId ? { accountId } : {}),
        modelId: parsed.data.id,
        message: `Dynamic model discovery returned duplicate model ID ${parsed.data.id}; the first entry was retained.`
      })
      continue
    }
    dynamicIds.add(parsed.data.id)
    merged.set(parsed.data.id, parsed.data)
  }
  // Manifest declarations are the reviewed, consented capability ceiling and
  // therefore override dynamic metadata for the same model identity.
  for (const model of registration.declaration.models) merged.set(model.id, model)
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export async function resolveProviderModel(
  registration: ProviderRegistration,
  modelId: string,
  signal?: AbortSignal,
  accountId?: string
): Promise<ProviderModel> {
  const declared = registration.declaration.models.find((model) => model.id === modelId)
  if (declared) return declared
  const dynamic = await mergedProviderModels(registration, signal, accountId)
  const model = dynamic.find((candidate) => candidate.id === modelId)
  if (!model) throw new Error(`model is not provided by ${registration.providerId}: ${modelId}`)
  return model
}

export function assertModelRequestCapabilities(request: ModelRequest, model: ProviderModel): void {
  const capabilities = model.capabilities
  const historicalAttachments = Object.values(request.messageAttachments ?? {})
  const historicalImageCount = historicalAttachments.reduce(
    (count, attachments) => count + attachments.images.length,
    0
  )
  const historicalDocumentCount = historicalAttachments.reduce(
    (count, attachments) => count + attachments.documents.length,
    0
  )
  if (request.tools.length > 0 && !capabilities.tools) {
    throw new Error(`extension provider model does not support tools: ${model.id}`)
  }
  if (request.reasoningEffort && request.reasoningEffort !== 'off' && !capabilities.reasoning) {
    throw new Error(`extension provider model does not support reasoning: ${model.id}`)
  }
  if (
    ((request.attachments?.length ?? 0) > 0 || historicalImageCount > 0) &&
    !capabilities.input.includes('image')
  ) {
    throw new Error(`extension provider model does not support image input: ${model.id}`)
  }
  if (
    ((request.attachmentDocuments?.length ?? 0) > 0 || historicalDocumentCount > 0) &&
    !capabilities.input.includes('file')
  ) {
    throw new Error(`extension provider model does not support document input: ${model.id}`)
  }
  if (!capabilities.output.includes('text') && !capabilities.tools) {
    throw new Error(`extension provider model has no Kun-compatible output capability: ${model.id}`)
  }
}

export function normalizeModelRequest(
  request: ModelRequest,
  requestId: string,
  providerId: string,
  accountId: string,
  supportsImages: boolean
): ModelProviderRequest {
  const projected = projectCompatMessages(request, { thinkingMode: true, supportsImages })
  const instructions: string[] = []
  const messages: ModelMessage[] = []
  for (const message of projected) {
    if (message.role === 'system') {
      const text = compatText(message.content)
      if (text && message[COMPAT_HISTORY_CONTEXT] === true) {
        messages.push({ role: 'user', content: [{ type: 'text', text }] })
      } else if (text) {
        instructions.push(text)
      }
      continue
    }
    const metadata: Record<string, unknown> = {}
    if (message.tool_calls?.length) metadata.toolCalls = message.tool_calls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeJsonObject(call.function.arguments)
    }))
    if (message.reasoning_content?.trim()) metadata.reasoning = message.reasoning_content
    messages.push({
      role: message.role,
      content: compatContent(message.content),
      ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
      ...(Object.keys(metadata).length ? { metadata: metadata as never } : {})
    })
  }
  const reasoning = normalizeReasoningEffort(request.reasoningEffort)
  return ModelProviderRequestSchema.parse({
    apiVersion: '1.0.0',
    requestId,
    binding: { providerId, accountId, modelId: request.model },
    instructions,
    messages,
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })),
    generation: {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(reasoning ? { reasoningEffort: reasoning } : {}),
      ...(request.requiredToolName
        ? { toolChoice: { type: 'tool' as const, name: request.requiredToolName } }
        : {})
    },
    metadata: {
      threadId: request.threadId,
      turnId: request.turnId,
      ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {})
    }
  })
}

export function mapProviderEvent(event: ModelProviderStreamEvent): ModelStreamChunk[] {
  switch (event.type) {
    case 'textDelta': return [{ kind: 'assistant_text_delta', text: event.delta }]
    case 'reasoningDelta': return [{ kind: 'assistant_reasoning_delta', text: event.delta }]
    case 'toolCallDelta': return [{
      kind: 'tool_call_delta', callId: event.callId,
      ...(event.nameDelta ? { toolName: event.nameDelta } : {}),
      ...(event.argumentsDelta ? { argumentsDelta: event.argumentsDelta } : {})
    }]
    case 'toolCallComplete': return [{
      kind: 'tool_call_complete', callId: event.callId, toolName: event.name, arguments: event.input
    }]
    case 'usage': return [{ kind: 'usage', usage: usageSnapshot(event.usage) }]
    case 'completed': return [{
      kind: 'completed' as const,
      stopReason: event.finishReason === 'tool_calls'
        ? 'tool_calls' as const
        : event.finishReason === 'length'
          ? 'length' as const
          : 'stop' as const
    }]
    case 'error': return [
      {
        kind: 'error',
        message: 'Extension provider reported an error.',
        code: 'extension_provider_error'
      },
      { kind: 'completed', stopReason: 'error' }
    ]
  }
}

type NormalizedProviderError = {
  category: Extract<ExtensionModelProviderDiagnostic['category'],
    'authentication' | 'authorization' | 'rate_limit' | 'invalid_request' | 'unavailable' | 'adapter_failure'>
  retryable: boolean
  code: string
  message: string
}

export function mapProviderErrorEvent(
  event: Extract<ModelProviderStreamEvent, { type: 'error' }>
): ModelStreamChunk[] {
  const normalized = normalizeProviderReportedError(event.code, event.retryable)
  return [
    { kind: 'error', message: normalized.message, code: normalized.code },
    { kind: 'completed', stopReason: 'error' }
  ]
}

/**
 * Provider-owned codes and messages are untrusted and may contain credentials.
 * Map only recognized semantic tokens into a fixed Kun vocabulary, retaining
 * retryability without persisting or displaying the raw adapter payload.
 */
export function normalizeProviderReportedError(code: string, retryable: boolean): NormalizedProviderError {
  const tokens = code
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const compact = tokens.join('')
  const has = (...values: string[]) => values.some((value) => tokens.includes(value))
  const is = (...values: string[]) => values.includes(compact)
  const httpStatus = tokens.find((token) => /^\d{3}$/.test(token))
  if (has('unauthenticated', 'authentication', 'reauthentication', 'credential', 'credentials',
    'invalidcredential', 'invalidcredentials', 'unauthorized') ||
      is('invalidapikey', 'invalidaccesstoken', 'authenticationrequired') ||
      httpStatus === '401' ||
      (has('auth') && !has('authorization', 'forbidden')) ||
      (has('api') && has('key')) ||
      (has('access') && has('token'))) {
    return {
      category: 'authentication',
      retryable,
      code: 'extension_provider_authentication_error',
      message: 'Extension provider authentication failed; reconnect the selected account.'
    }
  }
  if (has('authorization', 'forbidden', 'permission', 'denied') || httpStatus === '403') {
    return {
      category: 'authorization',
      retryable,
      code: 'extension_provider_authorization_error',
      message: 'Extension provider authorization failed for the selected account.'
    }
  }
  // Billing/quota exhaustion is checked before generic rate limiting: a
  // credit failure is deterministic for this account and must not be retried
  // or mislabeled as a transient rate limit.
  if (
    has('insufficient', 'balance', 'credit', 'billing', 'payment', 'arrear', 'recharge', 'quota') ||
    is('insufficientquota', 'quotaexceeded', 'insufficientbalance', 'billingrequired', 'paymentrequired') ||
    httpStatus === '402'
  ) {
    return {
      category: 'rate_limit',
      retryable,
      code: 'extension_provider_quota_error',
      message: 'Extension provider reported exhausted quota or credit.'
    }
  }
  if (
    has('ratelimit', 'rate', 'quota', 'throttled', 'throttle') ||
    is('resourceexhausted', 'toomanyrequests', 'ratelimitexceeded', 'quotaexceeded') ||
    httpStatus === '429'
  ) {
    return {
      category: 'rate_limit',
      retryable,
      code: 'extension_provider_rate_limit_error',
      message: 'Extension provider rate limit was reached.'
    }
  }
  if (
    has('invalidrequest', 'invalid', 'badrequest', 'unsupported', 'notfound') ||
    is('modelnotfound', 'resourcenotfound', 'invalidargument', 'failedprecondition') ||
    httpStatus === '400' || httpStatus === '404' || httpStatus === '409' || httpStatus === '422'
  ) {
    return {
      category: 'invalid_request',
      retryable,
      code: 'extension_provider_invalid_request',
      message: 'Extension provider rejected the normalized request.'
    }
  }
  if (
    has('unavailable', 'timeout', 'overloaded', 'network', 'upstream') ||
    is('deadlineexceeded', 'requesttimeout', 'serviceunavailable', 'gatewaytimeout') ||
    httpStatus === '408' || httpStatus === '500' || httpStatus === '502' ||
    httpStatus === '503' || httpStatus === '504'
  ) {
    return {
      category: 'unavailable',
      retryable,
      code: 'extension_provider_unavailable',
      message: 'Extension provider is temporarily unavailable.'
    }
  }
  return {
    category: 'adapter_failure',
    retryable,
    code: 'extension_provider_error',
    message: 'Extension provider reported an error.'
  }
}

export function finalizeProviderToolCalls(
  request: ModelProviderRequest,
  pending: ReadonlyMap<string, PendingProviderToolCall>,
  finishReason: Extract<ModelProviderStreamEvent, { type: 'completed' }>['finishReason'],
  limits: {
    maxCompletedToolCallsPerRequest: number
    maxToolArgumentBytes: number
    maxCompletedToolArgumentBytesPerRequest: number
  }
): ModelStreamChunk[] {
  if (finishReason === 'tool_calls' && pending.size === 0) {
    throw new Error('extension provider completed for tool calls without a completed call')
  }
  if (finishReason !== 'tool_calls' && pending.size > 0) {
    throw new Error('extension provider emitted tool calls with a non-tool terminal reason')
  }
  if (pending.size > limits.maxCompletedToolCallsPerRequest) {
    throw new Error(
      `extension provider completed tool-call limit exceeded ` +
      `(${pending.size}/${limits.maxCompletedToolCallsPerRequest})`
    )
  }

  const advertised = new Map(request.tools.map((tool) => [tool.name, tool]))
  const chunks: ModelStreamChunk[] = []
  let totalArgumentBytes = 0
  for (const call of pending.values()) {
    const fragmentedName = [...call.nameBlocks, ...call.nameParts].join('')
    const fragmentedArguments = [...call.argumentBlocks, ...call.argumentParts].join('')
    let name: string
    let input: Record<string, unknown>
    if (call.complete) {
      name = call.complete.name
      input = call.complete.input
      if (fragmentedName && fragmentedName !== name) {
        throw new Error('extension provider tool-call name fragments do not match completion')
      }
      if (fragmentedArguments) {
        const assembled = parseProviderToolArguments(fragmentedArguments)
        if (stableJson(assembled) !== stableJson(input)) {
          throw new Error('extension provider tool-call argument fragments do not match completion')
        }
      }
    } else {
      if (!fragmentedName) throw new Error('extension provider tool call has no name')
      name = fragmentedName
      input = parseProviderToolArguments(fragmentedArguments || '{}')
    }
    const tool = advertised.get(name)
    if (!tool) throw new Error('extension provider requested an unadvertised tool')
    compileExtensionJsonSchema(tool.inputSchema, `model tool ${name} input`)
      .assert(input, `extension provider tool call ${call.callId}`)

    const argumentBytes = serializedBytes(input)
    if (argumentBytes > limits.maxToolArgumentBytes) {
      throw new Error(
        `extension provider tool argument byte limit exceeded ` +
        `(${argumentBytes}/${limits.maxToolArgumentBytes} bytes)`
      )
    }
    totalArgumentBytes += argumentBytes
    if (totalArgumentBytes > limits.maxCompletedToolArgumentBytesPerRequest) {
      throw new Error(
        `extension provider completed tool-argument byte limit exceeded ` +
        `(${totalArgumentBytes}/${limits.maxCompletedToolArgumentBytesPerRequest} bytes)`
      )
    }
    chunks.push({
      kind: 'tool_call_complete',
      callId: call.callId,
      toolName: name,
      arguments: input
    })
  }
  return chunks
}

export function appendProviderToolName(pending: PendingProviderToolCall, value: string): void {
  pending.nameParts.push(value)
  if (pending.nameParts.length < TOOL_ARGUMENT_PART_COMPACTION_WINDOW) return
  pending.nameBlocks.push(pending.nameParts.join(''))
  pending.nameParts = []
}

export function appendProviderToolArguments(pending: PendingProviderToolCall, value: string): void {
  pending.argumentParts.push(value)
  if (pending.argumentParts.length < TOOL_ARGUMENT_PART_COMPACTION_WINDOW) return
  pending.argumentBlocks.push(pending.argumentParts.join(''))
  pending.argumentParts = []
}

function parseProviderToolArguments(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('extension provider tool-call arguments are not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('extension provider tool-call arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value))
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)])
  )
}

export function usageSnapshot(usage: {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  currency?: string
}) {
  const promptTokens = usage.inputTokens ?? 0
  const completionTokens = usage.outputTokens ?? 0
  const currency = usage.currency?.toUpperCase()
  return {
    promptTokens,
    completionTokens,
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    totalTokens: promptTokens + completionTokens,
    ...(usage.cacheReadTokens !== undefined ? { cachedTokens: usage.cacheReadTokens, cacheHitTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    cacheHitRate: usage.cacheReadTokens !== undefined && promptTokens > 0
      ? Math.min(1, usage.cacheReadTokens / promptTokens)
      : null,
    turns: 1,
    ...(usage.cost !== undefined && currency ? { costByCurrency: { [currency]: usage.cost } } : {}),
    ...(usage.cost !== undefined && currency === 'USD' ? { costUsd: usage.cost } : {}),
    ...(usage.cost !== undefined && currency === 'CNY' ? { costCny: usage.cost } : {})
  }
}

export function hasReportedUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
}): boolean {
  return usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.reasoningTokens !== undefined ||
    usage.cacheReadTokens !== undefined ||
    usage.cacheWriteTokens !== undefined ||
    usage.cost !== undefined
}

export function safeProviderProtocolError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const safePrefixes = [
    'extension provider stream event limit exceeded',
    'extension provider stream event is too large',
    'extension provider stream byte limit exceeded',
    'extension provider stream requestId mismatch',
    'extension provider stream sequence mismatch',
    'extension provider emitted data after a terminal event',
    'extension provider completed without terminal usage',
    'extension provider stream output byte limit exceeded',
    'extension provider pending tool-call limit exceeded',
    'extension provider tool argument byte limit exceeded',
    'extension provider total pending tool-argument byte limit exceeded',
    'extension provider completed tool-call limit exceeded',
    'extension provider completed tool-argument byte limit exceeded',
    'extension provider completed for tool calls without a completed call',
    'extension provider emitted tool calls with a non-tool terminal reason',
    'extension provider tool-call name fragments do not match completion',
    'extension provider tool-call argument fragments do not match completion',
    'extension provider tool call has no name',
    'extension provider requested an unadvertised tool',
    'extension provider tool-call arguments are not valid JSON',
    'extension provider tool-call arguments must be a JSON object',
    'extension provider emitted tool-call data after completion',
    'extension provider completed the same tool call more than once',
    'extension provider stream ended without a terminal event'
  ]
  return safePrefixes.some((prefix) => message.startsWith(prefix))
    ? message.slice(0, 4_096)
    : 'Extension provider returned malformed stream data.'
}

function compatContent(content: CompatChatMessage['content']): ModelContentPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!content) return []
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text }
    const parsed = /^data:([^;,]+);base64,(.*)$/s.exec(part.image_url.url)
    return parsed
      ? { type: 'image' as const, mimeType: parsed[1]!, data: parsed[2]! }
      : { type: 'text' as const, text: `[image: ${part.image_url.url}]` }
  })
}

function compatText(content: CompatChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content?.map((part) => part.type === 'text' ? part.text : '').join('\n') ?? ''
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function normalizeReasoningEffort(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  if (value === 'max') return 'high'
  return undefined
}

export function cancellationToken(signal: AbortSignal) {
  return {
    get isCancellationRequested() { return signal.aborted },
    onCancellationRequested(listener: () => void) {
      signal.addEventListener('abort', listener, { once: true })
      return { dispose: () => signal.removeEventListener('abort', listener) }
    }
  }
}

export function forwardAbort(source: AbortSignal, target: AbortController): () => void {
  const abort = () => target.abort(source.reason)
  if (source.aborted) abort()
  else source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
}

export function abortError(): Error {
  const error = new Error('extension provider request aborted')
  error.name = 'AbortError'
  return error
}
