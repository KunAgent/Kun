import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { antigravityUsageSnapshot, parseAntigravityResult } from './antigravity-result.js'
import { buildAntigravityArgs } from './antigravity-cli-runtime.js'

describe('Antigravity native continuation', () => {
  it('extracts the native id and addresses that exact conversation on follow-up', () => {
    const first = parseAntigravityResult(JSON.stringify({ conversation_id: 'native-123', status: 'SUCCESS', response: 'Hello' }))
    const args = buildAntigravityArgs({ prompt: 'Who are you?', nativeSessionId: first.conversationId,
      model: 'default', timeoutMs: 1000, planMode: true, approvalPolicy: 'never', sandboxMode: 'read-only' })
    expect(args.slice(0, 4)).toEqual(['--print', 'Who are you?', '--output-format', 'stream-json'])
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

  it('finds the result at the end of a stream-json run and reads its summed usage', () => {
    // A real two-step turn: a tool call, then the answer. The result's usage is the sum of both steps.
    const lines = (JSON.parse(readFileSync(new URL('./__fixtures__/agy-stream-tool.json', import.meta.url), 'utf8')) as Array<[number, string]>)
      .map(([, line]) => line)
    const parsed = parseAntigravityResult(`${lines.join('\n')}\n`)
    expect(parsed.text).toBe('该命令的输出为 `kun-probe`。')
    expect(parsed.conversationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(parsed.usage).toEqual({ inputTokens: 24370, outputTokens: 352, thinkingTokens: 216, cacheReadTokens: 0, totalTokens: 24722 })
    // Log noise before or between events does not hide the result.
    expect(parseAntigravityResult(`warning: slow disk\n${lines.join('\n')}\n`).text).toBe('该命令的输出为 `kun-probe`。')
    expect(() => parseAntigravityResult(lines.slice(0, -1).join('\n'))).toThrow('JSON conversation')
  })

  it('still reads the single JSON object of --output-format json, with or without usage', () => {
    const base = { conversation_id: 'native-9', status: 'SUCCESS', response: 'Hi' }
    expect(parseAntigravityResult(JSON.stringify(base)).usage).toBeUndefined()
    expect(parseAntigravityResult(JSON.stringify({ ...base, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } })).usage).toBeUndefined()
    expect(parseAntigravityResult(JSON.stringify(base, null, 2)).text).toBe('Hi')
    expect(parseAntigravityResult(JSON.stringify({ ...base, usage: { input_tokens: 10, output_tokens: 4, thinking_tokens: 3, cache_read_tokens: 5, total_tokens: 14 } })).usage)
      .toEqual({ inputTokens: 10, outputTokens: 4, thinkingTokens: 3, cacheReadTokens: 5, totalTokens: 14 })
  })

  it('maps the CLI usage onto the usage every Agent reports', () => {
    expect(antigravityUsageSnapshot({ inputTokens: 12_010, outputTokens: 2_305, thinkingTokens: 2_070, cacheReadTokens: 0, totalTokens: 14_315 })).toEqual({
      promptTokens: 12_010, completionTokens: 2_305, reasoningTokens: 2_070, totalTokens: 14_315, cacheHitRate: null, turns: 0
    })
    expect(antigravityUsageSnapshot({ inputTokens: 1_000, outputTokens: 50, thinkingTokens: 0, cacheReadTokens: 400, totalTokens: 0 })).toEqual({
      promptTokens: 1_000, completionTokens: 50, totalTokens: 1_050, cacheHitRate: 0.4, turns: 0,
      cachedTokens: 400, cacheHitTokens: 400, cacheMissTokens: 600
    })
  })
})
