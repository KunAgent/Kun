import { describe, expect, it } from 'vitest'
import { modelInputHasNoTextBound } from './model-input-bound.js'

describe('conservative input bounds inspect protocol semantics', () => {
  it('does not classify file/image property names inside ordinary schemas and text as media', () => {
    expect(modelInputHasNoTextBound({ messages: [{ role: 'user', content: 'Return an image_url and file_id in JSON.' }],
      tools: [{ type: 'function', function: { name: 'read', parameters: { properties: { file_id: { type: 'string' } } } } }],
      response_format: { type: 'json_schema', json_schema: { schema: { properties: { image_url: { type: 'string' } } } } } })).toBe(false)
  })
  it('rejects media content and nested tool result media in all three wire families', () => {
    for (const body of [
      { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }] },
      { input: [{ type: 'message', content: [{ type: 'input_image', image_url: 'https://example.test/image' }] }] },
      { messages: [{ content: [{ type: 'tool_result', content: [{ type: 'image', source: {} }] }] }] },
      { input: [{ type: 'function_call_output', output: [{ type: 'input_file', file_id: 'file-1' }] }] }
    ]) expect(modelInputHasNoTextBound(body)).toBe(true)
  })
  it('rejects provider-managed state and server tools without confusing normal function input', () => {
    expect(modelInputHasNoTextBound({ previous_response_id: 'response-1' })).toBe(true)
    expect(modelInputHasNoTextBound({ input: [{ type: 'reasoning', encrypted_content: 'opaque' }] })).toBe(true)
    expect(modelInputHasNoTextBound({ tools: [{ type: 'web_search_preview' }] })).toBe(true)
    expect(modelInputHasNoTextBound({ messages: [{ content: [{ type: 'tool_use', input: { image_url: 'text' } }] }] })).toBe(false)
  })
})
