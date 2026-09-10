import { z } from 'zod'
import {
  ModelConnectionConflictError,
  type ModelConnectionRegistry
} from '../../services/model-connection-registry.js'
import type { ModelConnectionOAuthService } from '../../services/model-connection-oauth.js'
import type { OfficialProviderAuthService } from '../../services/official-provider-cli.js'
import { ModelConnectionOAuthSubmitRequestSchema } from '../../contracts/model-connections.js'
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

export async function probeModelConnection(
  registry: ModelConnectionRegistry | undefined,
  providerId: string
): Promise<JsonResponse> {
  return mutate(registry, () => registry!.probe(providerId))
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
