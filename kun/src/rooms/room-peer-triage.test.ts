import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { roomPeerTriage, RoomPeerTriageError } from './room-peer-triage.js'
import { ROOM_TRIAGE_GUIDANCE } from './room-collaboration-guidance.js'

afterEach(() => vi.useRealTimers())
function fixture(chunks: ModelStreamChunk[] = [{ kind: 'assistant_text_delta', text: '{"action":"skip","reason":"Already covered"}' }]) {
  const requests: ModelRequest[] = []
  const client: ModelClient = { provider: 'test', model: 'main', async *stream(request) {
    requests.push(request)
    yield* chunks
  } }
  return { requests, client, input: { client, mainModel: 'main', mainProviderId: 'main-provider', mainAccountId: 'main-account',
    identity: 'triage-topic-member-turn', member: { id: 'developer', displayName: 'Developer', role: 'developer', roleNotes: 'Implementation' },
    updates: [{ body: 'Thanks; that completes the analysis.' }], signal: new AbortController().signal } }
}

describe('peer participation classifier', () => {
  it('uses the configured small-model route and returns its native usage without promoting a skip', async () => {
    const usage: UsageSnapshot = { promptTokens: 123, completionTokens: 14, totalTokens: 137,
      cacheHitTokens: 100, cacheMissTokens: 23, cacheHitRate: 100 / 123, turns: 1, costUsd: 0.001 }
    const f = fixture([{ kind: 'assistant_text_delta', text: '{"action":"skip","reason":"Already covered"}' }, { kind: 'usage', usage }])
    const result = await roomPeerTriage({ ...f.input, roles: { smallModel: 'small',
      smallModelProviderId: 'small-provider', smallModelAccountId: 'small-account' } })
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0]).toMatchObject({ model: 'small', providerId: 'small-provider', accountId: 'small-account',
      tools: [], responseFormat: 'json_object', temperature: 0 })
    expect(f.requests[0].maxTokens).toBeUndefined()
    expect(f.requests[0].reasoningEffort).toBeUndefined()
    expect(result).toMatchObject({ action: 'skip', reason: 'Already covered', model: 'small', usage })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('uses the main binding only when no small model is configured', async () => {
    const f = fixture([{ kind: 'assistant_text_delta', text: '```json\n{"action":"respond","reason":"Unanswered role-specific question"}\n```' }])
    expect(await roomPeerTriage(f.input)).toMatchObject({ action: 'respond', model: 'main' })
    expect(f.requests[0]).toMatchObject({ providerId: 'main-provider', accountId: 'main-account' })
  })

  it.each([
    [{ kind: 'assistant_text_delta', text: '```json\n{"action":"respond","reason":"Unanswered question"}\n```' }],
    [{ kind: 'assistant_text_delta', text: 'Let me think. {"action":"respond","reason":"fallback","execute":true} Hope that helps.' }],
    [{ kind: 'assistant_text_delta', text: '{"action":"respond","reason":"' + 'x'.repeat(501) + '"}' }],
    [{ kind: 'assistant_text_delta', text: '{"action":"respond","reason":"truncated mid-sent' }]
  ] as ModelStreamChunk[][])('accepts verdicts the small model stated despite fences, chatter or truncation', async (...chunks) => {
    const f = fixture(chunks)
    const result = await roomPeerTriage(f.input)
    expect(result.action).toBe('respond')
    expect(result.reason.length).toBeLessThanOrEqual(500)
  })

  it.each([
    [{ kind: 'error', message: '429 rate limited' }],
    [{ kind: 'assistant_text_delta', text: 'please wake the main model instead' }],
    [{ kind: 'assistant_text_delta', text: '{"action":"ponder","reason":"undecided"}' }],
    [{ kind: 'assistant_text_delta', text: '{"reason":"no action stated"}' }],
    []
  ] as ModelStreamChunk[][])('rejects failed or invalid verdicts without escalating or retrying', async (...chunks) => {
    const f = fixture(chunks)
    await expect(roomPeerTriage({ ...f.input, roles: { smallModel: 'small', smallModelProviderId: 'small-provider' } })).rejects.toThrow()
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0].model).toBe('small')
  })

  it('bounds request references and stops oversized streamed output', async () => {
    const f = fixture([{ kind: 'assistant_text_delta', text: 'x'.repeat(4001) }])
    await expect(roomPeerTriage({ ...f.input, updates: ['消息😀\n'.repeat(20000)] })).rejects.toThrow('input exceeds its budget')
    expect(f.requests).toHaveLength(0)
    await expect(roomPeerTriage(f.input)).rejects.toThrow('output budget')
    const message = f.requests[0].history[0]
    expect(message.kind).toBe('user_message')
    if (message.kind === 'user_message') expect(Buffer.byteLength(message.text)).toBeLessThanOrEqual(12000)
  })

  it('preserves reported usage when a reasoning-only response cannot produce a valid verdict', async () => {
    const usage: UsageSnapshot = { promptTokens: 100, completionTokens: 200, totalTokens: 300, cacheHitRate: null, turns: 1 }
    const f = fixture([{ kind: 'assistant_reasoning_delta', text: 'Reasoning exhausted the output budget.' },
      { kind: 'usage', usage }, { kind: 'completed', stopReason: 'length' }])
    const error = await roomPeerTriage(f.input).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(RoomPeerTriageError)
    expect(error).toMatchObject({ model: 'main', usage, elapsedMs: expect.any(Number) })
    expect(f.requests).toHaveLength(1)
  })

  it('preserves usage reported before a terminal provider error without fabricating a verdict', async () => {
    const usage: UsageSnapshot = { promptTokens: 10, completionTokens: 2, totalTokens: 12, cacheHitRate: null, turns: 1 }
    const f = fixture([{ kind: 'usage', usage }, { kind: 'error', message: 'Provider interrupted completion' }])
    await expect(roomPeerTriage(f.input)).rejects.toMatchObject({ name: 'RoomPeerTriageError', model: 'main', usage,
      message: 'Provider interrupted completion' })
  })

  it('propagates caller cancellation during an in-flight stream', async () => {
    const f = fixture(), caller = new AbortController()
    const usage: UsageSnapshot = { promptTokens: 10, completionTokens: 1, totalTokens: 11, cacheHitRate: null, turns: 1 }
    let started!: (signal: AbortSignal) => void
    const streamStarted = new Promise<AbortSignal>((resolve) => { started = resolve })
    f.client.stream = async function* (request) {
      yield { kind: 'usage', usage }
      started(request.abortSignal!)
      await new Promise<void>((_, reject) => request.abortSignal!.addEventListener('abort', () => reject(request.abortSignal!.reason), { once: true }))
      yield { kind: 'completed', stopReason: 'stop' }
    }
    const result = roomPeerTriage({ ...f.input, signal: caller.signal })
    const assertion = expect(result).rejects.toMatchObject({ message: 'User stopped discussion', model: 'main', usage })
    const signal = await streamStarted
    caller.abort(new Error('User stopped discussion'))
    await assertion
    expect(signal.aborted).toBe(true)
  })

  it('does not contact a model when the user cancelled before admission', async () => {
    const f = fixture(), caller = new AbortController()
    caller.abort(new Error('Cancelled before admission'))
    await expect(roomPeerTriage({ ...f.input, signal: caller.signal })).rejects.toThrow('Cancelled before admission')
    expect(f.requests).toHaveLength(0)
  })

  it('aborts a stalled participation request at its bounded deadline', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.client.stream = async function* (request) {
      await new Promise<void>((_, reject) => request.abortSignal!.addEventListener('abort', () => reject(request.abortSignal!.reason), { once: true }))
      yield { kind: 'completed', stopReason: 'stop' }
    }
    const result = roomPeerTriage({ ...f.input, timeoutMs: 250 })
    const assertion = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(250)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })

  it('appends the shared skip guidance while keeping the JSON verdict contract last', async () => {
    const f = fixture()
    await roomPeerTriage(f.input)
    const instructions = f.requests[0].contextInstructions
    expect(instructions).toBeDefined()
    for (const line of ROOM_TRIAGE_GUIDANCE) expect(instructions).toContain(line)
    expect(instructions!.at(-1)).toContain('Return JSON only')
  })

  it('fails before a model request when no route exists', async () => {
    const f = fixture()
    await expect(roomPeerTriage({ ...f.input, mainModel: ' ' })).rejects.toThrow('No model is configured')
    expect(f.requests).toHaveLength(0)
  })
})
