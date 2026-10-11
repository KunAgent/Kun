import { harnessGatewayStream } from './harness-gateway-stream.js'
import { gatewayAttemptAccounting } from './gateway-attempt-accounting.js'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { HarnessTokenGrant } from '../../harness/harness-token-service.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { readJsonBody } from '../read-json-body.js'
import type { JsonResponse } from '../response.js'
import { gatewayJsonResponse as jsonResponse } from './gateway-json-response.js'
import type { GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import { beginGatewayUsage, wrapGatewayUsage, GatewayUsageError, type GatewayUsageRecorder, type GatewayUsageStream } from './gateway-usage.js'
import { anthropicToChatInput } from './anthropic-gateway-input.js'
import { gatewayThinkingSignature } from './anthropic-gateway-thinking.js'
import { gatewayUpstream } from './gateway-upstream.js'
import { admitGatewayStream, failureRetryHeaders, GATEWAY_BUSY_MESSAGE, GATEWAY_BUSY_RETRY_MS, gatewayRetryHeaders, rateLimitedMessage, withResponseHeaders } from './gateway-retry.js'
import {
  type GatewayAuth,
  acquireHarnessGrantLease,
  acquirePublicGatewayLease,
  gatewayClientInput,
  gatewayDispatchAuthorization,
  gatewayAffinityIdentity,
  asRecord,
  authorizeGateway,
  errorMessage,
  errorStatus,
  estimateModelRequestTokens,
  gatewayRunningTurnId,
  guardFor,
  makeModelRequest,
  MAX_GATEWAY_BODY_BYTES,
  nextGatewayChunk,
  numberValue,
  recordHarnessGatewayUsage,
  resolveGatewayModel,
  stringValue
} from './model-gateway-core.js'

/**
 * Anthropic wire errors keep the `{ type: 'error', error: { type, message } }`
 * envelope; the nested `type` is derived from the HTTP status per the public
 * Messages API.
 */
function anthropicErrorType(status: number): string {
  switch (status) {
    case 400: return 'invalid_request_error'
    case 401: return 'authentication_error'
    case 403: return 'permission_error'
    case 404: return 'not_found_error'
    case 413: return 'request_too_large'
    case 429: return 'rate_limit_error'
    case 529: return 'overloaded_error'
    default: return 'api_error'
  }
}

function anthropicError(message: string, status: number): JsonResponse {
  const response = jsonResponse({ type: 'error', error: { type: anthropicErrorType(status), message } }, status)
  response.headers['anthropic-version'] = '2023-06-01'
  return response
}

/**
 * Harness `kgw_` grants are checked before public credentials; a failed
 * grant verify falls through to nothing — it is never a public credential.
 */
async function authorizeAnthropicGateway(
  runtime: ServerRuntime,
  request: Request
): Promise<{ grant?: HarnessTokenGrant; auth: GatewayAuth } | JsonResponse> {
  const verdict = await authorizeGateway(runtime, request)
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') return anthropicError('Gateway policy is unavailable.', 503)
    if (verdict.reason === 'forbidden') return anthropicError('This protocol is not allowed for the gateway key.', 403)
    return verdict.reason === 'rate_limited'
      ? withResponseHeaders(anthropicError(rateLimitedMessage(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS), 429), gatewayRetryHeaders(verdict.retryAfterMs ?? GATEWAY_BUSY_RETRY_MS))
      : anthropicError('Invalid gateway API key.', 401)
  }
  return { auth: verdict.auth, grant: verdict.auth.kind === 'harness' ? verdict.auth.grant : undefined }
}

/** Per-grant concurrency/body limits replace the public guard's when a `kgw_` grant authorized the request. */
function acquireGatewayLease(runtime: ServerRuntime, request: Request, grant: HarnessTokenGrant | undefined, auth: GatewayAuth): GatewayLease | null {
  return grant ? acquireHarnessGrantLease(grant, request.signal) : acquirePublicGatewayLease(runtime, request, auth)
}

function anthropicStopReason(
  stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined,
  sawToolUse: boolean
): 'end_turn' | 'max_tokens' | 'tool_use' {
  if (stopReason === 'length') return 'max_tokens'
  if (stopReason === 'tool_calls' || sawToolUse) return 'tool_use'
  return 'end_turn'
}

export async function gatewayMessages(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  const gate = await authorizeAnthropicGateway(runtime, request)
  if ('status' in gate) return gate
  const grant = gate.grant
  const publicAuth = gate.auth.kind === 'public' ? gate.auth : undefined
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return anthropicError('Local model gateway is disabled.', 404)
  const lease = acquireGatewayLease(runtime, request, grant, gate.auth)
  if (!lease) return withResponseHeaders(anthropicError(GATEWAY_BUSY_MESSAGE, 429), gatewayRetryHeaders(GATEWAY_BUSY_RETRY_MS))
  let body: Awaited<ReturnType<typeof readJsonBody>>
  try {
    body = await readJsonBody(request, grant?.maxBodyBytes ?? publicAuth?.policy?.maxBodyBytes ?? MAX_GATEWAY_BODY_BYTES, lease.signal)
  } catch (error) {
    lease.release()
    return anthropicError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 504 : 400)
  }
  if (!body.ok) {
    lease.release()
    return anthropicError(JSON.parse(body.response.body).message, body.response.status)
  }
  let input: Record<string, unknown>
  try {
    input = anthropicToChatInput(asRecord(body.value))
  } catch (error) {
    lease.release()
    return anthropicError(error instanceof Error ? error.message : String(error), 400)
  }
  const model = stringValue(input.model)
  let resolved: Awaited<ReturnType<typeof resolveGatewayModel>>
  try {
    resolved = model ? await resolveGatewayModel(runtime, model, grant, publicAuth?.policy, publicAuth?.policyRevision) : null
  } catch {
    lease.release()
    return anthropicError('Gateway model registry is unavailable.', 503)
  }
  if (!resolved) {
    lease.release()
    return anthropicError(`The model '${model || '(missing)'}' does not exist.`, 404)
  }
  // Grant requests run under the grant's thread and the currently running
  // turn when one exists, so items and usage attribute to the real turn.
  let turnId: string | undefined
  try { turnId = grant ? await gatewayRunningTurnId(runtime, grant.threadId) : undefined } catch {
    lease.release()
    return anthropicError('Gateway thread attribution is unavailable.', 503)
  }
  let modelRequest: ModelRequest
  try {
    modelRequest = makeModelRequest(gatewayClientInput({ ...input, model: resolved.model }, gate.auth), lease.signal, resolved.providerId,
      grant ? { threadId: grant.threadId, turnId: turnId ?? `gateway_${grant.grantId}` } : undefined)
    modelRequest.gatewayRouting = { ...resolved.gatewayRouting,
      callerId: grant ? `harness:${grant.grantId}` : `client:${publicAuth?.client?.clientId ?? 'legacy'}`,
      affinity: gatewayAffinityIdentity(request, gate.auth, turnId, asRecord(body.value)),
      beforeDispatch: gatewayDispatchAuthorization(runtime, request, gate.auth, resolved.gatewayRouting.beforeDispatch) }
    if (modelRequest.reasoningEffort === 'off') {
      for (const target of resolved.gatewayRouting.allowedTargets) {
        const reasoning = runtime.modelGateway?.modelCapabilities?.(target.modelId, target.providerId).reasoning
        if (reasoning?.supportedEfforts && !reasoning.supportedEfforts.includes('off')) {
          throw new Error(`The model '${target.modelId}' cannot disable thinking; choose a gateway route whose models support reasoning off`)
        }
      }
    }
  } catch (error) {
    lease.release()
    return anthropicError(error instanceof Error ? error.message : String(error), 400)
  }
  if (modelRequest.attachments?.length || Object.keys(modelRequest.messageAttachments ?? {}).length) {
    // Anthropic returns a 400 when the model cannot consume image blocks;
    // mirror that instead of silently degrading them to text.
    const capabilities = runtime.modelGateway?.modelCapabilities?.(resolved.model, resolved.providerId)
    if (capabilities && !capabilities.inputModalities.includes('image')) {
      lease.release()
      return anthropicError(`The model '${resolved.model}' does not support image inputs.`, 400)
    }
  }
  let recorder: GatewayUsageRecorder | undefined
  try {
    recorder = await beginGatewayUsage(runtime, gate.auth, request, model, resolved, asRecord(body.value))
    if (recorder) {
      modelRequest = makeModelRequest(gatewayClientInput({ ...input, model: resolved.model }, gate.auth), lease.signal, resolved.providerId, recorder.attribution)
      modelRequest.gatewayRouting = { ...resolved.gatewayRouting,
        callerId: grant ? `harness:${grant.grantId}` : `client:${publicAuth?.client?.clientId ?? 'legacy'}`,
        affinity: gatewayAffinityIdentity(request, gate.auth, turnId, asRecord(body.value)),
        beforeDispatch: gatewayDispatchAuthorization(runtime, request, gate.auth, resolved.gatewayRouting.beforeDispatch) }
    }
  } catch (error) {
    lease.release()
    return anthropicError(errorMessage(error), error instanceof GatewayUsageError ? error.status : 400)
  }
  modelRequest.requestId = modelRequest.turnId
  modelRequest.deadlineAt = lease.deadlineAt ?? Date.now() + 120_000
  modelRequest.attemptObserver = gatewayAttemptAccounting(runtime, gate.auth, recorder, modelRequest.turnId)
  const attribute = grant
    ? (usage?: UsageSnapshot) => recordHarnessGatewayUsage(runtime, grant, resolved, usage, turnId)
    : undefined
  const stream = input.stream === true
  try {
    const upstream = gatewayUpstream(runtime, request, gate.auth, modelRequest, model, resolved.accountId)
    const chunks = wrapGatewayUsage(harnessGatewayStream(upstream, grant), recorder, {
      timedOut: lease.timedOut, cancelled: () => lease.signal.aborted && !lease.timedOut()
    })
    if (!stream) return anthropicNonStreamingResponse(chunks, model, lease, attribute)
    const admitted = await admitGatewayStream(chunks, lease.signal)
    if ('refused' in admitted) {
      await chunks.finish('failed').catch(() => undefined)
      lease.release()
      return withResponseHeaders(anthropicError(admitted.refused.message, errorStatus(admitted.refused)), failureRetryHeaders(admitted.refused.failure))
    }
    return anthropicStreamingResponse(admitted.chunks, model, lease, attribute)
  } catch (error) {
    await recorder?.finish('failed').catch(() => undefined)
    lease.release()
    return anthropicError(errorMessage(error), error instanceof GatewayUsageError ? error.status : 502)
  }
}

/**
 * `POST /v1/messages/count_tokens`: validates the request through the same
 * Anthropic→ModelRequest conversion, then returns a local estimate built from
 * the loop's context-hygiene token counter. `x-kun-estimate: true` marks the
 * response as approximate rather than provider-authoritative.
 */
export async function gatewayCountTokens(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const gate = await authorizeAnthropicGateway(runtime, request)
  if ('status' in gate) return gate
  const grant = gate.grant
  const publicAuth = gate.auth.kind === 'public' ? gate.auth : undefined
  if (!runtime.modelGateway?.enabled()) return anthropicError('Local model gateway is disabled.', 404)
  const lease = acquireGatewayLease(runtime, request, grant, gate.auth)
  if (!lease) return withResponseHeaders(anthropicError(GATEWAY_BUSY_MESSAGE, 429), gatewayRetryHeaders(GATEWAY_BUSY_RETRY_MS))
  try {
    let body: Awaited<ReturnType<typeof readJsonBody>>
    try {
      body = await readJsonBody(request, grant?.maxBodyBytes ?? publicAuth?.policy?.maxBodyBytes ?? MAX_GATEWAY_BODY_BYTES, lease.signal)
    } catch (error) {
      return anthropicError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 504 : 400)
    }
    if (!body.ok) return anthropicError(JSON.parse(body.response.body).message, body.response.status)
    const input = anthropicToChatInput(asRecord(body.value))
    const model = stringValue(input.model)
    const resolved = model ? await resolveGatewayModel(runtime, model, grant, publicAuth?.policy, publicAuth?.policyRevision) : null
    if (!resolved) return anthropicError(`The model '${model || '(missing)'}' does not exist.`, 404)
    const modelRequest = makeModelRequest({ ...input, model: resolved.model }, lease.signal, resolved.providerId)
    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'anthropic-version': '2023-06-01',
        'x-kun-estimate': 'true',
        'cache-control': 'no-store'
      },
      body: JSON.stringify({ input_tokens: estimateModelRequestTokens(modelRequest) })
    }
  } catch (error) {
    return anthropicError(error instanceof Error ? error.message : String(error), 400)
  } finally {
    lease.release()
  }
}

type AnthropicBlock = Record<string, unknown>

function anthropicUsage(usage: unknown): Record<string, number> {
  const record = asRecord(usage)
  return {
    input_tokens: Math.max(0, (numberValue(record.promptTokens) ?? 0) - (numberValue(record.cacheHitTokens ?? record.cachedTokens) ?? 0) - (numberValue(record.cacheWriteTokens) ?? 0)),
    output_tokens: numberValue(record.completionTokens) ?? 0,
    ...(record.cacheHitTokens != null || record.cachedTokens != null ? { cache_read_input_tokens: numberValue(record.cacheHitTokens ?? record.cachedTokens) ?? 0 } : {}),
    ...(record.cacheWriteTokens != null ? { cache_creation_input_tokens: numberValue(record.cacheWriteTokens) ?? 0 } : {})
  }
}

async function anthropicNonStreamingResponse(chunks: GatewayUsageStream, model: string, lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>): Promise<JsonResponse> {
  let text = ''
  let thinking = ''
  let usage: UsageSnapshot | undefined
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  const content: AnthropicBlock[] = []
  const toolCalls: { id: string; name: string; input: unknown }[] = []
  const deltaToolCalls = new Map<string, { name: string; json: string }>()
  const completedToolIds = new Set<string>()
  const iterator = chunks[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) { completed = true; throw new Error('Upstream stream ended without a completion marker') }
      const chunk = result.value
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      else if (chunk.kind === 'assistant_reasoning_delta') thinking += chunk.text
      else if (chunk.kind === 'tool_call_delta') {
        if (completedToolIds.has(chunk.callId)) throw new Error(`Duplicate tool call '${chunk.callId}'`)
        const entry = deltaToolCalls.get(chunk.callId) ?? { name: chunk.toolName ?? '', json: '' }
        if (entry.name && chunk.toolName && entry.name !== chunk.toolName) throw new Error(`Tool name changed for '${chunk.callId}'`)
        entry.name = chunk.toolName ?? entry.name
        entry.json += chunk.argumentsDelta ?? ''
        deltaToolCalls.set(chunk.callId, entry)
      }
      else if (chunk.kind === 'tool_call_complete') {
        if (completedToolIds.has(chunk.callId)) throw new Error(`Duplicate tool call '${chunk.callId}'`)
        const pending = deltaToolCalls.get(chunk.callId)
        if (pending?.name && pending.name !== chunk.toolName) throw new Error(`Tool name changed for '${chunk.callId}'`)
        if (pending?.json && !isDeepStrictEqual(validateToolJson(pending.json), chunk.arguments)) throw new Error(`Arguments changed for tool call '${chunk.callId}'`)
        completedToolIds.add(chunk.callId)
        deltaToolCalls.delete(chunk.callId)
        toolCalls.push({ id: chunk.callId, name: chunk.toolName, input: chunk.arguments })
      }
      else if (chunk.kind === 'image_generation_complete') throw new Error('Generated image output is not supported by the local gateway')
      else if (chunk.kind === 'usage') usage = chunk.usage
      else if (chunk.kind === 'completed') {
        if (chunk.stopReason === 'error') throw new Error('Upstream generation ended with an error')
        stopReason = chunk.stopReason
        break
      }
      else if (chunk.kind === 'error') {
        await chunks.finish('failed')
        return withResponseHeaders(anthropicError(chunk.message, errorStatus(chunk)), failureRetryHeaders(chunk.failure))
      }
    }
    for (const [callId, entry] of deltaToolCalls) {
      if (!entry.name) throw new Error(`Missing name for tool call '${callId}'`)
      toolCalls.push({ id: callId, name: entry.name, input: validateToolJson(entry.json) })
    }
    if (thinking) content.push({ type: 'thinking', thinking, signature: gatewayThinkingSignature() })
    if (text) content.push({ type: 'text', text })
    for (const call of toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    const response = jsonResponse({
      id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content,
      stop_reason: anthropicStopReason(stopReason, toolCalls.length > 0), stop_sequence: null, usage: anthropicUsage(usage)
    })
    response.headers['anthropic-version'] = '2023-06-01'
    await chunks.finish('completed')
    return response
  } catch (error) {
    await chunks.finish('failed').catch(() => undefined)
    return anthropicError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 504 : error instanceof GatewayUsageError ? error.status : 502)
  } finally {
    if (!completed) await iterator.return?.().catch(() => undefined)
    await attribute?.(usage).catch(() => undefined)
    lease.release()
  }
}

function anthropicStreamingResponse(chunks: GatewayUsageStream, model: string, lease: GatewayLease, attribute?: (usage?: UsageSnapshot) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const id = `msg_${randomUUID()}`
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let attributed = false
  let blockIndex = 0
  let openBlock: 'text' | 'thinking' | null = null
  const pendingTools = new Map<string, { name: string; deltas: string[] }>()
  const completedTools = new Set<string>()
  let usage: UsageSnapshot | undefined
  let sawToolUse = false
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  const closeIterator = async (): Promise<void> => {
    if (iteratorClosed) return
    iteratorClosed = true
    await iterator.return?.().catch(() => undefined)
  }
  const settleUsage = async (): Promise<void> => {
    if (attributed) return
    attributed = true
    await attribute?.(usage).catch(() => undefined)
  }
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, closeUpstream: boolean): Promise<void> => {
    if (finished) return
    finished = true
    if (closeUpstream) await closeIterator()
    await settleUsage()
    lease.release()
    if (!cancelled) controller.close()
  }
  const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, value: unknown): void => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))
  }
  const closeOpenBlock = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!openBlock) return
    if (openBlock === 'thinking') {
      sendEvent(controller, 'content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'signature_delta', signature: gatewayThinkingSignature() }
      })
    }
    sendEvent(controller, 'content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex += 1
    openBlock = null
  }
  const emitTool = (controller: ReadableStreamDefaultController<Uint8Array>, callId: string, name: string, deltas: string[]): void => {
    if (completedTools.has(callId)) throw new Error(`Duplicate tool call '${callId}'`)
    if (!name) throw new Error(`Missing name for tool call '${callId}'`)
    closeOpenBlock(controller)
    sendEvent(controller, 'content_block_start', {
      type: 'content_block_start', index: blockIndex,
      content_block: { type: 'tool_use', id: callId, name, input: {} }
    })
    for (const partial_json of deltas) {
      if (partial_json) sendEvent(controller, 'content_block_delta', {
        type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json }
      })
    }
    sendEvent(controller, 'content_block_stop', { type: 'content_block_stop', index: blockIndex++ })
    completedTools.add(callId)
    pendingTools.delete(callId)
  }
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      sendEvent(controller, 'message_start', {
        type: 'message_start',
        message: {
          id, type: 'message', role: 'assistant', model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    },
    async pull(controller) {
      if (finished || cancelled) return
      try {
        // A pull that enqueues nothing is not re-invoked, so bookkeeping-only
        // chunks (usage) loop back for another read instead of returning.
        for (;;) {
        const result = await nextGatewayChunk(iterator, lease.signal)
        if (result.done) {
          iteratorClosed = true
          throw new Error('Upstream stream ended without a completion marker')
        }
        const chunk = result.value
        if (chunk.kind === 'completed') {
          if (chunk.kind === 'completed') {
            if (chunk.stopReason === 'error') throw new Error('Upstream generation ended with an error')
            stopReason = chunk.stopReason
          }
          for (const [callId, tool] of pendingTools) {
            if (stopReason !== 'length') validateToolJson(tool.deltas.join(''))
            emitTool(controller, callId, tool.name, tool.deltas)
          }
          closeOpenBlock(controller)
          const parsedUsage = anthropicUsage(usage)
          await chunks.finish('completed')
          sendEvent(controller, 'message_delta', {
            type: 'message_delta',
            delta: { stop_reason: anthropicStopReason(stopReason, sawToolUse), stop_sequence: null },
            usage: parsedUsage
          })
          sendEvent(controller, 'message_stop', { type: 'message_stop' })
          await finish(controller, true)
          return
        }
        if (chunk.kind === 'error') {
          await chunks.finish('failed')
          sendEvent(controller, 'error', { type: 'error', error: { type: 'api_error', message: chunk.message } })
          await finish(controller, true)
          return
        }
        if (chunk.kind === 'usage') {
          usage = chunk.usage
          continue
        }
        if (chunk.kind === 'assistant_text_delta') {
          if (openBlock !== 'text') {
            closeOpenBlock(controller)
            sendEvent(controller, 'content_block_start', {
              type: 'content_block_start', index: blockIndex,
              content_block: { type: 'text', text: '' }
            })
            openBlock = 'text'
          }
          sendEvent(controller, 'content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'text_delta', text: chunk.text }
          })
          return
        }
        if (chunk.kind === 'assistant_reasoning_delta') {
          if (!chunk.text) continue
          if (openBlock !== 'thinking') {
            closeOpenBlock(controller)
            sendEvent(controller, 'content_block_start', {
              type: 'content_block_start', index: blockIndex,
              content_block: { type: 'thinking', thinking: '', signature: '' }
            })
            openBlock = 'thinking'
          }
          sendEvent(controller, 'content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'thinking_delta', thinking: chunk.text }
          })
          return
        }
        if (chunk.kind === 'tool_call_delta') {
          if (completedTools.has(chunk.callId)) throw new Error(`Duplicate tool call '${chunk.callId}'`)
          const tool = pendingTools.get(chunk.callId) ?? { name: '', deltas: [] }
          if (tool.name && chunk.toolName && tool.name !== chunk.toolName) throw new Error(`Tool name changed for '${chunk.callId}'`)
          tool.name = chunk.toolName ?? tool.name
          if (chunk.argumentsDelta) tool.deltas.push(chunk.argumentsDelta)
          pendingTools.set(chunk.callId, tool)
          sawToolUse = true
          // Buffer interleaved tool calls independently. Anthropic clients expect
          // each content block to close before the next block begins.
          continue
        }
        if (chunk.kind === 'tool_call_complete') {
          sawToolUse = true
          const tool = pendingTools.get(chunk.callId)
          if (tool?.name && tool.name !== chunk.toolName) throw new Error(`Tool name changed for '${chunk.callId}'`)
          const deltas = tool?.deltas.length ? [...tool.deltas] : [JSON.stringify(chunk.arguments)]
          const joined = deltas.join('')
          if (!isDeepStrictEqual(validateToolJson(joined), chunk.arguments)) throw new Error(`Arguments changed for tool call '${chunk.callId}'`)
          emitTool(controller, chunk.callId, chunk.toolName, deltas)
          return
        }
        if (chunk.kind === 'image_generation_complete') throw new Error('Generated image output is not supported by the local gateway')
        continue
        }
      } catch (error) {
        await chunks.finish(cancelled ? 'cancelled' : 'failed').catch(() => undefined)
        if (!cancelled) {
          sendEvent(controller, 'error', { type: 'error', error: { type: 'api_error', message: lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error) } })
        }
        await finish(controller, true)
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
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'anthropic-version': '2023-06-01' } })
}

function validateToolJson(value: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Upstream tool arguments are not valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Upstream tool arguments must be an object')
  return parsed as Record<string, unknown>
}
