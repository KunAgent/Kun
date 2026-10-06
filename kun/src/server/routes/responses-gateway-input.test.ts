import { describe, expect, it } from 'vitest'
import { makeModelRequest, responsesToChatInput } from './model-gateway-core.js'

describe('Responses input from current clients', () => {
  it('turns replayed reasoning items into reasoning history and ignores encrypted content', () => {
    // Shape Codex 0.145 sends back after a gateway reply with reasoning.
    const chat = responsesToChatInput({ model: 'coding', input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'read it' }] },
      { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Plan: read the fixture.' }], encrypted_content: null },
      { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"cat fixture.txt"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'ok' },
      { type: 'reasoning', id: 'rs_2', summary: [] }
    ] })
    const request = makeModelRequest(chat, new AbortController().signal)
    expect(request.history.map((item) => item.kind)).toEqual(['user_message', 'assistant_reasoning', 'tool_call', 'tool_result'])
    expect(request.history[1]).toMatchObject({ text: 'Plan: read the fixture.' })
  })
  it('refuses reasoning entries it cannot read', () => {
    expect(() => responsesToChatInput({ model: 'm', input: [{ type: 'reasoning', summary: [{ type: 'image', url: 'x' }] }] })).toThrow('summary_text')
    expect(() => responsesToChatInput({ model: 'm', input: [{ type: 'web_search_call' }] })).toThrow("'web_search_call'")
  })
})
