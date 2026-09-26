import { describe, expect, it } from 'vitest'
import {
  CONTEXT_WINDOW_TOOL_NAMES,
  CONTEXT_WINDOWS_TEXT_MAX_CHARS,
  contextWindowToolSpecs
} from '../../contracts/context-windows.js'
import type { ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'
import type { ModelRequest, ModelToolSpec } from '../../ports/model-client.js'
import { projectAnthropicToolInputSchema } from './anthropic-tool-schema-projection.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'
import {
  COMPAT_HISTORY_CONTEXT,
  COMPAT_TOOL_RESULT_ERROR,
  type CompatChatMessage
} from './compat-request-codecs.js'

function windowTools(): ModelToolSpec[] {
  return contextWindowToolSpecs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema
  }))
}

function request(model: string): ModelRequest {
  return {
    threadId: 'thread-cw',
    turnId: 'turn-cw',
    model,
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

function build(
  endpointFormat: ModelEndpointFormat,
  tools: ModelToolSpec[],
  messages: CompatChatMessage[] = []
): Record<string, unknown> {
  return createCompatRequestCodecs().build({
    request: request('window-model'),
    model: 'window-model',
    messages,
    tools,
    stream: true,
    endpointFormat,
    baseUrl: 'https://provider.example/v1',
    isCodex: false,
    isCodexLite: false,
    codexNativeImageGeneration: false
  })
}

function wireTools(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return body.tools as Array<Record<string, unknown>>
}

describe('context window tool declarations across endpoint formats', () => {
  const formats: Array<{ endpointFormat: ModelEndpointFormat; schemaKey: string }> = [
    { endpointFormat: 'chat_completions', schemaKey: 'function' },
    { endpointFormat: 'responses', schemaKey: 'parameters' },
    { endpointFormat: 'messages', schemaKey: 'input_schema' }
  ]

  it('converts all ten window tools for every endpoint family', () => {
    for (const { endpointFormat } of formats) {
      const body = build(endpointFormat, windowTools())
      const tools = wireTools(body)
      expect(tools).toHaveLength(CONTEXT_WINDOW_TOOL_NAMES.length)
      const names = tools.map((tool) =>
        endpointFormat === 'chat_completions'
          ? (tool.function as Record<string, unknown>).name
          : tool.name
      )
      expect([...names].sort()).toEqual([...CONTEXT_WINDOW_TOOL_NAMES].sort())
    }
  })

  it('keeps the plain JSON Schema byte-identical for chat completions', () => {
    const tools = wireTools(build('chat_completions', windowTools()))
    for (const spec of contextWindowToolSpecs) {
      const entry = tools.find(
        (tool) => (tool.function as Record<string, unknown>).name === spec.name
      )
      expect(entry?.type).toBe('function')
      const fn = entry?.function as Record<string, unknown>
      expect(fn.description).toBe(spec.description)
      expect(fn.parameters).toEqual(spec.inputSchema)
    }
  })

  it('keeps the plain JSON Schema intact for OpenAI responses', () => {
    const tools = wireTools(build('responses', windowTools()))
    for (const spec of contextWindowToolSpecs) {
      const entry = tools.find((tool) => tool.name === spec.name)
      expect(entry?.type).toBe('function')
      expect(entry?.description).toBe(spec.description)
      expect(entry?.parameters).toEqual(spec.inputSchema)
    }
  })

  it('projects schemas through the anthropic envelope while preserving constraints', () => {
    const tools = wireTools(build('messages', windowTools()))
    for (const spec of contextWindowToolSpecs) {
      const entry = tools.find((tool) => tool.name === spec.name)
      expect(entry?.description).toBe(spec.description)
      expect(entry?.input_schema).toEqual(projectAnthropicToolInputSchema(spec.inputSchema))
      const schema = entry?.input_schema as Record<string, unknown>
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
    }
  })

  it('advertises new_context as a sealed empty-object schema on every family', () => {
    for (const { endpointFormat, schemaKey } of formats) {
      const tools = wireTools(build(endpointFormat, windowTools()))
      const entry = tools.find((tool) =>
        endpointFormat === 'chat_completions'
          ? (tool.function as Record<string, unknown>).name === 'new_context'
          : tool.name === 'new_context'
      )
      const schema = (
        schemaKey === 'function'
          ? (entry?.function as Record<string, unknown>).parameters
          : entry?.[schemaKey]
      ) as Record<string, unknown>
      expect(schema).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false })
    }
  })

  it('retains required fields and bounds in the anthropic projection', () => {
    const tools = wireTools(build('messages', windowTools()))
    const byName = new Map(tools.map((tool) => [tool.name, tool.input_schema as Record<string, unknown>]))

    expect(byName.get('history_list_items')?.required).toEqual(['windowId'])
    expect(byName.get('history_read_item')?.required).toEqual(['windowId', 'itemId'])
    expect(byName.get('notes_append_to_file')?.required).toEqual(['path', 'text', 'operationId'])
    expect(byName.get('notes_write_file')?.required).toEqual(['path', 'text', 'expectedRevision'])
    const pageSize = (byName.get('history_list_windows')?.properties as Record<string, unknown>)
      .pageSize as Record<string, unknown>
    expect(pageSize.minimum).toBe(1)
    expect(pageSize.maximum).toBe(100)
    const noteText = (byName.get('notes_write_file')?.properties as Record<string, unknown>)
      .text as Record<string, unknown>
    expect(noteText.maxLength).toBe(CONTEXT_WINDOWS_TEXT_MAX_CHARS)
  })

  it('declares the 16 KiB write-text bound on both write tools for every family', () => {
    for (const { endpointFormat, schemaKey } of formats) {
      const tools = wireTools(build(endpointFormat, windowTools()))
      for (const writeTool of ['notes_append_to_file', 'notes_write_file']) {
        const entry = tools.find((tool) =>
          endpointFormat === 'chat_completions'
            ? (tool.function as Record<string, unknown>).name === writeTool
            : tool.name === writeTool
        )
        const schema = (
          schemaKey === 'function'
            ? (entry?.function as Record<string, unknown>).parameters
            : entry?.[schemaKey]
        ) as Record<string, unknown>
        const text = (schema.properties as Record<string, unknown>).text as Record<string, unknown>
        expect(text.maxLength).toBe(16 * 1024)
        expect(text.minLength).toBe(1)
      }
    }
  })

  it('never leaks local provenance fields into any wire declaration', () => {
    const tools = windowTools().map((tool) => ({
      ...tool,
      sideEffect: 'read-only' as const,
      providerKind: 'built-in' as const,
      providerId: 'builtin'
    }))
    for (const { endpointFormat } of formats) {
      const serialized = JSON.stringify(build(endpointFormat, tools))
      expect(serialized).not.toContain('providerKind')
      expect(serialized).not.toContain('providerId')
      expect(serialized).not.toContain('"sideEffect"')
    }
  })

  it('keeps an Anthropic request valid when a new window has only system context', () => {
    const body = build('messages', windowTools(), [
      { role: 'system', content: 'stable instructions' },
      {
        role: 'system',
        content: '[context window 1 initialized]\nCurrent task message: item-user.',
        [COMPAT_HISTORY_CONTEXT]: true
      }
    ])
    const messages = body.messages as Array<{ role: string; content: unknown }>

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
    const continuation = JSON.stringify(messages[0]?.content)
    expect(continuation).toContain('The requested new_context action has completed.')
    expect(continuation).toContain('Do not invoke new_context again')
    expect(continuation).toContain('First use history_read_item to read the Current task message')
    expect(JSON.stringify(body.system)).toContain('Current task message: item-user.')
  })
})

describe('context window tool call/result round trip', () => {
  const unicodeText = `${' Plans for the release: \u53d1\u5e03\u8ba1\u5212 '.repeat(64)} \u00e9\u00e8\u00ea ${'\u{1f600}'.repeat(64)}`

  function toolRoundTripMessages(
    toolName: string,
    args: Record<string, unknown>,
    resultText: string
  ): CompatChatMessage[] {
    return [
      { role: 'user', content: 'please run the tool' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call-cw-1',
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(args) }
        }]
      },
      { role: 'tool', content: resultText, tool_call_id: 'call-cw-1' }
    ]
  }

  function utf8BoundedRepeat(base: string, maxBytes: number): string {
    const encoder = new TextEncoder()
    let text = ''
    while (encoder.encode(text + base).length <= maxBytes) text += base
    return text
  }

  it('round trips a 16 KiB unicode notes_write_file call through chat completions', () => {
    const args = {
      path: 'notes/plan.md',
      text: utf8BoundedRepeat(unicodeText, 16 * 1024),
      expectedRevision: 3
    }
    expect(args.text.length).toBeGreaterThan(0)
    expect(new TextEncoder().encode(args.text).length).toBeLessThanOrEqual(16 * 1024)
    const messages = toolRoundTripMessages(
      'notes_write_file',
      args,
      JSON.stringify({ status: 'ok', path: 'notes/plan.md', revision: 4 })
    )

    const body = build('chat_completions', windowTools(), messages)
    const wireMessages = body.messages as CompatChatMessage[]
    const assistant = wireMessages.find((message) => message.role === 'assistant')
    const call = assistant?.tool_calls?.[0]
    expect(call?.function.name).toBe('notes_write_file')
    expect(JSON.parse(call?.function.arguments ?? '{}')).toEqual(args)
    const result = wireMessages.find((message) => message.role === 'tool')
    expect(result?.tool_call_id).toBe('call-cw-1')
    expect(result?.content).toContain('"revision":4')
  })

  it('round trips a 16 KiB unicode notes_append_to_file call through anthropic messages', () => {
    const args = {
      path: 'notes/log.md',
      text: utf8BoundedRepeat(`${'\u65e5\u5fd7 '.repeat(37)}\u{1f525}`, 16 * 1024),
      operationId: 'op-cw-42'
    }
    const resultText = JSON.stringify({ path: 'notes/log.md', revision: 9, operationId: 'op-cw-42' })
    const messages = toolRoundTripMessages('notes_append_to_file', args, resultText)

    const body = build('messages', windowTools(), messages)
    const wireMessages = body.messages as Array<{
      role: string
      content: Array<Record<string, unknown>>
    }>
    const assistant = wireMessages.find((message) => message.role === 'assistant')
    const toolUse = assistant?.content.find((block) => block.type === 'tool_use')
    expect(toolUse).toMatchObject({ id: 'call-cw-1', name: 'notes_append_to_file' })
    expect(toolUse?.input).toEqual(args)
    const resultCarrier = wireMessages.find(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'tool_result')
    )
    const toolResult = resultCarrier?.content.find((block) => block.type === 'tool_result')
    expect(toolResult).toMatchObject({ tool_use_id: 'call-cw-1', content: resultText })
  })

  it('round trips the same call through OpenAI responses as function_call items', () => {
    const args = { query: 'release blocker', pageSize: 50 }
    const resultText = JSON.stringify({ query: 'release blocker', matches: [], nextCursor: null })
    const messages = toolRoundTripMessages('history_search_contents', args, resultText)

    const body = build('responses', windowTools(), messages)
    const input = body.input as Array<Record<string, unknown>>
    const call = input.find((item) => item.type === 'function_call')
    expect(call).toMatchObject({
      call_id: 'call-cw-1',
      name: 'history_search_contents',
      arguments: JSON.stringify(args)
    })
    const output = input.find((item) => item.type === 'function_call_output')
    expect(output).toMatchObject({ call_id: 'call-cw-1', output: resultText })
    expect(JSON.parse(String(call?.arguments))).toEqual(args)
  })

  it('round trips new_context({}) as an empty object on every family', () => {
    const messages = toolRoundTripMessages('new_context', {}, JSON.stringify({ windowId: 'win-7', windowSeq: 7 }))

    const chat = build('chat_completions', windowTools(), messages)
    const chatAssistant = (chat.messages as CompatChatMessage[]).find((m) => m.role === 'assistant')
    expect(JSON.parse(chatAssistant?.tool_calls?.[0]?.function.arguments ?? '{"x":1}')).toEqual({})

    const responses = build('responses', windowTools(), messages)
    const responsesCall = (responses.input as Array<Record<string, unknown>>)
      .find((item) => item.type === 'function_call')
    expect(JSON.parse(String(responsesCall?.arguments))).toEqual({})

    const anthropic = build('messages', windowTools(), messages)
    const anthropicAssistant = (anthropic.messages as Array<{ content: Array<Record<string, unknown>> }>)
      .find((message) => message.content.some((block) => block.type === 'tool_use'))
    const toolUse = anthropicAssistant?.content.find((block) => block.type === 'tool_use')
    expect(toolUse?.input).toEqual({})
  })

  it('carries a failed tool result into an anthropic tool_result block with is_error', () => {
    const messages: CompatChatMessage[] = [
      { role: 'user', content: 'read the note' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call-cw-err',
          type: 'function',
          function: { name: 'notes_read_file', arguments: JSON.stringify({ path: 'missing.md' }) }
        }]
      },
      {
        role: 'tool',
        content: JSON.stringify({ error: 'note file not found' }),
        tool_call_id: 'call-cw-err',
        [COMPAT_TOOL_RESULT_ERROR]: true
      }
    ]

    const body = build('messages', windowTools(), messages)
    const wireMessages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>
    const resultCarrier = wireMessages.find(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'tool_result')
    )
    const toolResult = resultCarrier?.content.find((block) => block.type === 'tool_result')
    expect(toolResult).toMatchObject({
      tool_use_id: 'call-cw-err',
      content: JSON.stringify({ error: 'note file not found' }),
      is_error: true
    })
  })
})
