import { randomUUID } from 'node:crypto'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { formatGatewayModelId } from '../../harness/gateway-model-id.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  acquireHarnessGrantLease,
  asRecord,
  authorizeGateway,
  errorMessage,
  errorStatus,
  exposableProvider,
  gatewayRunningTurnId,
  guardFor,
  makeModelRequest,
  MAX_GATEWAY_BODY_BYTES,
  nextGatewayChunk,
  openAiError,
  recordHarnessGatewayUsage,
  resolveGatewayModel,
  responsesToChatInput,
  stringValue
} from './model-gateway-core.js'
export async function gatewayModels(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const verdict = authorizeGateway(runtime, request)
  if (!verdict.ok) {
    return verdict.reason === 'rate_limited'
      ? openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
      : openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  }
  const grant = verdict.auth.kind === 'harness' ? verdict.auth.grant : undefined
  if (!runtime.modelGateway?.enabled()) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  // A grant sees only the routes it was issued for, in kun/ addressing form.
  if (grant) {
    return jsonResponse({
      object: 'list',
      data: grant.routes.map((route) => ({
        id: formatGatewayModelId(route.providerId, route.model),
        object: 'model',
        created: 0,
        owned_by: `kun-harness:${route.role}`
      }))
    })
  }
  const data: { id: string; object: 'model'; created: number; owned_by: string }[] =
    runtime.modelGateway.pools().filter((pool) => pool.enabled).map((pool) => ({
      id: pool.modelId,
      object: 'model',
      created: 0,
      owned_by: 'kun-route-pool'
    }))
  // Plan §6.13 + review fix C2: `providerId/modelId` provider exposure is an
  // explicit opt-in (`localModelGateway.exposeProviderModels`). Only plain
  // HTTP API-key providers may be exposed; subscription, OAuth, and
  // delegated/non-HTTP providers are never listed.
  if (runtime.modelConnections && runtime.modelGateway.exposeProviderModels()) {
    const snapshot = await runtime.modelConnections.snapshot()
    const seen = new Set(data.map((entry) => entry.id))
    for (const provider of snapshot.providers) {
      if (!exposableProvider(provider)) continue
      for (const modelId of provider.models) {
        const id = `${provider.id}/${modelId}`
        if (seen.has(id)) continue
        seen.add(id)
        data.push({ id, object: 'model', created: 0, owned_by: provider.id })
      }
    }
  }
  return jsonResponse({ object: 'list', data })
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
    localGateway: {
      enabled: runtime.modelGateway.enabled(),
      exposeProviderModels: runtime.modelGateway.exposeProviderModels()
    },
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
  const verdict = authorizeGateway(runtime, request)
  if (!verdict.ok) {
    return verdict.reason === 'rate_limited'
      ? openAiError('Gateway rate limit exceeded.', 'rate_limit_exceeded', 429)
      : openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  }
  const grant = verdict.auth.kind === 'harness' ? verdict.auth.grant : undefined
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  const lease = grant
    ? acquireHarnessGrantLease(grant, request.signal)
    : guardFor(runtime)?.acquire(request.signal) ?? null
  if (!lease) return openAiError('Too many concurrent gateway requests.', 'concurrency_limit', 429)
  let body: Awaited<ReturnType<typeof readJsonBody>>
  try {
    body = await readJsonBody(request, grant?.maxBodyBytes ?? MAX_GATEWAY_BODY_BYTES, lease.signal)
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
  const resolved = model ? await resolveGatewayModel(runtime, model, grant) : null
  if (!resolved) {
    lease.release()
    return openAiError(`The model '${model || '(missing)'}' does not exist.`, 'model_not_found', 404)
  }
  const turnId = grant ? await gatewayRunningTurnId(runtime, grant.threadId) : undefined
  let modelRequest: ModelRequest
  try {
    const normalized = shape === 'chat' ? input : responsesToChatInput(input)
    modelRequest = makeModelRequest({ ...normalized, model: resolved.model }, lease.signal, resolved.providerId,
      grant ? { threadId: grant.threadId, turnId: turnId ?? `gateway_${grant.grantId}` } : undefined)
  } catch (error) {
    lease.release()
    return openAiError(error instanceof Error ? error.message : String(error), 'invalid_request_error', 400)
  }
  const attribute = grant
    ? (usage?: UsageSnapshot) => recordHarnessGatewayUsage(runtime, grant, resolved, usage, turnId)
    : undefined
  const stream = input.stream === true
  try {
    const chunks = runtime.modelClient.stream(modelRequest)
    return stream
      ? streamingResponse(chunks, model, shape, lease, attribute)
      : nonStreamingResponse(chunks, model, shape, lease, attribute)
  } catch (error) {
    lease.release()
    return openAiError(errorMessage(error), 'upstream_error', 502)
  }
}

async function nonStreamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, shape: 'chat' | 'responses', lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>): Promise<JsonResponse> {
  let text = ''
  let reasoning = ''
  let usage: UsageSnapshot | undefined
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
    await attribute?.(usage).catch(() => undefined)
    lease.release()
  }
  const id = `${shape === 'chat' ? 'chatcmpl' : 'resp'}_${randomUUID()}`
  if (shape === 'chat') {
    return jsonResponse({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], ...(usage ? { usage } : {}) })
  }
  return jsonResponse({ id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model, output: [{ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }, ...toolCalls.map((call) => ({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }))], ...(usage ? { usage } : {}) })
}

function streamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, shape: 'chat' | 'responses', lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const id = `${shape === 'chat' ? 'chatcmpl' : 'resp'}_${randomUUID()}`
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let attributed = false
  let responseStarted = false
  let lastUsage: UsageSnapshot | undefined
  const closeIterator = async (): Promise<void> => {
    if (iteratorClosed) return
    iteratorClosed = true
    await iterator.return?.().catch(() => undefined)
  }
  const settleUsage = async (): Promise<void> => {
    if (attributed) return
    attributed = true
    await attribute?.(lastUsage).catch(() => undefined)
  }
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, closeUpstream: boolean): Promise<void> => {
    if (finished) return
    finished = true
    if (closeUpstream) await closeIterator()
    await settleUsage()
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
        // A pull that enqueues nothing is not re-invoked, so bookkeeping-only
        // chunks (usage) loop back for another read instead of returning.
        for (;;) {
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
          if (chunk.kind === 'usage') {
            lastUsage = chunk.usage
            continue
          }
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
          return
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
        await settleUsage()
        lease.release()
      }
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}



