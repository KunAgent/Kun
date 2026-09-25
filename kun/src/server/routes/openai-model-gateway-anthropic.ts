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
  guardFor,
  MAX_GATEWAY_BODY_BYTES,
  nextGatewayChunk,
  numberValue,
  parseArguments,
  stringValue
} from './openai-model-gateway-support.js'
import {
  makeModelRequest,
  resolveGatewayModel
} from './openai-model-gateway.js'

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
  return jsonResponse({ type: 'error', error: { type: anthropicErrorType(status), message } }, status)
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

type AnthropicBlock = Record<string, unknown>

function anthropicToChatInput(input: Record<string, unknown>): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []
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
        toolCalls.push({
          id: stringValue(record.id) || `call_${toolCalls.length}`,
          type: 'function',
          function: { name: stringValue(record.name) || 'unknown', arguments: JSON.stringify(record.input ?? {}) }
        })
      } else if (type === 'tool_result') {
        const resultText = typeof record.content === 'string'
          ? record.content
          : (Array.isArray(record.content) ? record.content : [])
            .map((entry) => stringValue(asRecord(entry).text))
            .filter(Boolean)
            .join('\n')
        messages.push({ role: 'tool', tool_call_id: stringValue(record.tool_use_id), content: resultText })
      }
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
  let usage: unknown
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  const content: AnthropicBlock[] = []
  const toolCalls: { id: string; name: string; input: unknown }[] = []
  const iterator = chunks[Symbol.asyncIterator]()
  let completed = false
  try {
    for (;;) {
      const result = await nextGatewayChunk(iterator, lease.signal)
      if (result.done) { completed = true; break }
      const chunk = result.value
      if (chunk.kind === 'assistant_text_delta') text += chunk.text
      else if (chunk.kind === 'tool_call_complete') toolCalls.push({ id: chunk.callId, name: chunk.toolName, input: chunk.arguments })
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
  if (text) content.push({ type: 'text', text })
  for (const call of toolCalls) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
  }
  return jsonResponse({
    id: `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: anthropicStopReason(stopReason, toolCalls.length > 0),
    stop_sequence: null,
    usage: anthropicUsage(usage)
  })
}

function anthropicStreamingResponse(chunks: AsyncIterable<ModelStreamChunk>, model: string, lease: GatewayLease): Response {
  const encoder = new TextEncoder()
  const id = `msg_${randomUUID()}`
  const iterator = chunks[Symbol.asyncIterator]()
  let cancelled = false
  let finished = false
  let iteratorClosed = false
  let blockIndex = 0
  let textOpen = false
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
  const closeTextBlock = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!textOpen) return
    sendEvent(controller, 'content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex += 1
    textOpen = false
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
          closeTextBlock(controller)
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
          if (!textOpen) {
            sendEvent(controller, 'content_block_start', {
              type: 'content_block_start', index: blockIndex,
              content_block: { type: 'text', text: '' }
            })
            textOpen = true
          }
          sendEvent(controller, 'content_block_delta', {
            type: 'content_block_delta', index: blockIndex,
            delta: { type: 'text_delta', text: chunk.text }
          })
          return
        }
        if (chunk.kind === 'tool_call_complete') {
          sawToolUse = true
          closeTextBlock(controller)
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
