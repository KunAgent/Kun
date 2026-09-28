import { randomUUID } from 'node:crypto'
import type { TurnItem } from '../../contracts/items.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { hasUsage } from '../../domain/usage.js'
import { parseGatewayModelId } from '../../harness/gateway-model-id.js'
import {
  HARNESS_TOKEN_PREFIX,
  type HarnessTokenGrant
} from '../../harness/harness-token-service.js'
import { estimateTokens } from '../../loop/request-history-hygiene.js'
import { IMAGE_TOOL_RESULT_TOKEN_ESTIMATE } from '../../loop/tool-result-image.js'
import type { ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { GatewayRequestGuard, type GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Transport-independent core of the local model gateway (docs/ade/04 §5.2):
 * credential guard, request body reading, inbound message → TurnItem
 * conversion, route-pool model resolution, and shared value/error helpers.
 * The OpenAI (`openai-model-gateway.ts`) and Anthropic
 * (`anthropic-messages-gateway.ts`) entry points keep only their wire-format
 * mapping on top of this module.
 */

export const MAX_GATEWAY_BODY_BYTES = 2 * 1024 * 1024
const GATEWAY_GUARDS = new WeakMap<object, GatewayRequestGuard>()

export function guardFor(runtime: ServerRuntime): GatewayRequestGuard | null {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return null
  let guard = GATEWAY_GUARDS.get(credentials)
  if (!guard) {
    guard = new GatewayRequestGuard(credentials)
    GATEWAY_GUARDS.set(credentials, guard)
  }
  return guard
}
export async function nextGatewayChunk(
  iterator: AsyncIterator<ModelStreamChunk>,
  signal: AbortSignal
): Promise<IteratorResult<ModelStreamChunk>> {
  if (signal.aborted) throw signal.reason ?? new Error('gateway request aborted')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new Error('gateway request aborted'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then(
      (result) => { cleanup(); resolve(result) },
      (error) => { cleanup(); reject(error) }
    )
  })
}

export function authorizePublicGateway(runtime: ServerRuntime, request: Request): JsonResponse | null {
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  if (!guard.consumeToken()) return openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
  return null
}

/**
 * Gateway caller identity (docs/ade/04 §5.2): either a public gateway
 * credential or a `kgw_` harness grant. Harness tokens are checked first and
 * fail closed — a `kgw_` token is never accepted as a public credential.
 */
export type GatewayAuth =
  | { kind: 'public' }
  | { kind: 'harness'; grant: HarnessTokenGrant }

export type GatewayAuthVerdict =
  | { ok: true; auth: GatewayAuth }
  | { ok: false; reason: 'unauthorized' | 'rate_limited' }

export function bearerCandidate(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
  const candidate = match?.[1] ?? request.headers.get('x-api-key')
  return candidate && candidate.trim() ? candidate : null
}

export function authorizeGateway(runtime: ServerRuntime, request: Request): GatewayAuthVerdict {
  const candidate = bearerCandidate(request)
  if (candidate?.startsWith(HARNESS_TOKEN_PREFIX)) {
    const grant = runtime.harnessTokens?.verifyScope(candidate, 'gateway')
    return grant ? { ok: true, auth: { kind: 'harness', grant } } : { ok: false, reason: 'unauthorized' }
  }
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return { ok: false, reason: 'unauthorized' }
  if (!guard.consumeToken()) return { ok: false, reason: 'rate_limited' }
  return { ok: true, auth: { kind: 'public' } }
}

/**
 * Harness grants carry their own concurrency budget (default 4). Each grant
 * gets a dedicated guard so its leases share the public guard's timeout and
 * abort semantics without consuming public slots.
 */
const GRANT_GUARDS = new WeakMap<HarnessTokenGrant, GatewayRequestGuard>()

export function acquireHarnessGrantLease(grant: HarnessTokenGrant, signal: AbortSignal): GatewayLease | null {
  let guard = GRANT_GUARDS.get(grant)
  if (!guard) {
    guard = new GatewayRequestGuard({ verify: () => false }, { maxConcurrency: grant.maxConcurrent })
    GRANT_GUARDS.set(grant, guard)
  }
  return guard.acquire(signal)
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
export function openAiError(message: string, code: string, status: number): JsonResponse {
  return jsonResponse({ error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', param: null, code } }, status)
}
export function errorStatus(chunk: Extract<ModelStreamChunk, { kind: 'error' }>): number { return chunk.failure?.httpStatus && chunk.failure.httpStatus >= 400 ? chunk.failure.httpStatus : 502 }
export function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
export function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
export function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
export function parseArguments(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? asRecord(JSON.parse(value)) : asRecord(value) } catch { return {} } }

/**
 * Resolves a gateway model name: an enabled route-pool id, or
 * `providerId/modelId` addressing a usable provider directly (§6.13). For the
 * direct form the returned providerId overrides the gateway sentinel so the
 * request lands on that provider's client.
 *
 * Harness grants instead address `kun/<provider>/<model>` and may only reach
 * providers listed in the grant's routes — anything else resolves to null
 * (the caller answers 404). Grant routes bypass `exposableProvider` because
 * the grant itself is the authorization boundary: a worker may be granted a
 * subscription/OAuth provider without ever seeing its credential.
 */
export async function resolveGatewayModel(
  runtime: ServerRuntime,
  model: string,
  grant?: HarnessTokenGrant
): Promise<{ model: string; providerId?: string } | null> {
  if (grant) {
    const direct = parseGatewayModelId(model)
    if (!direct || !runtime.modelConnections) return null
    const allowed = grant.routes.some(
      (route) => route.providerId === direct.providerId && route.model === direct.model
    )
    if (!allowed) return null
    const snapshot = await runtime.modelConnections.snapshot()
    return snapshot.providers.some((provider) => provider.id === direct.providerId)
      ? { model: direct.model, providerId: direct.providerId }
      : null
  }
  if (runtime.modelGateway?.pools().some((pool) => pool.enabled && pool.modelId === model)) {
    return { model }
  }
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1 || !runtime.modelConnections) return null
  if (!runtime.modelGateway?.exposeProviderModels()) return null
  const providerId = model.slice(0, slash)
  const modelId = model.slice(slash + 1)
  const snapshot = await runtime.modelConnections.snapshot()
  const provider = snapshot.providers.find((candidate) => candidate.id === providerId)
  if (!provider || !exposableProvider(provider)) return null
  return { model: modelId, providerId }
}

/**
 * A provider may only be exposed through the local gateway when it is a plain
 * HTTP API-key connection with a ready credential. Subscription, OAuth, and
 * delegated/non-HTTP providers are never reachable this way.
 */
export function exposableProvider(provider: {
  kind: string
  authType: string
  configured: boolean
  credentialStatus?: string
}): boolean {
  return provider.kind === 'http' &&
    provider.authType === 'api-key' &&
    provider.configured &&
    (!provider.credentialStatus || provider.credentialStatus === 'ready')
}

/** Sorted unique model ids a provider advertises (`selectedModel` + `models`). */
export function providerModelIds(provider: {
  models?: string[]
  selectedModel?: string
}): string[] {
  return [...new Set(
    [provider.selectedModel, ...(provider.models ?? [])]
      .filter((model): model is string => typeof model === 'string' && model.length > 0)
  )].sort()
}

/**
 * Assemble a chat-shaped `messages` array (OpenAI/normalized Anthropic input)
 * into the canonical ModelRequest: system/developer messages fold into
 * `systemPrompt`, assistant tool_calls and tool results become TurnItems, and
 * image parts become attachments.
 */
export function makeModelRequest(
  input: Record<string, unknown>,
  signal: AbortSignal,
  providerId?: string,
  identity?: { threadId: string; turnId: string }
): ModelRequest {
  const model = stringValue(input.model)
  if (!model) throw new Error('model is required')
  const rawMessages = Array.isArray(input.messages) ? input.messages : []
  if (rawMessages.length === 0) throw new Error('messages or input is required')
  const now = new Date().toISOString()
  const threadId = identity?.threadId ?? `gateway_${randomUUID()}`
  const turnId = identity?.turnId ?? `turn_${randomUUID()}`
  const history: TurnItem[] = []
  const attachments: NonNullable<ModelRequest['attachments']> = []
  let systemPrompt = ''
  for (let index = 0; index < rawMessages.length; index += 1) {
    const message = asRecord(rawMessages[index])
    const role = stringValue(message.role)
    const extracted = messageContent(message.content, attachments, index)
    if (role === 'system' || role === 'developer') {
      systemPrompt += `${systemPrompt ? '\n\n' : ''}${extracted}`
      continue
    }
    const base = { id: `gateway_item_${index}`, turnId, threadId, status: 'completed' as const, createdAt: now }
    if (role === 'assistant') {
      if (extracted) history.push({ ...base, kind: 'assistant_text', role: 'assistant', text: extracted })
      for (const rawCall of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const call = asRecord(rawCall)
        const fn = asRecord(call.function)
        history.push({
          ...base,
          id: `${base.id}_tool_${history.length}`,
          kind: 'tool_call', role: 'assistant', toolKind: 'tool_call',
          callId: stringValue(call.id) || `call_${history.length}`,
          toolName: stringValue(fn.name) || 'unknown',
          arguments: parseArguments(fn.arguments)
        })
      }
    } else if (role === 'tool') {
      history.push({
        ...base, kind: 'tool_result', role: 'tool', toolKind: 'tool_call',
        callId: stringValue(message.tool_call_id) || `call_${index}`,
        toolName: stringValue(message.name) || 'unknown', output: extracted, isError: false
      })
    } else {
      history.push({ ...base, kind: 'user_message', role: 'user', text: extracted })
    }
  }
  return {
    threadId,
    turnId,
    model,
    providerId: providerId ?? LOCAL_MODEL_GATEWAY_PROVIDER_ID,
    systemPrompt,
    prefix: [],
    history,
    ...(attachments.length ? { attachments } : {}),
    tools: parseTools(input.tools),
    stream: input.stream !== false,
    ...(numberValue(input.max_tokens ?? input.max_output_tokens) ? { maxTokens: numberValue(input.max_tokens ?? input.max_output_tokens) } : {}),
    ...(numberValue(input.temperature) !== undefined ? { temperature: numberValue(input.temperature) } : {}),
    ...(stringValue(input.reasoning_effort) ? { reasoningEffort: stringValue(input.reasoning_effort) } : {}),
    abortSignal: signal
  }
}

export function responsesToChatInput(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.input
  const messages = typeof raw === 'string'
    ? [{ role: 'user', content: raw }]
    : Array.isArray(raw)
      ? raw.map((item) => {
          const record = asRecord(item)
          return { role: stringValue(record.role) || 'user', content: record.content }
        })
      : []
  return { ...input, messages, tools: input.tools, max_tokens: input.max_output_tokens }
}

export function parseTools(value: unknown): ModelToolSpec[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 128).flatMap((raw) => {
    const tool = asRecord(raw)
    const nested = asRecord(tool.function)
    const fn = stringValue(tool.type) === 'function' && Object.keys(nested).length > 0 ? nested : tool
    const name = stringValue(fn.name)
    if (!name) return []
    return [{ name, description: stringValue(fn.description), inputSchema: asRecord(fn.parameters ?? fn.input_schema) }]
  })
}

export function messageContent(value: unknown, attachments: NonNullable<ModelRequest['attachments']>, messageIndex: number): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const text: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const part = asRecord(value[index])
    if (stringValue(part.type) === 'text' || stringValue(part.type) === 'input_text') text.push(stringValue(part.text))
    const image = asRecord(part.image_url)
    const url = stringValue(image.url) || stringValue(part.image_url) || stringValue(part.image_url)
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(url)
    if (match) attachments.push({ id: `gateway_image_${messageIndex}_${index}`, name: `image-${messageIndex}-${index}`, mimeType: match[1], dataBase64: match[2] })
    else if (url) throw new Error('gateway image inputs must use a base64 data URL')
  }
  return text.join('\n')
}

/**
 * The currently running turn for a grant's thread, per the admissionPending
 * convention shared with delegated runtimes. When no turn is running the
 * caller attributes usage at thread level only.
 */
export async function gatewayRunningTurnId(runtime: ServerRuntime, threadId: string): Promise<string | undefined> {
  const thread = await runtime.threadService.get(threadId).catch(() => undefined)
  return thread?.turns.find((turn) => turn.status === 'running' && !turn.admissionPending)?.id
}

/**
 * Persist usage observed on a grant-scoped request (docs/ade/04 §6): one
 * `source: 'harness-gateway'` event per completed call, counted into the
 * usage service with the grant's thread (and running turn, when present).
 * The event carries the service's cumulative snapshot so it lands on the
 * same persisted axis as native `usage` events.
 */
export async function recordHarnessGatewayUsage(
  runtime: ServerRuntime,
  grant: HarnessTokenGrant,
  resolved: { model: string; providerId?: string },
  usage: UsageSnapshot | undefined,
  turnId?: string
): Promise<void> {
  if (!usage || !hasUsage(usage)) return
  const cumulative = runtime.usageService.record(grant.threadId, usage, undefined, turnId)
  await runtime.events.record({
    kind: 'usage',
    threadId: grant.threadId,
    ...(turnId ? { turnId } : {}),
    model: resolved.model,
    ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
    source: 'harness-gateway',
    harnessId: grant.harnessId,
    usage: cumulative
  })
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

/**
 * Rough input-token estimate for a gateway ModelRequest, reusing the loop's
 * context-hygiene estimator (and its per-image flat estimate) so gateway
 * accounting matches how the runtime itself budgets context.
 */
export function estimateModelRequestTokens(request: ModelRequest): number {
  let tokens = estimateTokens(request.systemPrompt ?? '')
  for (const item of request.history) {
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      tokens += estimateTokens(item.text)
    } else if (item.kind === 'tool_call') {
      tokens += estimateTokens(item.toolName) + estimateTokens(JSON.stringify(item.arguments ?? {}))
    } else if (item.kind === 'tool_result') {
      tokens += estimateTokens(stringifyToolOutput(item.output))
    }
  }
  for (const tool of request.tools) {
    tokens += estimateTokens(tool.name)
    tokens += estimateTokens(tool.description ?? '')
    tokens += estimateTokens(JSON.stringify(tool.inputSchema ?? {}))
  }
  if (request.attachments?.length) {
    tokens += request.attachments.length * IMAGE_TOOL_RESULT_TOKEN_ESTIMATE
  }
  return tokens
}
