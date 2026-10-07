import { harnessGatewayStream } from './harness-gateway-stream.js'
import { gatewayAttemptAccounting } from './gateway-attempt-accounting.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { readJsonBody } from '../read-json-body.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as jsonResponse } from './gateway-json-response.js'
import type { GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import { beginGatewayUsage, wrapGatewayUsage, GatewayUsageError, type GatewayUsageRecorder, type GatewayUsageStream } from './gateway-usage.js'
import { ResponsesToolNamespaces } from './responses-tool-namespaces.js'
import { OpenAiGatewayOutput } from './openai-gateway-output.js'
import { gatewayUpstream } from './gateway-upstream.js'
import { admitGatewayStream, failureRetryHeaders, GATEWAY_BUSY_MESSAGE, GATEWAY_BUSY_RETRY_MS, gatewayRetryHeaders, rateLimitedMessage, withResponseHeaders } from './gateway-retry.js'
import { gatewayModelsText } from './gateway-models-catalog.js'
import {
  acquireHarnessGrantLease,
  acquirePublicGatewayLease,
  gatewayClientInput,
  gatewayDispatchAuthorization,
  gatewayAffinityIdentity,
  asRecord,
  authorizeGateway,
  errorMessage,
  errorStatus,
  gatewayExportStatus,
  listGatewayModels,
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
  const verdict = await authorizeGateway(runtime, request)
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') return openAiError('Gateway policy is unavailable.', 'gateway_unavailable', 503)
    if (verdict.reason === 'forbidden') return openAiError('This protocol is not allowed for the gateway key.', 'permission_denied', 403)
    return verdict.reason === 'rate_limited'
      ? withResponseHeaders(openAiError(rateLimitedMessage(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS), 'rate_limit_exceeded', 429), gatewayRetryHeaders(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS))
      : openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  }
  const grant = verdict.auth.kind === 'harness' ? verdict.auth.grant : undefined
  if (!runtime.modelGateway?.enabled()) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  try {
    const publicAuth = verdict.auth.kind === 'public' ? verdict.auth : undefined
    const data = await listGatewayModels(runtime, grant, publicAuth?.policy, publicAuth?.policyRevision)
    if (new URL(request.url).searchParams.get('format') === 'text') {
      return { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: gatewayModelsText(data) }
    }
    return jsonResponse({ object: 'list', data })
  } catch { return openAiError('Gateway configuration changed; retry discovery.', 'gateway_unavailable', 503) }
}

export async function gatewayChatCompletions(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  return gatewayGenerate(runtime, request, 'chat')
}

export async function gatewayResponses(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  return gatewayGenerate(runtime, request, 'responses')
}

export async function routePoolStatus(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.modelGateway) {
    return jsonResponse({ localGateway: { enabled: false }, pools: [], configuredPools: [], metrics: {}, events: [], tests: [], exportableModelIds: [], gatewayExportPools: [] })
  }
  return jsonResponse({
    localGateway: {
      enabled: runtime.modelGateway.enabled(),
      exposeProviderModels: runtime.modelGateway.exposeProviderModels()
    },
    pools: runtime.modelGateway.pools(),
    configuredPools: runtime.modelGateway.configuredPools(),
    ...await gatewayExportStatus(runtime),
    ...runtime.modelGateway.health.snapshot(),
    tests: runtime.modelGateway.tests.list()
  })
}

export function gatewayCredentialStatus(runtime: ServerRuntime): JsonResponse {
  const credentials = runtime.modelGateway?.credentials
  const credential = credentials?.status() ?? { configured: false }
  return jsonResponse({ credential, activeCredentials: credentials?.hasActiveCredentials?.() ?? credentials?.hasKey?.() ?? credential.configured })
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
  const verdict = await authorizeGateway(runtime, request)
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') return openAiError('Gateway policy is unavailable.', 'gateway_unavailable', 503)
    if (verdict.reason === 'forbidden') return openAiError('This protocol is not allowed for the gateway key.', 'permission_denied', 403)
    return verdict.reason === 'rate_limited'
      ? withResponseHeaders(openAiError(rateLimitedMessage(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS), 'rate_limit_exceeded', 429), gatewayRetryHeaders(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS))
      : openAiError('Invalid gateway API key.', 'invalid_api_key', 401)
  }
  const grant = verdict.auth.kind === 'harness' ? verdict.auth.grant : undefined
  const publicAuth = verdict.auth.kind === 'public' ? verdict.auth : undefined
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return openAiError('Local model gateway is disabled.', 'gateway_disabled', 404)
  const lease = grant
    ? acquireHarnessGrantLease(grant, request.signal)
    : acquirePublicGatewayLease(runtime, request, verdict.auth)
  if (!lease) return withResponseHeaders(openAiError(GATEWAY_BUSY_MESSAGE, 'concurrency_limit', 429), gatewayRetryHeaders(GATEWAY_BUSY_RETRY_MS))
  let body: Awaited<ReturnType<typeof readJsonBody>>
  try {
    body = await readJsonBody(request, grant?.maxBodyBytes ?? publicAuth?.policy?.maxBodyBytes ?? MAX_GATEWAY_BODY_BYTES, lease.signal)
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
  let resolved: Awaited<ReturnType<typeof resolveGatewayModel>>
  try {
    resolved = model ? await resolveGatewayModel(runtime, model, grant, publicAuth?.policy, publicAuth?.policyRevision) : null
  } catch {
    lease.release()
    return openAiError('Gateway model registry is unavailable.', 'gateway_unavailable', 503)
  }
  if (!resolved) {
    lease.release()
    return openAiError(`The model '${model || '(missing)'}' does not exist.`, 'model_not_found', 404)
  }
  let turnId: string | undefined
  try { turnId = grant ? await gatewayRunningTurnId(runtime, grant.threadId) : undefined } catch {
    lease.release()
    return openAiError('Gateway thread attribution is unavailable.', 'gateway_unavailable', 503)
  }
  let modelRequest: ModelRequest
  let recorder: GatewayUsageRecorder | undefined
  let namespaces: ResponsesToolNamespaces | undefined
  try {
    namespaces = shape === 'responses' ? new ResponsesToolNamespaces(input) : undefined
    const normalized = gatewayClientInput(shape === 'chat' ? input : responsesToChatInput(input, namespaces), verdict.auth)
    modelRequest = makeModelRequest({ ...normalized, model: resolved.model }, lease.signal, resolved.providerId,
      grant ? { threadId: grant.threadId, turnId: turnId ?? `gateway_${grant.grantId}` } : undefined)
    recorder = await beginGatewayUsage(runtime, verdict.auth, request, model, resolved, input)
    if (recorder) modelRequest = makeModelRequest({ ...normalized, model: resolved.model }, lease.signal, resolved.providerId, recorder.attribution)
    modelRequest.gatewayRouting = { ...resolved.gatewayRouting,
      callerId: grant ? `harness:${grant.grantId}` : `client:${publicAuth?.client?.clientId ?? 'legacy'}`,
      affinity: gatewayAffinityIdentity(request, verdict.auth, turnId, input),
      beforeDispatch: gatewayDispatchAuthorization(runtime, request, verdict.auth, resolved.gatewayRouting.beforeDispatch) }
  } catch (error) {
    lease.release()
    return openAiError(errorMessage(error), error instanceof GatewayUsageError && error.status === 503 ? 'gateway_usage_unavailable' : 'invalid_request_error', error instanceof GatewayUsageError ? error.status : 400)
  }
  modelRequest.requestId = modelRequest.turnId
  modelRequest.deadlineAt = lease.deadlineAt ?? Date.now() + 120_000
  modelRequest.attemptObserver = gatewayAttemptAccounting(runtime, verdict.auth, recorder, modelRequest.turnId)
  const attribute = grant
    ? (usage?: UsageSnapshot) => recordHarnessGatewayUsage(runtime, grant, resolved, usage, turnId)
    : undefined
  const stream = input.stream === true
  try {
    const chunks = wrapGatewayUsage(harnessGatewayStream(gatewayUpstream(runtime, request, verdict.auth, modelRequest, model, resolved.accountId), grant), recorder, {
      timedOut: lease.timedOut, cancelled: () => lease.signal.aborted && !lease.timedOut()
    })
    if (!stream) return nonStreamingResponse(chunks, model, shape, lease, attribute, namespaces)
    const admitted = await admitGatewayStream(chunks, lease.signal)
    if ('refused' in admitted) {
      await chunks.finish('failed').catch(() => undefined)
      lease.release()
      const { refused } = admitted
      return withResponseHeaders(openAiError(refused.message, refused.code ?? 'upstream_error', errorStatus(refused)), failureRetryHeaders(refused.failure))
    }
    return streamingResponse(admitted.chunks, model, shape, lease, attribute, asRecord(input.stream_options).include_usage === true, namespaces)
  } catch (error) {
    await recorder?.finish('failed').catch(() => undefined)
    lease.release()
    return openAiError(errorMessage(error), 'upstream_error', error instanceof GatewayUsageError ? error.status : 502)
  }
}

async function nonStreamingResponse(chunks: GatewayUsageStream, model: string, shape: 'chat' | 'responses', lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>, namespaces?: ResponsesToolNamespaces): Promise<JsonResponse> {
  const output = new OpenAiGatewayOutput(model, shape, namespaces)
  const iterator = chunks[Symbol.asyncIterator]()
  let exhausted = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) { exhausted = true; break }
      const chunk = result.value
      if (chunk.kind === 'error') {
        await chunks.finish('failed')
        return withResponseHeaders(openAiError(chunk.message, chunk.code ?? 'upstream_error', errorStatus(chunk)), failureRetryHeaders(chunk.failure))
      }
      output.accept(chunk)
      if (chunk.kind === 'completed') break
    }
    const response = jsonResponse(output.result())
    await chunks.finish('completed')
    return response
  } catch (error) {
    await chunks.finish('failed').catch(() => undefined)
    return openAiError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 'timeout' : 'upstream_error', lease.timedOut() ? 504 : error instanceof GatewayUsageError ? error.status : 502)
  } finally {
    if (!exhausted) await iterator.return?.().catch(() => undefined)
    await attribute?.(output.usage).catch(() => undefined)
    lease.release()
  }
}

function streamingResponse(chunks: GatewayUsageStream, model: string, shape: 'chat' | 'responses', lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>, includeUsage = false, namespaces?: ResponsesToolNamespaces): Response {
  const encoder = new TextEncoder()
  const output = new OpenAiGatewayOutput(model, shape, namespaces)
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let attributed = false
  const closeIterator = async (): Promise<void> => {
    if (iteratorClosed) return
    iteratorClosed = true
    await iterator.return?.().catch(() => undefined)
  }
  const settleUsage = async (): Promise<void> => {
    if (attributed) return
    attributed = true
    await attribute?.(output.usage).catch(() => undefined)
  }
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
    if (finished) return
    finished = true
    await closeIterator()
    await settleUsage()
    lease.release()
    if (!cancelled) controller.close()
  }
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, values: Record<string, unknown>[]): void => {
    for (const value of values) {
      const event = shape === 'responses' ? `event: ${String(value.type)}\n` : ''
      const payload = shape === 'chat' && includeUsage && value.choices && !('usage' in value) ? { ...value, usage: null } : value
      controller.enqueue(encoder.encode(`${event}data: ${JSON.stringify(payload)}\n\n`))
    }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) { send(controller, output.initial()) },
    async pull(controller) {
      if (finished || cancelled) return
      try {
        // Bookkeeping-only chunks must continue reading or backpressure stalls.
        for (;;) {
          const result = await nextGatewayChunk(iterator, lease.signal)
          if (result.done) iteratorClosed = true
          if (!result.done && result.value.kind === 'error') {
            await chunks.finish('failed')
            send(controller, output.failure(result.value.message, result.value.code ?? 'upstream_error'))
            await finish(controller)
            return
          }
          const events = result.done ? [] : output.accept(result.value)
          if (result.done || result.value.kind === 'completed') {
            const terminal = output.finish(includeUsage)
            await chunks.finish('completed')
            send(controller, [...events, ...terminal])
            if (shape === 'chat') controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            await finish(controller)
            return
          }
          if (events.length) { send(controller, events); return }
        }
      } catch (error) {
        await chunks.finish(cancelled ? 'cancelled' : 'failed').catch(() => undefined)
        if (!cancelled) send(controller, output.failure(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 'timeout' : 'upstream_error'))
        await finish(controller)
      }
    },
    async cancel() {
      cancelled = true
      lease.cancel()
      await chunks.finish('cancelled').catch(() => undefined)
      await closeIterator()
      if (!finished) {
        finished = true
        await settleUsage()
        lease.release()
      }
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' } })
}
