import { asRecord, stringValue } from './model-gateway-core.js'

/** Convert only semantics that the canonical model request can faithfully carry. */
export function anthropicToChatInput(input: Record<string, unknown>): Record<string, unknown> {
  for (const field of ['stop_sequences', 'top_k', 'context_management', 'container', 'mcp_servers', 'service_tier']) {
    if (input[field] != null) throw new Error(`Anthropic ${field} is not supported by the local gateway`)
  }
  const supported = new Set(['model', 'messages', 'system', 'max_tokens', 'stream', 'temperature', 'top_p', 'tools', 'tool_choice', 'thinking', 'output_config', 'metadata'])
  for (const field of Object.keys(input)) if (!supported.has(field)) throw new Error(`Anthropic ${field} is not supported by the local gateway`)
  for (const field of ['thinking', 'tool_choice', 'output_config']) {
    if (input[field] != null && (typeof input[field] !== 'object' || Array.isArray(input[field]))) throw new Error(`${field} must be an object`)
  }
  const thinking = asRecord(input.thinking)
  if (input.thinking != null && (thinking.type !== 'disabled' || Object.keys(thinking).some((key) => key !== 'type'))) {
    throw new Error('Anthropic thinking is not supported; use thinking.type=disabled with this gateway')
  }
  if (input.output_config != null && Object.keys(asRecord(input.output_config)).length) throw new Error('Anthropic output_config is not supported by the local gateway')
  const choice = asRecord(input.tool_choice)
  if (input.tool_choice != null && (Object.keys(choice).some((key) => !['type', 'name', 'disable_parallel_tool_use'].includes(key)) ||
    (choice.type !== 'auto' && choice.type !== 'tool') ||
    (choice.type === 'tool' && !stringValue(choice.name)) ||
    (choice.type === 'auto' && choice.name != null) ||
    (choice.disable_parallel_tool_use != null && choice.disable_parallel_tool_use !== false))) {
    throw new Error('Only auto or a named tool_choice is supported by the local gateway')
  }
  const messages: Record<string, unknown>[] = []
  const calls = new Map<string, string>()
  const system = input.system
  if (typeof system === 'string') messages.push({ role: 'system', content: system })
  else if (Array.isArray(system)) messages.push({ role: 'system', content: system.map((block) => textBlock(block, 'system')) })
  else if (system != null) throw new Error('system must be a string or text blocks')
  if (!Array.isArray(input.messages) || input.messages.length === 0) throw new Error('messages is required')
  for (const raw of input.messages) {
    const message = asRecord(raw)
    const role = stringValue(message.role)
    if (role !== 'user' && role !== 'assistant') throw new Error('Anthropic message role must be user or assistant')
    if (typeof message.content === 'string') {
      messages.push({ role, content: message.content })
      continue
    }
    if (!Array.isArray(message.content) || !message.content.length) throw new Error('content must be a string or nonempty block array')
    let parts: Record<string, unknown>[] = []
    let toolCalls: Record<string, unknown>[] = []
    const flush = () => {
      if (parts.length || toolCalls.length) messages.push({ role, content: parts, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      parts = []
      toolCalls = []
    }
    for (const block of message.content) {
      const record = asRecord(block)
      const type = stringValue(record.type)
      if (type === 'text') parts.push(textBlock(record, 'message'))
      else if (type === 'image') {
        if (role !== 'user') throw new Error('Image blocks are supported only in user messages')
        const source = asRecord(record.source)
        if (source.type !== 'base64' || !stringValue(source.media_type).startsWith('image/') || !stringValue(source.data)) {
          throw new Error('Anthropic image blocks require base64 image data and media_type')
        }
        parts.push({ type: 'image_url', image_url: { url: `data:${String(source.media_type)};base64,${String(source.data)}` } })
      } else if (type === 'tool_use') {
        const id = stringValue(record.id)
        const name = stringValue(record.name)
        if (role !== 'assistant' || !id || !name || calls.has(id)) throw new Error('tool_use requires a unique id, name and assistant role')
        if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) throw new Error('tool_use input must be an object')
        calls.set(id, name)
        toolCalls.push({ id, type: 'function', function: { name, arguments: JSON.stringify(record.input) } })
      } else if (type === 'tool_result') {
        const id = stringValue(record.tool_use_id)
        if (role !== 'user' || !calls.has(id)) throw new Error('tool_result must reference a preceding tool_use in a user message')
        flush()
        let content: unknown = record.content ?? ''
        if (Array.isArray(content)) content = content.map((entry) => textBlock(entry, 'tool_result'))
        else if (typeof content !== 'string') throw new Error('tool_result content must be a string or text blocks')
        if (record.is_error != null && typeof record.is_error !== 'boolean') throw new Error('tool_result is_error must be a boolean')
        messages.push({ role: 'tool', tool_call_id: id, name: calls.get(id), content, is_error: record.is_error })
      } else throw new Error(`Anthropic content block '${type}' is not supported by the local gateway`)
    }
    flush()
  }
  if (input.tools != null && !Array.isArray(input.tools)) throw new Error('tools must be an array')
  const tools = (input.tools as unknown[] | undefined)?.map((value) => {
    const tool = asRecord(value)
    if (tool.type != null && tool.type !== 'custom') throw new Error(`Anthropic server tool '${String(tool.type)}' is not supported by the local gateway`)
    if (tool.defer_loading === true || tool.strict === true || tool.allowed_callers != null || tool.input_examples != null) throw new Error('Anthropic tool controls are not supported by the local gateway')
    return { name: tool.name, description: tool.description, input_schema: tool.input_schema }
  })
  return { model: input.model, messages, tools, stream: input.stream, max_tokens: input.max_tokens,
    temperature: input.temperature, top_p: input.top_p, reasoning_effort: thinking.type === 'disabled' ? 'off' : undefined,
    tool_choice: choice.type === 'tool' ? { type: 'function', function: { name: choice.name } } : undefined }
}

function textBlock(value: unknown, location: string): Record<string, unknown> {
  const block = asRecord(value)
  if (block.type !== 'text' || typeof block.text !== 'string') throw new Error(`Only text blocks are supported in Anthropic ${location}`)
  if (Array.isArray(block.citations) && block.citations.length) throw new Error('Anthropic citations are not supported by the local gateway')
  // cache_control is an optional performance hint, not a generation constraint.
  return { type: 'text', text: block.text }
}
