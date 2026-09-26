import { randomUUID } from 'node:crypto'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { GatewayLease } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  asRecord,
  errorMessage,
  errorStatus,
  estimateModelRequestTokens,
  guardFor,
  makeModelRequest,
  MAX_GATEWAY_BODY_BYTES,
  nextGatewayChunk,
  numberValue,
  parseArguments,
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

/** Same Bearer/x-api-key credential + token bucket, with Anthropic error bodies. */
function authorizeAnthropicGateway(runtime: ServerRuntime, request: Request): JsonResponse | null {
  const guard = guardFor(runtime)
  if (!guard || !guard.authorize(request)) return anthropicError('Invalid gateway API key.', 401)
  if (!guard.consumeToken()) return anthropicError('Gateway rate limit exceeded.', 429)
  return null
}

function anthropicStopReason(
  stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined,
  sawToolUse: boolean
): 'end_turn' | 'max_tokens' | 'tool_use' {
  if (stopReason === 'tool_calls' || sawToolUse) return 'tool_use'
  if (stopReason === 'length') return 'max_tokens'
  return 'end_turn'
}

export async function gatewayMessages(runtime: ServerRuntime, request: Request): Promise<Response | JsonResponse> {
  const rejected = authorizeAnthropicGateway(runtime, request)
  if (rejected) return rejected
  if (!runtime.modelGateway?.enabled() || !runtime.modelClient) return anthropicError('Local model gateway is disabled.', 404)
  const guard = guardFor(runtime)!
  const lease = guard.acquire(request.signal)
  if (!lease) return anthropicError('Too many concurrent gateway requests.', 429)
  let body: Awaited<ReturnType<typeof readJsonBody>>
  try {
    body = await readJsonBody(request, MAX_GATEWAY_BODY_BYTES, lease.signal)
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
  const resolved = model ? await resolveGatewayModel(runtime, model) : null
  if (!resolved) {
    lease.release()
    return anthropicError(`The model '${model || '(missing)'}' does not exist.`, 404)
  }
  let modelRequest: ModelRequest
  try {
    modelRequest = makeModelRequest({ ...input, model: resolved.model }, lease.signal, resolved.providerId)
  } catch (error) {
    lease.release()
    return anthropicError(error instanceof Error ? error.message : String(error), 400)
  }
  if (modelRequest.attachments?.length) {
    // Anthropic returns a 400 when the model cannot consume image blocks;
    // mirror that instead of silently degrading them to text.
    const capabilities = runtime.modelGateway?.modelCapabilities?.(resolved.model, resolved.providerId)
    if (capabilities && !capabilities.inputModalities.includes('image')) {
      lease.release()
      return anthropicError(`The model '${resolved.model}' does not support image inputs.`, 400)
    }
  }
  const stream = input.stream === true
  try {
    const chunks = runtime.modelClient.stream(modelRequest)
    return stream
      ? anthropicStreamingResponse(chunks, model, lease)
      : anthropicNonStreamingResponse(chunks, model, lease)
  } catch (error) {
    lease.release()
    return anthropicError(errorMessage(error), 502)
  }
}

/**
 * `POST /v1/messages/count_tokens`: validates the request through the same
 * Anthropic→ModelRequest conversion, then returns a local estimate built from
 * the loop's context-hygiene token counter. `x-kun-estimate: true` marks the
 * response as approximate rather than provider-authoritative.
 */
export async function gatewayCountTokens(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  const rejected = authorizeAnthropicGateway(runtime, request)
  if (rejected) return rejected
  if (!runtime.modelGateway?.enabled()) return anthropicError('Local model gateway is disabled.', 404)
  const guard = guardFor(runtime)!
  const lease = guard.acquire(request.signal)
  if (!lease) return anthropicError('Too many concurrent gateway requests.', 429)
  try {
    let body: Awaited<ReturnType<typeof readJsonBody>>
    try {
      body = await readJsonBody(request, MAX_GATEWAY_BODY_BYTES, lease.signal)
    } catch (error) {
      return anthropicError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 504 : 400)
    }
    if (!body.ok) return anthropicError(JSON.parse(body.response.body).message, body.response.status)
    const input = anthropicToChatInput(asRecord(body.value))
    const model = stringValue(input.model)
    const resolved = model ? await resolveGatewayModel(runtime, model) : null
    if (!resolved) return anthropicError(`The model '${model || '(missing)'}' does not exist.`, 404)
    const modelRequest = makeModelRequest({ ...input, model: resolved.model }, lease.signal, resolved.providerId)
    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'anthropic-version': '2023-06-01',
        'x-kun-estimate': 'true'
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

function anthropicToChatInput(input: Record<string, unknown>): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []
  // tool_result blocks whose tool_use_id never appeared in a preceding
  // tool_use block are orphans (malformed replayed history) and get dropped,
  // matching the loop's orphan-result repair.
  const seenToolUseIds = new Set<string>()
  const systemParts: string[] = []
  const system = input.system
  if (typeof system === 'string' && system.trim()) systemParts.push(system)
  else if (Array.isArray(system)) {
    for (const block of system) {
      const record = asRecord(block)
      if (stringValue(record.type) === 'text') systemParts.push(stringValue(record.text))
    }
  }
  if (systemParts.length > 0) messages.push({ role: 'system', content: systemParts.join('\n\n') })
  for (const raw of Array.isArray(input.messages) ? input.messages : []) {
    const message = asRecord(raw)
    const role = stringValue(message.role)
    const content = message.content
    if (typeof content === 'string') {
      messages.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) {
      messages.push({ role, content: '' })
      continue
    }
    const parts: AnthropicBlock[] = []
    const toolCalls: Record<string, unknown>[] = []
    for (const block of content) {
      const record = asRecord(block)
      const type = stringValue(record.type)
      if (type === 'text') {
        parts.push({ type: 'text', text: stringValue(record.text) })
      } else if (type === 'image') {
        const source = asRecord(record.source)
        if (stringValue(source.type) === 'base64' && stringValue(source.data)) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${stringValue(source.media_type) || 'image/png'};base64,${stringValue(source.data)}` }
          })
        }
      } else if (type === 'tool_use') {
        const callId = stringValue(record.id) || `call_${toolCalls.length}`
        seenToolUseIds.add(callId)
        toolCalls.push({
          id: callId,
          type: 'function',
          function: { name: stringValue(record.name) || 'unknown', arguments: JSON.stringify(record.input ?? {}) }
        })
      } else if (type === 'tool_result') {
        const toolUseId = stringValue(record.tool_use_id)
        if (!seenToolUseIds.has(toolUseId)) continue
        const resultText = typeof record.content === 'string'
          ? record.content
          : (Array.isArray(record.content) ? record.content : [])
            .map((entry) => stringValue(asRecord(entry).text))
            .filter(Boolean)
            .join('\n')
        messages.push({ role: 'tool', tool_call_id: toolUseId, content: resultText })
      }
      // Other block kinds (thinking, redacted_thinking, document, server
      // tool results, ...) are intentionally dropped, not rejected.
    }
    if (parts.length > 0 || toolCalls.length > 0) {
      messages.push({
        role,
        content: parts,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      })
    }
  }
  return {
    model: input.model,
    messages,
    tools: input.tools,
    stream: input.stream,
    max_tokens: input.max_tokens,
    temperature: input.temperature
  }
}

function anthropicUsage(usage: unknown): Record<string, number> {
  const record = asRecord(usage)
  return {
    input_tokens: numberValue(record.promptTokens) ?? 0,
    output_tokens: numberValue(record.completionTokens) ?? 0
  }
}

async function anthropicNonStreamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, lease: GatewayLease): Promise<JsonResponse> {
  let text = ''
  let thinking = ''
  let usage: unknown
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  const content: AnthropicBlock[] = []
  const toolCalls: { id: string; name: string; input: unknown }[] = []
  const deltaToolCalls = new Map<string, { name: string; json: string }>()
  const iterator = chunks[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) { completed = true; break }
      const chunk = result.value
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      else if (chunk.kind === 'assistant_reasoning_delta') thinking += chunk.text
      else if (chunk.kind === 'tool_call_delta') {
        const entry = deltaToolCalls.get(chunk.callId) ?? { name: chunk.toolName ?? '', json: '' }
        entry.name = chunk.toolName ?? entry.name
        entry.json += chunk.argumentsDelta ?? ''
        deltaToolCalls.set(chunk.callId, entry)
      }
      else if (chunk.kind === 'tool_call_complete') {
        deltaToolCalls.delete(chunk.callId)
        toolCalls.push({ id: chunk.callId, name: chunk.toolName, input: chunk.arguments })
      }
      else if (chunk.kind === 'usage') usage = chunk.usage
      else if (chunk.kind === 'completed') stopReason = chunk.stopReason
      else if (chunk.kind === 'error') return anthropicError(chunk.message, errorStatus(chunk))
    }
  } catch (error) {
    return anthropicError(lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error), lease.timedOut() ? 504 : 502)
  } finally {
    if (!completed) await iterator.return?.().catch(() => undefined)
    lease.release()
  }
  for (const [callId, entry] of deltaToolCalls) {
    toolCalls.push({ id: callId, name: entry.name || 'unknown', input: parseArguments(entry.json) })
  }
  if (thinking) content.push({ type: 'thinking', thinking, signature: '' })
  if (text) content.push({ type: 'text', text })
  for (const call of toolCalls) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
  }
  const response = jsonResponse({
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: anthropicStopReason(stopReason, toolCalls.length > 0),
    stop_sequence: null,
    usage: anthropicUsage(usage)
  })
  response.headers['anthropic-version'] = '2023-06-01'
  return response
}

function anthropicStreamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, lease: GatewayLease): Response {
  const encoder = new TextEncoder()
  const id = `msg_${randomUUID()}`
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let blockIndex = 0
  let openBlock: 'text' | 'thinking' | 'tool_use' | null = null
  let openToolCallId = ''
  let usage: unknown
  let sawToolUse = false
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
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
  const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, value: unknown): void => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`))
  }
  const closeOpenBlock = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!openBlock) return
    sendEvent(controller, 'content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex += 1
    openBlock = null
    openToolCallId = ''
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
        const result = await nextGatewayChunk(iterator, lease.signal)
        const chunk = result.done ? { kind: 'completed' as const, stopReason: 'stop' as const } : result.value
        if (result.done) iteratorClosed = true
        if (chunk.kind === 'completed' || result.done) {
          if (chunk.kind === 'completed') stopReason = chunk.stopReason
          closeOpenBlock(controller)
          const parsedUsage = anthropicUsage(usage)
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
          sendEvent(controller, 'error', { type: 'error', error: { type: 'api_error', message: chunk.message } })
          await finish(controller, true)
          return
        }
        if (chunk.kind === 'usage') {
          usage = chunk.usage
          return
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
          if (openBlock !== 'thinking') {
            closeOpenBlock(controller)
            sendEvent(controller, 'content_block_start', {
              type: 'content_block_start', index: blockIndex,
              content_block: { type: 'thinking', thinking: '' }
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
          if (openBlock !== 'tool_use' || openToolCallId !== chunk.callId) {
            closeOpenBlock(controller)
            sendEvent(controller, 'content_block_start', {
              type: 'content_block_start', index: blockIndex,
              content_block: { type: 'tool_use', id: chunk.callId, name: chunk.toolName || 'unknown', input: {} }
            })
            openBlock = 'tool_use'
            openToolCallId = chunk.callId
          }
          sawToolUse = true
          if (chunk.argumentsDelta) {
            sendEvent(controller, 'content_block_delta', {
              type: 'content_block_delta', index: blockIndex,
              delta: { type: 'input_json_delta', partial_json: chunk.argumentsDelta }
            })
          }
          return
        }
        if (chunk.kind === 'tool_call_complete') {
          sawToolUse = true
          if (openBlock === 'tool_use' && openToolCallId === chunk.callId) {
            // Arguments already streamed as input_json_delta chunks.
            closeOpenBlock(controller)
            return
          }
          // Providers that only emit complete calls fall back to a single
          // input_json_delta carrying the full JSON arguments.
          closeOpenBlock(controller)
          sendEvent(controller, 'content_block_start', {
            type: 'content_block_start', index: blockIndex,
            content_block: { type: 'tool_use', id: chunk.callId, name: chunk.toolName, input: {} }
          })
          sendEvent(controller, 'content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(chunk.arguments) }
          })
          sendEvent(controller, 'content_block_stop', { type: 'content_block_stop', index: blockIndex })
          blockIndex += 1
        }
      } catch (error) {
        if (!cancelled) {
          sendEvent(controller, 'error', { type: 'error', error: { type: 'api_error', message: lease.timedOut() ? 'Gateway request timed out.' : errorMessage(error) } })
        }
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
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'anthropic-version': '2023-06-01' } })
}
