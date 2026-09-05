import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LlmDebugRecorder,
  startLlmDebugRoundIfEnabled
} from './llm-debug-recorder.js'

const meta = {
  threadId: 'thread-policy',
  turnId: 'turn-policy',
  provider: 'compat',
  model: 'model-policy'
}

describe('Agent Perspective thread capture policy', () => {
  it('creates metadata-only rounds when complete content capture is disabled', async () => {
    const recorder = new LlmDebugRecorder({ shouldCapture: async () => false })

    const round = await startLlmDebugRoundIfEnabled(recorder, meta)
    expect(round).toMatchObject({ captureContent: false })
    expect(recorder.activeCaptureCount).toBe(1)
    if (!round) throw new Error('expected metadata round')
    await recorder.finish(round)
    expect(recorder.snapshot()).toHaveLength(1)
  })

  it('snapshots the policy at request start', async () => {
    let enabled = true
    const recorder = new LlmDebugRecorder({ shouldCapture: () => enabled })

    const started = await startLlmDebugRoundIfEnabled(recorder, meta)
    expect(started).toBeDefined()
    enabled = false
    if (!started) throw new Error('expected trace round')
    await recorder.finish(started)

    expect(recorder.snapshot()).toHaveLength(1)
    const disabled = await startLlmDebugRoundIfEnabled(recorder, {
      ...meta,
      turnId: 'turn-disabled'
    })
    expect(disabled).toMatchObject({ captureContent: false })
    if (disabled) await recorder.finish(disabled)
    expect(recorder.snapshot()).toHaveLength(2)
  })

  it('fails closed without throwing when the policy lookup fails', async () => {
    const onError = vi.fn()
    const recorder = new LlmDebugRecorder({
      shouldCapture: async () => {
        throw new Error('thread store unavailable')
      }
    })

    await expect(startLlmDebugRoundIfEnabled(recorder, meta, onError))
      .resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
    expect(recorder.snapshot()).toEqual([])
  })

  it('omits unresolved raw arguments from decoded and persisted HTTP traces', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-llm-raw-redaction-'))
    const recorder = new LlmDebugRecorder({ dataDir })
    const raw = '{"plan":{"title":"private-debug-marker"'
    try {
      const round = recorder.start(meta)
      const record = recorder.beginHttpAttempt(round, {
        endpointFormat: 'openai',
        attempt: 1,
        reason: 'initial',
        url: 'https://example.com/v1/chat/completions',
        headers: {},
        bodyText: '{}'
      })
      recorder.captureHttpResponse(round, record, new Response(
        `data: {"arguments":${JSON.stringify(raw)}}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      ))
      recorder.captureChunk(round, {
        kind: 'tool_call_complete',
        callId: 'call-raw',
        toolName: 'graph_define_plan',
        arguments: { __raw: raw }
      })
      await recorder.finish(round)

      expect(recorder.snapshot()[0]?.output.toolCalls[0]?.arguments).toEqual({})
      const retained = await recorder.listThread(meta.threadId)
      expect(retained.records[0]?.response?.body).toBeUndefined()
      expect(retained.records[0]?.request?.body).toMatchObject({ text: '', originalBytes: 0 })
      const tracePath = join(
        dataDir,
        'observability',
        'trajectory',
        'records',
        `${Buffer.from(meta.threadId, 'utf8').toString('base64url')}.jsonl`
      )
      const jsonl = await readFile(tracePath, 'utf8')
      expect(JSON.stringify(recorder.snapshot())).not.toContain('private-debug-marker')
      expect(JSON.stringify(retained)).not.toContain('private-debug-marker')
      expect(jsonl).not.toContain('private-debug-marker')
    } finally {
      await recorder.shutdown()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
