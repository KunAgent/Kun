import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ResponsesToolNamespaces } from './responses-tool-namespaces.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'

type WireRecord = Record<string, unknown>
type ToolState = { index: number; itemId: string; id: string; name: string; arguments: string; closed: boolean }
type TextState = { index: number; id: string; text: string; reasoning: boolean }
type StopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']

export function openAiUsage(usage: UsageSnapshot, shape: 'chat' | 'responses'): WireRecord {
  const cached = usage.cacheHitTokens ?? usage.cachedTokens ?? 0
  const reasoning = usage.reasoningTokens ?? 0
  return shape === 'chat' ? {
    prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: cached }, completion_tokens_details: { reasoning_tokens: reasoning }
  } : {
    input_tokens: usage.promptTokens, output_tokens: usage.completionTokens, total_tokens: usage.totalTokens,
    input_tokens_details: { cached_tokens: cached }, output_tokens_details: { reasoning_tokens: reasoning }
  }
}

/** Owns stable wire item ids and indexes for both buffered and streamed output. */
export class OpenAiGatewayOutput {
  readonly id: string
  readonly created = Math.floor(Date.now() / 1000)
  usage?: UsageSnapshot
  private sequence = 0
  private stopReason?: StopReason
  private text = ''
  private reasoning = ''
  private textItem?: TextState
  private reasoningItem?: TextState
  private readonly tools = new Map<string, ToolState>()
  private readonly output: WireRecord[] = []

  constructor(readonly model: string, readonly shape: 'chat' | 'responses', private readonly namespaces?: ResponsesToolNamespaces) {
    this.id = `${shape === 'chat' ? 'chatcmpl' : 'resp'}_${randomUUID()}`
  }

  private event(type: string, fields: WireRecord): WireRecord {
    return { type, sequence_number: this.sequence++, ...fields }
  }

  private chat(delta: WireRecord, finishReason: string | null = null): WireRecord {
    return { id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }] }
  }

  initial(): WireRecord[] {
    if (this.shape === 'chat') return [this.chat({ role: 'assistant', content: '' })]
    const response = this.response('in_progress')
    return [this.event('response.created', { response }), this.event('response.in_progress', { response })]
  }

  accept(chunk: ModelStreamChunk): WireRecord[] {
    if (chunk.kind === 'usage') { this.usage = chunk.usage; return [] }
    if (chunk.kind === 'completed') {
      if (chunk.stopReason === 'error') throw new Error('Upstream generation ended with an error')
      this.stopReason = chunk.stopReason
      return []
    }
    if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') {
      return this.acceptText(chunk.text, chunk.kind === 'assistant_reasoning_delta')
    }
    if (chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete') return this.acceptTool(chunk)
    if (chunk.kind === 'image_generation_complete') throw new Error('Generated image output is not supported by the local gateway')
    return []
  }

  private acceptText(delta: string, reasoning: boolean): WireRecord[] {
    if (reasoning) this.reasoning += delta
    else this.text += delta
    if (this.shape === 'chat') return [this.chat(reasoning ? { reasoning_content: delta } : { content: delta })]
    const events: WireRecord[] = []
    let state = reasoning ? this.reasoningItem : this.textItem
    if (!state) {
      state = { index: this.output.length, id: `${reasoning ? 'rs' : 'msg'}_${randomUUID()}`, text: '', reasoning }
      const item = reasoning
        ? { id: state.id, type: 'reasoning', summary: [] }
        : { id: state.id, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
      this.output.push(item)
      if (reasoning) this.reasoningItem = state
      else this.textItem = state
      events.push(this.event('response.output_item.added', { output_index: state.index, item: { ...item } }))
      events.push(this.event(reasoning ? 'response.reasoning_summary_part.added' : 'response.content_part.added', {
        item_id: state.id, output_index: state.index, [reasoning ? 'summary_index' : 'content_index']: 0,
        part: reasoning ? { type: 'summary_text', text: '' } : { type: 'output_text', text: '', annotations: [], logprobs: [] }
      }))
    }
    state.text += delta
    events.push(this.event(reasoning ? 'response.reasoning_summary_text.delta' : 'response.output_text.delta', {
      item_id: state.id, output_index: state.index, [reasoning ? 'summary_index' : 'content_index']: 0,
      delta, ...(!reasoning ? { logprobs: [] } : {})
    }))
    return events
  }

  private acceptTool(chunk: Extract<ModelStreamChunk, { kind: 'tool_call_delta' | 'tool_call_complete' }>): WireRecord[] {
    const events: WireRecord[] = []
    let tool = this.tools.get(chunk.callId)
    if (!tool) {
      tool = { index: this.shape === 'chat' ? this.tools.size : this.output.length,
        itemId: `fc_${randomUUID()}`, id: chunk.callId, name: chunk.toolName ?? '', arguments: '', closed: false }
      this.tools.set(chunk.callId, tool)
      if (this.shape === 'responses') {
        const item = this.toolItem(tool, 'in_progress')
        this.output.push(item)
        events.push(this.event('response.output_item.added', { output_index: tool.index, item }))
      } else {
        events.push(this.chat({ tool_calls: [{ index: tool.index, id: tool.id, type: 'function',
          function: { name: tool.name, arguments: '' } }] }))
      }
    }
    if (tool.closed) throw new Error(`Upstream emitted a duplicate completed tool call '${tool.id}'`)
    if (chunk.toolName && chunk.toolName !== tool.name) {
      if (tool.name) throw new Error(`Upstream changed the name of tool call '${tool.id}'`)
      tool.name = chunk.toolName
      if (this.shape === 'chat') events.push(this.chat({ tool_calls: [{ index: tool.index, function: { name: tool.name } }] }))
    }
    let delta = chunk.kind === 'tool_call_delta' ? chunk.argumentsDelta ?? '' : ''
    if (chunk.kind === 'tool_call_complete') {
      const complete = JSON.stringify(chunk.arguments)
      // Equivalent JSON can have different whitespace; preserve the exact deltas
      // already emitted and never append a second complete arguments object.
      if (!tool.arguments) delta = complete
      else {
        try {
          const parsed: unknown = JSON.parse(tool.arguments)
          if (!isDeepStrictEqual(parsed, chunk.arguments)) throw new Error('arguments changed')
        } catch {
          if (!complete.startsWith(tool.arguments)) throw new Error(`Incomplete arguments for tool call '${tool.id}'`)
          delta = complete.slice(tool.arguments.length)
        }
      }
    }
    tool.arguments += delta
    if (delta) events.push(this.shape === 'chat'
      ? this.chat({ tool_calls: [{ index: tool.index, function: { arguments: delta } }] })
      : this.event('response.function_call_arguments.delta', { item_id: tool.itemId, output_index: tool.index, delta }))
    if (chunk.kind === 'tool_call_complete') events.push(...this.closeTool(tool))
    return events
  }

  private toolItem(tool: ToolState, status: string): WireRecord {
    return { id: tool.itemId, type: 'function_call', call_id: tool.id, ...(this.namespaces?.wireIdentity(tool.name) ?? { name: tool.name }), arguments: tool.arguments, status }
  }

  private closeTool(tool: ToolState): WireRecord[] {
    if (tool.closed) return []
    if (!tool.name) throw new Error(`Missing name for tool call '${tool.id}'`)
    try {
      const args: unknown = this.stopReason === 'length' ? {} : JSON.parse(tool.arguments)
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object')
    } catch { throw new Error(`Invalid arguments for tool call '${tool.id}'`) }
    tool.closed = true
    if (this.shape === 'chat') return []
    const item = this.toolItem(tool, this.stopReason === 'length' ? 'incomplete' : 'completed')
    this.output[tool.index] = item
    return [
      this.event('response.function_call_arguments.done', { item_id: tool.itemId, output_index: tool.index, arguments: tool.arguments, ...(this.namespaces?.wireIdentity(tool.name) ?? { name: tool.name }) }),
      this.event('response.output_item.done', { output_index: tool.index, item })
    ]
  }

  private closeText(state: TextState): WireRecord[] {
    const { id, index, text, reasoning } = state
    const part = reasoning ? { type: 'summary_text', text } : { type: 'output_text', text, annotations: [], logprobs: [] }
    const item = reasoning ? { id, type: 'reasoning', summary: [part] }
      : { id, type: 'message', role: 'assistant', status: this.stopReason === 'length' ? 'incomplete' : 'completed', content: [part] }
    this.output[index] = item
    const fields = { item_id: id, output_index: index, [reasoning ? 'summary_index' : 'content_index']: 0 }
    return [
      this.event(reasoning ? 'response.reasoning_summary_text.done' : 'response.output_text.done', { ...fields, text, ...(!reasoning ? { logprobs: [] } : {}) }),
      this.event(reasoning ? 'response.reasoning_summary_part.done' : 'response.content_part.done', { ...fields, part }),
      this.event('response.output_item.done', { output_index: index, item })
    ]
  }

  finish(includeUsage: boolean): WireRecord[] {
    if (!this.stopReason) throw new Error('Upstream stream ended without a completion marker')
    const events = [...this.tools.values()].flatMap((tool) => this.closeTool(tool))
    if (this.shape === 'chat') {
      events.push(this.chat({}, this.finishReason()))
      if (includeUsage && this.usage) events.push({ id: this.id, object: 'chat.completion.chunk', created: this.created,
        model: this.model, choices: [], usage: openAiUsage(this.usage, 'chat') })
    } else {
      if (this.reasoningItem) events.push(...this.closeText(this.reasoningItem))
      if (this.textItem) events.push(...this.closeText(this.textItem))
      const status = this.stopReason === 'length' ? 'incomplete' : 'completed'
      events.push(this.event(`response.${status}`, { response: this.response(status) }))
    }
    return events
  }

  failure(message: string, code: string): WireRecord[] {
    if (this.shape === 'chat') return [{ error: { message, type: 'server_error', code, param: null } }]
    return [this.event('response.failed', { response: { ...this.response('failed'), error: { code, message } } })]
  }

  private finishReason(): string {
    return this.stopReason === 'length' ? 'length' : this.tools.size > 0 || this.stopReason === 'tool_calls' ? 'tool_calls' : 'stop'
  }

  private response(status: string): WireRecord {
    return { id: this.id, object: 'response', created_at: this.created, model: this.model, status,
      error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
      output: status === 'in_progress' ? [] : [...this.output], usage: this.usage ? openAiUsage(this.usage, 'responses') : null }
  }

  result(): WireRecord {
    this.finish(false)
    if (this.shape === 'responses') return this.response(this.stopReason === 'length' ? 'incomplete' : 'completed')
    const toolCalls = [...this.tools.values()].map((tool) => ({ id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }))
    return { id: this.id, object: 'chat.completion', created: this.created, model: this.model,
      choices: [{ index: 0, message: { role: 'assistant', content: this.text || (toolCalls.length ? null : ''),
        ...(this.reasoning ? { reasoning_content: this.reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: this.finishReason() }], ...(this.usage ? { usage: openAiUsage(this.usage, 'chat') } : {}) }
  }
}
