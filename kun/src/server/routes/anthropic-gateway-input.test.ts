import { describe, expect, it } from 'vitest'
import { anthropicToChatInput } from './anthropic-gateway-input.js'

const base = { model: 'coding', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }

describe('Anthropic request fields from current clients', () => {
  it('accepts what Claude Code sends: clear_thinking keep-all, adaptive thinking and output effort', () => {
    // Captured from Claude Code 2.1.291 against a local gateway.
    const input = anthropicToChatInput({ ...base, stream: true,
      context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
      thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'high' },
      metadata: { user_id: '{"device_id":"d","account_uuid":"","session_id":"s"}' } })
    expect(input).toMatchObject({ model: 'coding', reasoning_effort: 'high' })
    expect(JSON.stringify(input)).not.toContain('context_management')
  })
  it('folds system messages sent inside messages into the system prompt, text only', () => {
    const input = anthropicToChatInput({ ...base, system: 'base', messages: [{ role: 'user', content: 'hi' },
      { role: 'system', content: [{ type: 'text', text: '# Environment', cache_control: { type: 'ephemeral' } }] }] })
    expect((input.messages as { role: string }[]).map((message) => message.role)).toEqual(['system', 'user', 'system'])
    expect(() => anthropicToChatInput({ ...base, messages: [{ role: 'system', content: [{ type: 'image', source: {} }] }] })).toThrow()
    expect(() => anthropicToChatInput({ ...base, messages: [{ role: 'tool', content: 'x' }] })).toThrow('user, assistant or system')
  })
  it('accepts tool-use clearing as advisory and refuses unknown context edits', () => {
    expect(() => anthropicToChatInput({ ...base, context_management: { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 1 } }] } })).not.toThrow()
    expect(() => anthropicToChatInput({ ...base, context_management: { edits: [{ type: 'compact_20260101' }] } })).toThrow("edit 'compact_20260101'")
    expect(() => anthropicToChatInput({ ...base, context_management: { edits: [], extra: true } })).toThrow('only an edits array')
    expect(() => anthropicToChatInput({ ...base, container: 'c' })).toThrow('container')
  })
})
