import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  AskManagerInputSchema,
  ReportProgressInputSchema,
  type WorkerCallbackService
} from '../../services/worker-callback-service.js'

/**
 * `POST /v1/worker-callbacks/:action` (05 §5.2): the HTTP twin of the
 * worker callback tools — same `WorkerCallbackService`, same semantics.
 * Callers authenticate with a `kgw_` token carrying the `worker-callback`
 * scope; the grant pins the unit id, so a caller can never act for another
 * worker.
 */

const CALLBACK_BODY_LIMIT_BYTES = 128 * 1024
const ASK_HEARTBEAT_MS = 15_000

const ACTIONS = ['progress', 'ask', 'result', 'context'] as const
type CallbackAction = (typeof ACTIONS)[number]

function bearer(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

function isNotWorker(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is not a worker')
}

export async function workerCallbackResponse(
  runtime: ServerRuntime,
  request: Request,
  action: string,
  opts?: { askHeartbeatMs?: number }
): Promise<Response | JsonResponse> {
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return jsonResponse({ code: 'not_found', message: 'unknown callback action' }, 404)
  }
  const tokens = runtime.harnessTokens
  const callbacks = runtime.ade?.workerCallbacks
  if (!tokens || !callbacks) {
    return jsonResponse({ code: 'unavailable', message: 'worker callbacks are not enabled' }, 503)
  }
  const grant = tokens.verifyScope(bearer(request), 'worker-callback')
  if (!grant) return jsonResponse({ code: 'unauthorized', message: 'unauthorized' }, 401)
  const unitId = grant.threadId

  const body = await readJsonBody(request, CALLBACK_BODY_LIMIT_BYTES)
  if (!body.ok) return body.response
  const input = body.value ?? {}

  try {
    switch (action as CallbackAction) {
      case 'progress':
        return await progressResponse(runtime, callbacks, unitId, input)
      case 'result':
        return jsonResponse(await callbacks.submitResult(unitId, input))
      case 'context':
        return jsonResponse(await callbacks.readManagerContext(unitId, input))
      case 'ask':
        return askStreamingResponse(callbacks, unitId, input, request.signal, opts?.askHeartbeatMs)
    }
  } catch (error) {
    return callbackError(error)
  }
}

/**
 * `report_progress`: dispatched workers go through the shared service;
 * tier-0 terminal agents have no team binding, so the registry applies the
 * same throttled supplementary-field write to their own row.
 */
async function progressResponse(
  runtime: ServerRuntime,
  callbacks: WorkerCallbackService,
  unitId: string,
  input: unknown
): Promise<JsonResponse> {
  try {
    return jsonResponse(await callbacks.reportProgress(unitId, input))
  } catch (error) {
    if (!isNotWorker(error)) throw error
    const parsed = ReportProgressInputSchema.parse(input)
    const status = await runtime.ade?.terminalAgents?.reportProgress(unitId, parsed)
    if (!status) throw error
    if (status === 'unknown') {
      return jsonResponse({ code: 'not_a_worker', message: 'unit is not a dispatched worker' }, 409)
    }
    return jsonResponse({ status })
  }
}

/**
 * `ask` is a long request: whitespace heartbeats keep intermediaries alive
 * while the worker waits on a manager/user answer (05 §5.2). The final body
 * is still a single JSON document — leading blank lines parse as whitespace.
 */
function askStreamingResponse(
  callbacks: WorkerCallbackService,
  unitId: string,
  input: unknown,
  signal: AbortSignal,
  heartbeatMs = ASK_HEARTBEAT_MS
): Response | JsonResponse {
  const parsed = AskManagerInputSchema.safeParse(input)
  if (!parsed.success) {
    return jsonResponse({ code: 'validation_error', message: 'invalid ask body' }, 400)
  }
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (heartbeat) clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode('\n')) } catch { close() }
      }, heartbeatMs)
      heartbeat.unref?.()
      void callbacks.askManager(unitId, parsed.data, signal)
        .then((result) => {
          try { controller.enqueue(encoder.encode(JSON.stringify(result))) } catch { /* closed */ }
          close()
        })
        .catch((error) => {
          const code = isNotWorker(error) ? 'not_a_worker' : 'callback_error'
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ status: 'error', code })))
          } catch { /* closed */ }
          close()
        })
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
    }
  })
  return new Response(stream, {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function callbackError(error: unknown): JsonResponse {
  if (error instanceof z.ZodError) {
    return jsonResponse({ code: 'validation_error', message: 'invalid callback body' }, 400)
  }
  if (isNotWorker(error)) {
    return jsonResponse({ code: 'not_a_worker', message: 'unit is not a dispatched worker' }, 409)
  }
  const message = error instanceof Error ? error.message : 'callback failed'
  return jsonResponse({ code: 'callback_error', message }, 500)
}
