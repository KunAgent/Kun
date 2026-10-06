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
import { gatewayUpstream, gatewayCallerId } from './gateway-upstream.js'
import { geminiIncludeThoughts, geminiToChatInput } from './gemini-gateway-input.js'
import {
  acquireHarnessGrantLease,
  acquirePublicGatewayLease,
  asRecord,
  authorizeGateway,
  errorMessage,
  errorStatus,
  estimateModelRequestTokens,
  gatewayAffinityIdentity,
  gatewayClientInput,
  gatewayDispatchAuthorization,
  gatewayRunningTurnId,
  listGatewayModels,
  makeModelRequest,
  MAX_GATEWAY_BODY_BYTES,
  nextGatewayChunk,
  recordHarnessGatewayUsage,
  resolveGatewayModel
} from './model-gateway-core.js'

/**
 * Google Gemini ingress (`/v1beta/models/{model}:generateContent`,
 * `:streamGenerateContent`, `:countTokens`, `GET /v1beta/models`) so Gemini
 * CLI and other Gemini-native agents can use any Kun model. The request is
 * translated into the same canonical model request the other protocols use;
 * routing, budgets and accounting are shared.
 */
const STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND',
  429: 'RESOURCE_EXHAUSTED', 499: 'CANCELLED', 500: 'INTERNAL', 503: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED'
}

export function geminiError(message: string, status: number): JsonResponse {
  return jsonResponse({ error: { code: status, message, status: STATUS_NAMES[status] ?? (status >= 500 ? 'INTERNAL' : 'FAILED_PRECONDITION') } }, status)
}

type Action = 'generateContent' | 'streamGenerateContent' | 'countTokens'

function parseCall(call: string): { model: string; action: Action } | null {
  const index = call.lastIndexOf(':')
  if (index <= 0) return null
  const model = call.slice(0, index).replace(/^models\//, '')
  const action = call.slice(index + 1)
  return model && (action === 'generateContent' || action === 'streamGenerateContent' || action === 'countTokens')
    ? { model, action } : null
}

async function authorizeGemini(runtime: ServerRuntime, request: Request) {
  const verdict = await authorizeGateway(runtime, request)
  if (verdict.ok) return verdict
  if (verdict.reason === 'unavailable') return geminiError('Gateway policy is unavailable.', 503)
  if (verdict.reason === 'forbidden') return geminiError('This protocol is not allowed for the gateway key.', 403)
  return verdict.reason === 'rate_limited' ? geminiError('Gateway rate limit exceeded.', 429) : geminiError('Invalid gateway API key.', 401)
}

export async function geminiModels(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const verdict = await authorizeGemini(runtime, request)
  if (!('ok' in verdict)) return verdict
  if (!runtime.modelGateway?.enabled()) return geminiError('Local model gateway is disabled.', 404)
  const auth = verdict.auth
  try {
    const data = await listGatewayModels(runtime, auth.kind === 'harness' ? auth.grant : undefined,
      auth.kind === 'public' ? auth.policy : undefined, auth.kind === 'public' ? auth.policyRevision : undefined)
    return jsonResponse({ models: data.map((entry) => {
      const model = entry as Record<string, unknown>
      return {
        name: `models/${entry.id}`, baseModelId: entry.id, version: '1',
        displayName: typeof model.display_name === 'string' ? model.display_name : entry.id,
        ...(typeof model.context_window === 'number' ? { inputTokenLimit: model.context_window } : {}),
        ...(typeof model.max_output_tokens === 'number' ? { outputTokenLimit: model.max_output_tokens } : {}),
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
        ...(typeof model.reasoning === 'boolean' ? { thinking: model.reasoning } : {})
      }
    }) })
  } catch {
    return geminiError('Gateway configuration changed; retry discovery.', 503)
  }
}

export async function geminiGenerate(runtime: ServerRuntime, request: Request, call: string): Promise<Response | JsonResponse> {
  const parsed = parseCall(call)
  if (!parsed) return geminiError(`Unsupported Gemini method '${call}'.`, 404)
  const verdict = await authorizeGemini(runtime, request)
  if (!('ok' in verdict)) return verdict
  const auth = verdict.auth
  const grant = auth.kind === 'harness' ? auth.grant : undefined
  const publicAuth = auth.kind === 'public' ? auth : undefined
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return geminiError('Local model gateway is disabled.', 404)
  const lease = grant ? acquireHarnessGrantLease(grant, request.signal) : acquirePublicGatewayLease(runtime, request, auth)
  if (!lease) return geminiError('Too many concurrent gateway requests.', 429)
  let release = true
  try {
    const body = await readJsonBody(request, grant?.maxBodyBytes ?? publicAuth?.policy?.maxBodyBytes ?? MAX_GATEWAY_BODY_BYTES, lease.signal)
      .catch((error: unknown) => { throw Object.assign(new Error(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error)), { status: lease.timedOut() ? 504 : 400 }) })
    if (!body.ok) return geminiError(JSON.parse(body.response.body).message, body.response.status)
    const raw = asRecord(body.value)
    const stream = parsed.action === 'streamGenerateContent'
    let input: Record<string, unknown>
    try { input = geminiToChatInput(parsed.model, raw, stream) } catch (error) { return geminiError(errorMessage(error), 400) }
    let resolved: Awaited<ReturnType<typeof resolveGatewayModel>>
    try {
      resolved = await resolveGatewayModel(runtime, parsed.model, grant, publicAuth?.policy, publicAuth?.policyRevision)
    } catch {
      return geminiError('Gateway model registry is unavailable.', 503)
    }
    if (!resolved) return geminiError(`models/${parsed.model} is not found.`, 404)
    if (parsed.action === 'countTokens') {
      try {
        const counted = makeModelRequest({ ...input, model: resolved.model }, lease.signal, resolved.providerId)
        return jsonResponse({ totalTokens: estimateModelRequestTokens(counted) })
      } catch (error) { return geminiError(errorMessage(error), 400) }
    }
    let turnId: string | undefined
    try { turnId = grant ? await gatewayRunningTurnId(runtime, grant.threadId) : undefined } catch {
      return geminiError('Gateway thread attribution is unavailable.', 503)
    }
    let modelRequest: ModelRequest
    let recorder: GatewayUsageRecorder | undefined
    try {
      const normalized = gatewayClientInput(input, auth)
      recorder = await beginGatewayUsage(runtime, auth, request, parsed.model, resolved)
      modelRequest = makeModelRequest({ ...normalized, model: resolved.model }, lease.signal, resolved.providerId,
        recorder?.attribution ?? (grant ? { threadId: grant.threadId, turnId: turnId ?? `gateway_${grant.grantId}` } : undefined))
      modelRequest.gatewayRouting = { ...resolved.gatewayRouting, callerId: gatewayCallerId(auth),
        affinity: gatewayAffinityIdentity(request, auth, turnId),
        beforeDispatch: gatewayDispatchAuthorization(runtime, request, auth, resolved.gatewayRouting.beforeDispatch) }
    } catch (error) {
      await recorder?.finish('failed').catch(() => undefined)
      return geminiError(errorMessage(error), error instanceof GatewayUsageError ? error.status : 400)
    }
    modelRequest.requestId = modelRequest.turnId
    modelRequest.deadlineAt = lease.deadlineAt ?? Date.now() + 120_000
    modelRequest.attemptObserver = gatewayAttemptAccounting(runtime, auth, recorder, modelRequest.turnId)
    const attribute = grant ? (usage?: UsageSnapshot) => recordHarnessGatewayUsage(runtime, grant, resolved!, usage, turnId) : undefined
    const chunks = wrapGatewayUsage(harnessGatewayStream(gatewayUpstream(runtime, request, auth, modelRequest, parsed.model), grant), recorder, {
      timedOut: lease.timedOut, cancelled: () => lease.signal.aborted && !lease.timedOut()
    })
    release = false
    const output = new GeminiOutput(parsed.model, geminiIncludeThoughts(raw))
    return stream ? geminiStream(chunks, output, lease, attribute) : geminiJson(chunks, output, lease, attribute)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400
    return geminiError(errorMessage(error), status)
  } finally {
    if (release) lease.release()
  }
}

/** Accumulates canonical chunks into Gemini parts. */
class GeminiOutput {
  usage?: UsageSnapshot
  stopReason?: 'stop' | 'tool_calls' | 'length' | 'error'
  private readonly parts: Record<string, unknown>[] = []
  private readonly toolArgs = new Map<string, { name: string; json: string }>()

  constructor(readonly model: string, private readonly includeThoughts: boolean) {}

  /** Returns the parts this chunk contributes (for streaming), and keeps them for the final response. */
  accept(chunk: ModelStreamChunk): Record<string, unknown>[] {
    if (chunk.kind === 'assistant_text_delta' && chunk.text) return this.keep({ text: chunk.text })
    if (chunk.kind === 'assistant_reasoning_delta' && chunk.text && this.includeThoughts) return this.keep({ text: chunk.text, thought: true })
    if (chunk.kind === 'tool_call_delta') {
      const entry = this.toolArgs.get(chunk.callId) ?? { name: chunk.toolName ?? '', json: '' }
      entry.name = chunk.toolName ?? entry.name
      entry.json += chunk.argumentsDelta ?? ''
      this.toolArgs.set(chunk.callId, entry)
      return []
    }
    if (chunk.kind === 'tool_call_complete') {
      this.toolArgs.delete(chunk.callId)
      return this.keep({ functionCall: { id: chunk.callId, name: chunk.toolName, args: chunk.arguments } })
    }
    if (chunk.kind === 'image_generation_complete') return this.keep({ inlineData: { mimeType: chunk.mimeType, data: chunk.imageBase64 } })
    if (chunk.kind === 'usage') this.usage = chunk.usage
    if (chunk.kind === 'completed') {
      this.stopReason = chunk.stopReason
      const flushed: Record<string, unknown>[] = []
      for (const [callId, entry] of this.toolArgs) {
        let args: unknown = {}
        try { args = entry.json ? JSON.parse(entry.json) : {} } catch { throw new Error('Upstream tool arguments are not valid JSON') }
        flushed.push(...this.keep({ functionCall: { id: callId, name: entry.name, args } }))
      }
      this.toolArgs.clear()
      return flushed
    }
    return []
  }

  frame(parts: Record<string, unknown>[], final: boolean): Record<string, unknown> {
    return {
      candidates: [{ content: { role: 'model', parts }, index: 0,
        ...(final ? { finishReason: this.stopReason === 'length' ? 'MAX_TOKENS' : 'STOP' } : {}) }],
      ...(final ? { usageMetadata: geminiUsage(this.usage) } : {}),
      modelVersion: this.model
    }
  }

  result(): Record<string, unknown> {
    return this.frame(this.parts, true)
  }

  private keep(part: Record<string, unknown>): Record<string, unknown>[] {
    const last = this.parts.at(-1)
    // Merge adjacent text deltas of the same kind so a JSON response has whole parts.
    if (last && typeof last.text === 'string' && typeof part.text === 'string' && Boolean(last.thought) === Boolean(part.thought)) {
      last.text += part.text
    } else this.parts.push({ ...part })
    return [part]
  }
}

function geminiUsage(usage: UsageSnapshot | undefined): Record<string, number> {
  const prompt = usage?.promptTokens ?? 0
  const output = usage?.completionTokens ?? 0
  const cached = usage?.cacheHitTokens ?? usage?.cachedTokens
  return {
    promptTokenCount: prompt,
    candidatesTokenCount: Math.max(0, output - (usage?.reasoningTokens ?? 0)),
    totalTokenCount: prompt + output,
    ...(cached !== undefined ? { cachedContentTokenCount: cached } : {}),
    ...(usage?.reasoningTokens !== undefined ? { thoughtsTokenCount: usage.reasoningTokens } : {})
  }
}

async function geminiJson(chunks: GatewayUsageStream, output: GeminiOutput, lease: GatewayLease,
  attribute?: (usage?: UsageSnapshot) => Promise<void>): Promise<JsonResponse> {
  const iterator = chunks[Symbol.asyncIterator]()
  let exhausted = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) { exhausted = true; throw new Error('Upstream stream ended without a completion marker') }
      const chunk = result.value
      if (chunk.kind === 'error') {
        await chunks.finish('failed')
        return geminiError(chunk.message, errorStatus(chunk))
      }
      output.accept(chunk)
      if (chunk.kind === 'completed') {
        if (chunk.stopReason === 'error') throw new Error('Upstream generation ended with an error')
        break
      }
    }
    const response = jsonResponse(output.result())
    await chunks.finish('completed')
    return response
  } catch (error) {
    await chunks.finish('failed').catch(() => undefined)
    return geminiError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error),
      lease.timedOut() ? 504 : error instanceof GatewayUsageError ? error.status : 502)
  } finally {
    if (!exhausted) await iterator.return?.().catch(() => undefined)
    await attribute?.(output.usage).catch(() => undefined)
    lease.release()
  }
}

function geminiStream(chunks: GatewayUsageStream, output: GeminiOutput, lease: GatewayLease,
  attribute?: (usage?: UsageSnapshot) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const iterator = chunks[Symbol.asyncIterator]()
  let finished = false
  let cancelled = false
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown): void => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`))
  }
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array> | undefined): Promise<void> => {
    if (finished) return
    finished = true
    await iterator.return?.().catch(() => undefined)
    await attribute?.(output.usage).catch(() => undefined)
    lease.release()
    if (controller && !cancelled) controller.close()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return
      try {
        for (;;) {
          const result = await nextGatewayChunk(iterator, lease.signal)
          if (result.done) throw new Error('Upstream stream ended without a completion marker')
          const chunk = result.value
          if (chunk.kind === 'error') {
            await chunks.finish('failed')
            send(controller, { error: { code: errorStatus(chunk), message: chunk.message, status: STATUS_NAMES[errorStatus(chunk)] ?? 'INTERNAL' } })
            await finish(controller)
            return
          }
          const parts = output.accept(chunk)
          if (chunk.kind === 'completed') {
            if (chunk.stopReason === 'error') throw new Error('Upstream generation ended with an error')
            await chunks.finish('completed')
            send(controller, output.frame(parts, true))
            await finish(controller)
            return
          }
          if (parts.length) {
            send(controller, output.frame(parts, false))
            return
          }
        }
      } catch (error) {
        await chunks.finish(cancelled ? 'cancelled' : 'failed').catch(() => undefined)
        if (!cancelled) send(controller, { error: { code: lease.timedOut() ? 504 : 502,
          message: lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), status: lease.timedOut() ? 'DEADLINE_EXCEEDED' : 'INTERNAL' } })
        await finish(controller)
      }
    },
    async cancel() {
      cancelled = true
      lease.cancel()
      await chunks.finish('cancelled').catch(() => undefined)
      await finish(undefined)
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' } })
}
