import { describe, expect, it } from 'vitest'
import { parseAntigravityResult } from './antigravity-result.js'
import { buildAntigravityArgs } from './antigravity-cli-runtime.js'

describe('Antigravity native continuation', () => {
  it('extracts the native id and addresses that exact conversation on follow-up', () => {
    const first = parseAntigravityResult(JSON.stringify({ conversation_id: 'native-123', status: 'SUCCESS', response: 'Hello' }))
    const args = buildAntigravityArgs({ prompt: 'Who are you?', nativeSessionId: first.conversationId,
      model: 'default', timeoutMs: 1000, planMode: true, approvalPolicy: 'never', sandboxMode: 'read-only' })
    expect(args.slice(0, 4)).toEqual(['--print', 'Who are you?', '--output-format', 'json'])
    expect(args[args.indexOf('--conversation') + 1]).toBe('native-123')
    expect(args).not.toContain('--continue')
    expect(parseAntigravityResult(JSON.stringify({ conversation_id: 'native-123', status: 'SUCCESS', response: 'Answer' }), first.conversationId).text).toBe('Answer')
  })

  it('rejects replacement sessions, errors and unstructured output', () => {
    expect(() => parseAntigravityResult(JSON.stringify({ conversation_id: 'other', status: 'SUCCESS', response: 'Wrong session' }), 'native-123')).toThrow('different conversation')
    expect(() => parseAntigravityResult(JSON.stringify({ status: 'ERROR', error: 'login required' }))).toThrow('login required')
    expect(() => parseAntigravityResult('plain text')).toThrow('JSON conversation')
    expect(() => parseAntigravityResult('null')).toThrow('turn failed')
  })
})
