import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ModelConnectionConflictError,
  type ModelConnectionRegistry
} from '../../services/model-connection-registry.js'
import type { ModelConnectionOAuthService } from '../../services/model-connection-oauth.js'
import type { OfficialProviderAuthService } from '../../services/official-provider-cli.js'
import { ModelConnectionOAuthSubmitRequestSchema } from '../../contracts/model-connections.js'
import { detectProviderProtocols } from '../../services/model-protocol-detection.js'
import type { ModelClient } from '../../ports/model-client.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function listModelConnections(
  registry: ModelConnectionRegistry | undefined
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  return jsonResponse(await registry.snapshot())
}

export async function connectModelConnection(
  registry: ModelConnectionRegistry | undefined,
  request: Request
): Promise<JsonResponse> {
  return mutate(registry, async () => registry!.connect(await readJson(request)), 201)
}

export async function patchModelConnection(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  return mutate(registry, async () => registry!.patch(providerId, await readJson(request)))
}

export async function replaceModelCredential(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  return mutate(registry, async () => {
    const input = await readJson(request)
    return hasCredentialOperationToken(input)
      ? registry!.prepareCredential(providerId, input)
      : registry!.replaceCredential(providerId, input)
  })
}

export async function commitModelCredential(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  return mutate(
    registry,
    async () => registry!.commitPreparedCredential(providerId, await readJson(request))
  )
}

export async function fenceModelCredential(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  return mutate(
    registry,
    async () => registry!.fenceCredential(providerId, await readJson(request))
  )
}

export async function clearModelCredential(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  const revision = Number(new URL(request.url).searchParams.get('expected_revision'))
  if (!Number.isInteger(revision) || revision < 0) {
    return ERRORS.validation('expected_revision query parameter is required')
  }
  return mutate(registry, () => registry!.clearCredential(providerId, revision))
}

export async function deleteModelConnection(
  registry: ModelConnectionRegistry | undefined,
  providerId: string,
  request: Request
): Promise<JsonResponse> {
  const revision = Number(new URL(request.url).searchParams.get('expected_revision'))
  if (!Number.isInteger(revision) || revision < 0) {
    return ERRORS.validation('expected_revision query parameter is required')
  }
  return mutate(registry, () => registry!.delete(providerId, revision))
}

export async function selectModelConnection(
  registry: ModelConnectionRegistry | undefined,
  request: Request
): Promise<JsonResponse> {
  return mutate(registry, async () => registry!.select(await readJson(request)))
}

export async function updateModelConnectionGlobals(
  registry: ModelConnectionRegistry | undefined,
  request: Request
): Promise<JsonResponse> {
  return mutate(registry, async () => registry!.updateGlobals(await readJson(request)))
}

const ModelConnectionProbeRequestSchema = z.object({
  mode: z.enum(['list', 'inference']).default('list'),
  model: z.string().min(1).max(512).optional()
}).strict()

export async function probeModelConnection(
  runtime: {
    modelConnections?: ModelConnectionRegistry
    modelClient?: ModelClient
    directModelClient?: ModelClient
  } | ModelConnectionRegistry | undefined,
  providerId: string,
  request?: Request
): Promise<JsonResponse> {
  // Back-compat: callers may pass a bare registry with no request body.
  const registry = runtime && 'snapshot' in runtime
    ? runtime as ModelConnectionRegistry
    : (runtime as { modelConnections?: ModelConnectionRegistry } | undefined)?.modelConnections
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  let probeModel: string | undefined
  let mode: 'list' | 'inference' = 'list'
  if (request) {
    const body = await readJson(request)
    if (body !== null) {
      const parsed = ModelConnectionProbeRequestSchema.safeParse(body)
      if (!parsed.success) {
        return ERRORS.validation('invalid probe request', parsed.error.issues)
      }
      mode = parsed.data.mode
      probeModel = parsed.data.model
    }
  }
  if (mode === 'inference') {
    // Probes must hit the exact provider under test: the routed pool client
    // would silently pass a dead key through a healthy alternative and still
    // report success, while writing probe failures into real traffic health.
    // Fall back to the routed client only for embedders that do not expose
    // the direct one (test scaffolds).
    const scoped = runtime && 'snapshot' in runtime
      ? undefined
      : (runtime as { directModelClient?: ModelClient; modelClient?: ModelClient })
    const client = scoped?.directModelClient ?? scoped?.modelClient
    return inferenceProbe(registry, client, providerId, probeModel, request)
  }
  return mutate(registry, () => registry.probe(providerId))
}

const INFERENCE_PROBE_TIMEOUT_MS = 30_000

/**
 * Maps a classified probe failure to the actionable hint shown next to the
 * endpoint row in Settings > Providers.
 */
function inferenceProbeHint(
  reason: string | undefined,
  httpStatus: number | undefined
): string | undefined {
  if (reason === 'auth') return 'Key invalid or revoked — replace the API key.'
  if (reason === 'credit') return 'Account balance exhausted — top up or switch account.'
  if (reason === 'quota') return 'Quota exhausted — wait for reset or switch account.'
  if (reason === 'rate') return 'Rate limited — retry later or lower request rate.'
  if (reason === 'overloaded') return 'Provider overloaded — retry later.'
  if (reason === 'model') return 'Model unavailable on this provider — check the model id.'
  if (reason === 'request') return 'Request rejected — check endpoint format and model capability.'
  if (httpStatus === 404) return 'Check Base URL and Endpoint format.'
  return undefined
}

/**
 * Real inference probe: sends a bounded 1-token request through the routed
 * model client so credential, protocol, and quota failures surface with
 * their classified reason. Unlike the `/models` list probe this proves the
 * provider can actually generate. Probe turns never reach the usage recorder
 * (recording happens in the agent loop, which this bypasses) and never
 * return credential material.
 */
async function inferenceProbe(
  registry: ModelConnectionRegistry,
  client: ModelClient | undefined,
  providerId: string,
  model: string | undefined,
  request: Request | undefined
): Promise<JsonResponse> {
  if (!client) return ERRORS.unavailable('model client is unavailable')
  const snapshot = await registry.snapshot()
  const profile = snapshot.providers.find((entry) => entry.id === providerId)
  if (!profile) return ERRORS.notFound(`model connection ${providerId} not found`)
  const probeModelName = (model ?? '').trim() || profile.selectedModel || profile.models[0] || ''
  if (!probeModelName) {
    return jsonResponse({
      ok: false,
      providerId,
      format: profile.endpointFormat,
      latencyMs: 0,
      message: 'Provider has no configured model to probe.'
    })
  }
  const started = Date.now()
  // A Promise.race timeout leaves the upstream request running; instead abort
  // the merged signal so the provider fetch actually tears down.
  const abort = new AbortController()
  const timeoutTimer = setTimeout(() => abort.abort(), INFERENCE_PROBE_TIMEOUT_MS)
  timeoutTimer.unref?.()
  const probeSignal = request?.signal
    ? AbortSignal.any([request.signal, abort.signal])
    : abort.signal
  const run = async (): Promise<JsonResponse> => {
    const turnId = `probe_${randomUUID()}`
    const stream = client.stream({
      threadId: `probe_${providerId}`,
      turnId,
      model: probeModelName,
      providerId,
      systemPrompt: '',
      prefix: [],
      history: [{
        id: 'probe_msg_1',
        turnId,
        threadId: `probe_${providerId}`,
        role: 'user',
        kind: 'user_message',
        status: 'completed',
        createdAt: new Date().toISOString(),
        text: 'ping'
      }],
      tools: [],
      stream: true,
      // OpenAI Responses rejects maxTokens below 16.
      maxTokens: 16,
      // Keep reasoning off so the probe cost stays at a single token.
      reasoningEffort: 'off',
      // Probes must fail fast on the exact target — retrying would hide a
      // dead key behind a slow success and leak into route health.
      maxRetryAttempts: 0,
      abortSignal: probeSignal
    })
    let sawContent = false
    let ttftMs: number | undefined
    let lastError: { message: string; code?: string; reason?: string; httpStatus?: number } | undefined
    for await (const chunk of stream) {
      if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') {
        if (!sawContent) ttftMs = Date.now() - started
        sawContent = true
        // First token is enough proof; stop early so the probe stays cheap
        // even when the provider ignores maxTokens.
        break
      } else if (chunk.kind === 'error') {
        lastError = {
          message: chunk.message,
          ...(chunk.code ? { code: chunk.code } : {}),
          ...(chunk.failure?.reason ? { reason: chunk.failure.reason } : {}),
          ...(chunk.failure?.httpStatus ? { httpStatus: chunk.failure.httpStatus } : {})
        }
        break
      } else if (chunk.kind === 'completed') {
        break
      }
    }
    const latencyMs = Date.now() - started
    const base = { providerId, model: probeModelName, format: profile.endpointFormat }
    if (abort.signal.aborted && !sawContent && !lastError) {
      return jsonResponse({
        ...base,
        ok: false,
        latencyMs,
        reason: 'other',
        message: 'Inference probe timed out.',
        hint: 'Provider did not answer in time — check connectivity and proxy settings.'
      })
    }
    if (request?.signal.aborted && !sawContent && !lastError) {
      return jsonResponse({
        ...base,
        ok: false,
        latencyMs,
        reason: 'other',
        message: 'Inference probe aborted.'
      })
    }
    if (lastError) {
      return jsonResponse({
        ...base,
        ok: false,
        latencyMs,
        ...(ttftMs !== undefined ? { ttftMs } : {}),
        ...lastError,
        hint: inferenceProbeHint(lastError.reason, lastError.httpStatus)
      })
    }
    return jsonResponse({
      ...base,
      ok: true,
      latencyMs,
      ...(ttftMs !== undefined ? { ttftMs } : {})
    })
  }
  try {
    return await run()
  } finally {
    clearTimeout(timeoutTimer)
    abort.abort()
  }
}

/**
 * Protocol detection for the custom-provider add flow: probes the model
 * listing for the OpenAI and Anthropic header families in parallel and can
 * optionally verify ambiguous formats with a bounded inference request.
 */
export async function detectModelConnectionProtocols(
  registry: ModelConnectionRegistry | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  try {
    const snapshot = await registry.snapshot()
    const globalProxy = snapshot.proxy.enabled ? snapshot.proxy.url : ''
    return jsonResponse(await detectProviderProtocols(await readJson(request), globalProxy))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return ERRORS.validation('invalid protocol detection request', error.issues)
    }
    return ERRORS.validation(error instanceof Error ? error.message : String(error))
  }
}

export async function getModelConnectionCatalog(
  registry: ModelConnectionRegistry | undefined,
  providerId: string
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  const catalog = await registry.catalog(providerId)
  if (!catalog) return jsonResponse({ cached: false })
  return jsonResponse({ cached: true, ...catalog })
}

export async function getModelConnectionCustomHeaders(
  registry: ModelConnectionRegistry | undefined,
  providerId: string
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  try {
    return jsonResponse({ customHeaders: await registry.getCustomHeaders(providerId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not found')) return ERRORS.notFound(message)
    return ERRORS.validation(message)
  }
}

export async function modelConnectionEvents(
  registry: ModelConnectionRegistry | undefined,
  request: Request
): Promise<Response | JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  const since = Number(new URL(request.url).searchParams.get('since_revision') ?? '0')
  if (!Number.isInteger(since) || since < 0) return ERRORS.validation('invalid since_revision')
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return modelConnectionEventStream(registry, request, since)
  }
  const waitRaw = new URL(request.url).searchParams.get('wait_ms')
  const waitMs = waitRaw === null ? 0 : Number(waitRaw)
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30_000) {
    return ERRORS.validation('invalid wait_ms')
  }
  const snapshot = waitMs > 0
    ? await registry.waitForRevision(since, request.signal, waitMs)
    : await registry.snapshot()
  return jsonResponse({ changed: snapshot.revision > since, snapshot })
}

function modelConnectionEventStream(
  registry: ModelConnectionRegistry,
  request: Request,
  sinceRevision: number
): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let removeAbort: (() => void) | undefined
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return
        closed = true
        unsubscribe?.()
        unsubscribe = undefined
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        removeAbort?.()
        removeAbort = undefined
        try { controller.close() } catch { /* consumer already closed */ }
      }
      const send = (snapshot: Awaited<ReturnType<ModelConnectionRegistry['snapshot']>>): void => {
        if (closed || snapshot.revision <= sinceRevision) return
        try {
          controller.enqueue(encoder.encode(
            `id: ${snapshot.revision}\nevent: model_connections\ndata: ${JSON.stringify(snapshot)}\n\n`
          ))
        } catch {
          close()
        }
      }
      const abort = (): void => close()
      request.signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => request.signal.removeEventListener('abort', abort)
      unsubscribe = registry.subscribe(send)
      void registry.snapshot().then(send, close)
      heartbeat = setInterval(() => {
        if (closed) return
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch { close() }
      }, 15_000)
      heartbeat.unref?.()
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
      removeAbort?.()
    }
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

export async function startModelConnectionOAuth(
  service: ModelConnectionOAuthService | undefined,
  request: Request
): Promise<JsonResponse> {
  return oauthAction(service, async () => service!.start(await readJson(request)), 201)
}

export async function modelConnectionOAuthStatus(
  service: ModelConnectionOAuthService | undefined,
  sessionId: string
): Promise<JsonResponse> {
  return oauthAction(service, () => service!.status(sessionId))
}

export async function submitModelConnectionOAuth(
  service: ModelConnectionOAuthService | undefined,
  sessionId: string,
  request: Request
): Promise<JsonResponse> {
  return oauthAction(service, async () => {
    const input = ModelConnectionOAuthSubmitRequestSchema.parse(await readJson(request))
    return service!.submit(sessionId, input.code)
  })
}

export async function cancelModelConnectionOAuth(
  service: ModelConnectionOAuthService | undefined,
  sessionId: string
): Promise<JsonResponse> {
  return oauthAction(service, () => service!.cancel(sessionId))
}

export async function claudeSdkStatus(
  service: ModelConnectionOAuthService | undefined
): Promise<JsonResponse> {
  return oauthAction(service, () => service!.claudeSdkStatus())
}

export async function installClaudeSdk(
  service: ModelConnectionOAuthService | undefined
): Promise<JsonResponse> {
  return oauthAction(service, () => service!.installClaudeSdk(), 202)
}

export async function completeOfficialProviderAuth(
  service: OfficialProviderAuthService | undefined,
  request: Request
): Promise<JsonResponse> {
  return oauthAction(service, async () => service!.complete(await readJson(request)))
}

async function mutate(
  registry: ModelConnectionRegistry | undefined,
  action: () => Promise<unknown>,
  status = 200
): Promise<JsonResponse> {
  if (!registry) return ERRORS.unavailable('model connection registry is unavailable')
  try {
    return jsonResponse(await action(), status)
  } catch (error) {
    if (error instanceof ModelConnectionConflictError) {
      return jsonResponse({
        code: 'revision_conflict',
        message: error.message,
        snapshot: error.snapshot
      }, 409)
    }
    if (error instanceof z.ZodError) {
      return ERRORS.validation('invalid model connection request', error.issues)
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not found')) return ERRORS.notFound(message)
    return ERRORS.validation(message)
  }
}

async function oauthAction(
  service: ModelConnectionOAuthService | OfficialProviderAuthService | undefined,
  action: () => Promise<unknown> | unknown,
  status = 200
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('model connection OAuth is unavailable')
  try {
    return jsonResponse(await action(), status)
  } catch (error) {
    if (error instanceof ModelConnectionConflictError) {
      return jsonResponse({
        code: 'revision_conflict', message: error.message, snapshot: error.snapshot
      }, 409)
    }
    if (error instanceof z.ZodError) return ERRORS.validation('invalid OAuth request', error.issues)
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('not found')) return ERRORS.notFound(message)
    return ERRORS.validation(message)
  }
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

function hasCredentialOperationToken(value: unknown): value is { operationToken: unknown } {
  return typeof value === 'object' && value !== null && 'operationToken' in value
}
