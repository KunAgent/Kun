import { describe, expect, it } from 'vitest'
import { LlmDebugRecorder } from '../src/services/llm-debug-recorder.js'

function beginRequestAttempt(
  recorder: LlmDebugRecorder,
  round: ReturnType<LlmDebugRecorder['start']>,
  body: Record<string, unknown>
): void {
  recorder.beginHttpAttempt(round, {
    endpointFormat: 'chat_completions',
    attempt: 1,
    reason: 'initial',
    url: 'https://example.test/v1/chat/completions',
    headers: {},
    bodyText: JSON.stringify(body)
  })
}

async function record(recorder: LlmDebugRecorder, model: string): Promise<void> {
  const round = recorder.start({ threadId: 't', turnId: 'u', provider: 'compat', model })
  beginRequestAttempt(recorder, round, { model })
  recorder.captureChunk(round, { kind: 'assistant_text_delta', text: `out:${model}` })
  await recorder.finish(round)
}

describe('LlmDebugRecorder', () => {
  it('keeps only the most recent 25 rounds', async () => {
    const recorder = new LlmDebugRecorder()
    for (let i = 1; i <= 30; i++) await record(recorder, `m${i}`)
    const snapshot = recorder.snapshot()
    expect(snapshot).toHaveLength(25)
    // Oldest five (m1..m5) dropped; m6 is the oldest retained.
    expect(snapshot[snapshot.length - 1]?.model).toBe('m6')
  })

  it('returns the snapshot most-recent first', async () => {
    const recorder = new LlmDebugRecorder()
    await record(recorder, 'a')
    await record(recorder, 'b')
    const snapshot = recorder.snapshot()
    expect(snapshot.map((r) => r.model)).toEqual(['b', 'a'])
    expect(snapshot[0]?.requestBody).toEqual({ model: 'b' })
    expect(snapshot[0]?.exchanges[0]).toMatchObject({
      endpointFormat: 'chat_completions',
      attempt: 1,
      attemptReason: 'initial',
      request: { body: { text: JSON.stringify({ model: 'b' }) } }
    })
    expect(snapshot[0]?.output.text).toBe('out:b')
  })

  it('clear empties the buffer', async () => {
    const recorder = new LlmDebugRecorder()
    await record(recorder, 'a')
    recorder.clear()
    expect(recorder.snapshot()).toHaveLength(0)
  })

  it('retains only a bounded prefix of oversized request bodies', async () => {
    const recorder = new LlmDebugRecorder({
      maxRequestBodyBytes: 96,
      maxRoundBytes: 1_024,
      maxTotalBytes: 4_096
    })
    const round = recorder.start({ threadId: 't', turnId: 'u', provider: 'compat', model: 'm' })
    beginRequestAttempt(recorder, round, { prompt: '💡'.repeat(1_000) })
    await recorder.finish(round)

    const captured = recorder.snapshot()[0]
    const request = captured?.exchanges[0]?.request.body
    expect(captured?.requestBodyTruncated).toBe(true)
    expect(captured?.requestBodyOriginalBytes).toBeGreaterThan(96)
    expect(captured?.requestBody).toMatchObject({ __debugTruncated: true })
    expect(request).toMatchObject({ truncated: true })
    expect(request?.originalBytes).toBeGreaterThan(96)
    expect(request?.capturedBytes).toBeLessThanOrEqual(96)
    expect(Buffer.byteLength(request?.text ?? '', 'utf8')).toBeLessThanOrEqual(96)
  })

  it('bounds streamed output bytes without repeatedly joining prior chunks', async () => {
    const recorder = new LlmDebugRecorder({
      maxRequestBodyBytes: 64,
      maxRoundBytes: 128,
      maxTotalBytes: 4_096
    })
    const round = recorder.start({ threadId: 't', turnId: 'u', provider: 'compat', model: 'm' })
    expect(recorder.activeCaptureCount).toBe(1)
    beginRequestAttempt(recorder, round, { model: 'm' })
    for (let index = 0; index < 100; index += 1) {
      recorder.captureChunk(round, { kind: 'assistant_text_delta', text: '"\\\n💡'.repeat(10) })
    }
    await recorder.finish(round)
    expect(recorder.activeCaptureCount).toBe(0)

    const captured = recorder.snapshot()[0]
    expect(captured?.output.truncated?.text).toBe(true)
    expect(Buffer.byteLength(captured?.output.text ?? '', 'utf8')).toBeLessThan(128)
    expect(Buffer.byteLength(JSON.stringify(captured?.output.text), 'utf8')).toBeLessThan(128)
    expect(captured?.output.text).not.toContain('\ufffd')
  })

  it('evicts old rounds when the global byte budget is exhausted', async () => {
    const recorder = new LlmDebugRecorder({
      capacity: 25,
      maxRequestBodyBytes: 64,
      maxRoundBytes: 512,
      maxTotalBytes: 2_000
    })
    for (const model of ['a', 'b', 'c']) {
      const round = recorder.start({ threadId: 't', turnId: model, provider: 'compat', model })
      beginRequestAttempt(recorder, round, { model })
      recorder.captureChunk(round, { kind: 'assistant_text_delta', text: model.repeat(250) })
      await recorder.finish(round)
    }

    const snapshot = recorder.snapshot()
    expect(snapshot.length).toBeLessThan(3)
    expect(snapshot[0]?.model).toBe('c')
    expect(snapshot.reduce((total, round) => total + (round.retainedBytes ?? 0), 0)).toBeLessThanOrEqual(2_000)
  })
})
