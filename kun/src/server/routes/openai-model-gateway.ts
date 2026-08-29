import { randomUUID } from 'node:crypto'
import type { TurnItem } from '../../contracts/items.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../../contracts/model-route-pool.js'
import type { ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../ports/model-client.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { GatewayRequestGuard, type GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'

const MAX_GATEWAY_BODY_BYTES = 2 * 1024 * 1024
const GATEWAY_GUARDS = new WeakMap<object, GatewayRequestGuard>()

function guardFor(runtime: ServerRuntime): GatewayRequestGuard | null {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return null
  let guard = GATEWAY_GUARDS.get(credentials)
  if (!guard) {
    guard = new GatewayRequestGuard(credentials)
    GATEWAY_GUARDS.set(credentials, guard)
  }
  return guard
}

export function gatewayModels(runtime: ServerRuntime, request: Request): JsonResponse {
  const rejected = authorizePublicGateway(runtime, request)
  if (rejected) return rejected
  if (!runtime.modelGateway?.enabled()) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  return jsonResponse({
    object: 'list',
    data: runtime.modelGateway.pools().filter((pool) => pool.enabled).map((pool) => ({
      id: pool.modelId,
      object: 'model',
      created: 0,
      owned_by: 'kun-route-pool'
    }))
  })
}

export async function gatewayChatCompletions(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  return gatewayGenerate(runtime, request, 'chat')
}

export async function gatewayResponses(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  return gatewayGenerate(runtime, request, 'responses')
}

export function routePoolStatus(runtime: ServerRuntime): JsonResponse {
  if (!runtime.modelGateway) {
    return jsonResponse({ localGateway: { enabled: false }, pools: [], configuredPools: [], metrics: {}, events: [], tests: [] })
  }
  return jsonResponse({
    localGateway: { enabled: runtime.modelGateway.enabled() },
    pools: runtime.modelGateway.pools(),
    configuredPools: runtime.modelGateway.configuredPools(),
    ...runtime.modelGateway.health.snapshot(),
    tests: runtime.modelGateway.tests.list()
  })
}

export function gatewayCredentialStatus(runtime: ServerRuntime): JsonResponse {
  return jsonResponse({ credential: runtime.modelGateway?.credentials.status() ?? { configured: false } })
}

export async function ensureGatewayCredential(runtime: ServerRuntime): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return openAiError('Gateway credential service is unavailable.', 'gateway_unavailable', 503)
  const result = await credentials.ensure()
  return jsonResponse({ credential: credentials.status(), created: result.created })
}

export async function rotateGatewayCredential(runtime: ServerRuntime): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return openAiError('Gateway credential service is unavailable.', 'gateway_unavailable', 503)
  await credentials.rotate()
  return jsonResponse({ credential: credentials.status() })
}

export async function revokeGatewayCredential(runtime: ServerRuntime): Promise<JsonResponse> {
  const credentials = runtime.modelGateway?.credentials
  if (!credentials) return openAiError('Gateway credential service is unavailable.', 'gateway_unavailable', 503)
  const revoked = await credentials.revoke()
  return jsonResponse({ credential: credentials.status(), revoked })
}

export function revealGatewayCredential(runtime: ServerRuntime): JsonResponse {
  const key = runtime.modelGateway?.credentials.reveal()
  if (!key) return openAiError('Gateway API key is not configured.', 'gateway_key_missing', 404)
  return jsonResponse({ key })
}

export function testRoutePool(runtime: ServerRuntime, poolId: string): JsonResponse {
  const gateway = runtime.modelGateway
  const test = gateway?.tests.start(poolId)
  if (!gateway || !test) return openAiError('Route pool is not ready in the runtime.', 'model_not_ready', 409)
  return jsonResponse({ test }, 202)
}

async function gatewayGenerate(runtime: ServerRuntime, request: Request, shape: 'chat' | 'responses'): Promise<Response | JsonResponse> {
  const rejected = authorizePublicGateway(runtime, request)
  if (rejected) return rejected
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  const guard = guardFor(runtime)!
  const lease = guard.acquire(request.signal)
  if (!lease) return openAiError('Too many concurrent gateway requests.', 'concurrency_limit', 429)
  let body: Awaited<ReturnType<typeof readJsonBody>>
  try {
    body = await readJsonBody(request, MAX_GATEWAY_BODY_BYTES, lease.signal)
  } catch (error) {
    lease.release()
    return openAiError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 'timeout' : 'invalid_request_error', lease.timedOut() ? 504 : 400)
  }
  if (!body.ok) {
    lease.release()
    return openAiError(JSON.parse(body.response.body).message, 'invalid_request_error', body.response.status)
  }
  const input = asRecord(body.value)
  const model = stringValue(input.model)
  if (!model || !runtime.modelGateway.pools().some((pool) => pool.enabled && pool.modelId === model)) {
    lease.release()
    return openAiError(`The model '${model || '(missing)'}' does not exist.`, 'model_not_found', 404)
  }
  let modelRequest: ModelRequest
  try {
    modelRequest = makeModelRequest(shape === 'chat' ? input : responsesToChatInput(input), lease.signal)
  } catch (error) {
    lease.release()
    return openAiError(error instanceof Error ? error.message : String(error), 'invalid_request_error', 400)
  }
  const stream = input.stream === true
  try {
    const chunks = runtime.modelClient.stream(modelRequest)
    return stream
      ? streamingResponse(chunks, model, shape, lease)
      : nonStreamingResponse(chunks, model, shape, lease)
  } catch (error) {
    lease.release()
    return openAiError(errorMessage(error), 'upstream_error', 502)
  }
}

function makeModelRequest(input: Record<string, unknown>, signal: AbortSignal): ModelRequest {
  const model = stringValue(input.model)
  if (!model) throw new Error('model is required')
  const rawMessages = Array.isArray(input.messages) ? input.messages : []
  if (rawMessages.length === 0) throw new Error('messages or input is required')
  const now = new Date().toISOString()
  const threadId = `gateway_${randomUUID()}`
  const turnId = `turn_${randomUUID()}`
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
    providerId: LOCAL_MODEL_GATEWAY_PROVIDER_ID,
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

function responsesToChatInput(input: Record<string, unknown>): Record<string, unknown> {
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

async function nonStreamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, shape: 'chat' | 'responses', lease: GatewayLease): Promise<JsonResponse> {
  let text = ''
  let reasoning = ''
  let usage: unknown
  const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
  const iterator = chunks[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) {
        completed = true
        break
      }
      const chunk = result.value
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      else if (chunk.kind === 'assistant_reasoning_delta') reasoning += chunk.text
      else if (chunk.kind === 'tool_call_complete') toolCalls.push({ id: chunk.callId, type: 'function', function: { name: chunk.toolName, arguments: JSON.stringify(chunk.arguments) } })
      else if (chunk.kind === 'usage') usage = chunk.usage
      else if (chunk.kind === 'error') return openAiError(chunk.message, chunk.code ?? 'upstream_error', errorStatus(chunk))
    }
  } catch (error) {
    return openAiError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 'timeout' : 'upstream_error', lease.timedOut() ? 504 : 502)
  } finally {
    if (!completed) await iterator.return?.().catch(() => undefined)
    lease.release()
  }
  const id = `${shape === 'chat' ? 'chatcmpl' : 'resp'}_${randomUUID()}`
  if (shape === 'chat') {
    return jsonResponse({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], ...(usage ? { usage } : {}) })
  }
  return jsonResponse({ id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }, ...toolCalls.map((call) => ({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }))], ...(usage ? { usage } : {}) })
}

function streamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, shape: 'chat' | 'responses', lease: GatewayLease): Response {
  const encoder = new TextEncoder()
  const id = `${shape === 'chat' ? 'chatcmpl' : 'resp'}_${randomUUID()}`
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let responseStarted = false
  const closeIterator = async (): Promise<void> => {
    if (iteratorClosed) return
    iteratorClosed = true
    await iterator.return?.().catch(() => undefined)
  }
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, closeUpstream: boolean): Promise<void> => {
    if (finished) return
    finished = true
    if (closeUpstream) await closeIterator()
    lease.release()
    if (!cancelled) controller.close()
  }
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown): void => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished || cancelled) return
      try {
        if (shape === 'responses' && !responseStarted) {
          responseStarted = true
          send(controller, { type: 'response.created', response: { id, object: 'response', status: 'in_progress', model } })
          return
        }
        const result = await nextGatewayChunk(iterator, lease.signal)
        if (result.done) {
          iteratorClosed = true
          if (shape === 'chat') {
            send(controller, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          } else {
            send(controller, { type: 'response.completed', response: { id, object: 'response', status: 'completed', model } })
          }
          await finish(controller, false)
          return
        }
        const chunk = result.value
        if (chunk.kind === 'completed') {
          if (shape === 'chat') {
            send(controller, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          } else {
            send(controller, { type: 'response.completed', response: { id, object: 'response', status: 'completed', model } })
          }
          await finish(controller, true)
          return
        }
        if (chunk.kind === 'error') {
          if (shape === 'chat') send(controller, { error: { message: chunk.message, type: 'upstream_error', code: chunk.code ?? 'upstream_error' } })
          else send(controller, { type: 'error', error: { message: chunk.message, type: 'upstream_error', code: chunk.code ?? 'upstream_error' } })
          await finish(controller, true)
          return
        }
        if (shape === 'chat') {
          if (chunk.kind === 'assistant_text_delta') send(controller, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }] })
          else if (chunk.kind === 'assistant_reasoning_delta') send(controller, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { reasoning_content: chunk.text }, finish_reason: null }] })
          else if (chunk.kind === 'tool_call_complete') send(controller, { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: chunk.callId, type: 'function', function: { name: chunk.toolName, arguments: JSON.stringify(chunk.arguments) } }] }, finish_reason: null }] })
        } else {
          if (chunk.kind === 'assistant_text_delta') send(controller, { type: 'response.output_text.delta', response_id: id, delta: chunk.text })
          else if (chunk.kind === 'assistant_reasoning_delta') send(controller, { type: 'response.reasoning_text.delta', response_id: id, delta: chunk.text })
          else if (chunk.kind === 'tool_call_complete') send(controller, { type: 'response.function_call_arguments.done', response_id: id, item_id: chunk.callId, name: chunk.toolName, arguments: JSON.stringify(chunk.arguments) })
        }
      } catch (error) {
        if (!cancelled) send(controller, { error: { message: lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), type: 'gateway_error', code: lease.timedOut() ? 'timeout' : 'gateway_error' } })
        await finish(controller, true)
      }
    },
    async cancel() {
      cancelled = true
      lease.cancel()
      await closeIterator()
      if (!finished) {
        finished = true
        lease.release()
      }
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}

function parseTools(value: unknown): ModelToolSpec[] {
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

function messageContent(value: unknown, attachments: NonNullable<ModelRequest['attachments']>, messageIndex: number): string {
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

async function nextGatewayChunk(
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

function authorizePublicGateway(runtime: ServerRuntime, request: Request): JsonResponse | null {
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  if (!guard.consumeToken()) return openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
  return null
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function openAiError(message: string, code: string, status: number): JsonResponse {
  return jsonResponse({ error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', param: null, code } }, status)
}
function errorStatus(chunk: Extract<ModelStreamChunk, { kind: 'error' }>): number { return chunk.failure?.httpStatus && chunk.failure.httpStatus >= 400 ? chunk.failure.httpStatus : 502 }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function parseArguments(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? asRecord(JSON.parse(value)) : asRecord(value) } catch { return {} } }
