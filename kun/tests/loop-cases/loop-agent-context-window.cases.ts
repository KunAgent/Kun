import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../src/domain/thread.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import { makeHarness } from '../loop-test-harness.js'

describe('AgentLoop context window capacity', () => {
  it('derives the send cap from the provider-declared context window', async () => {
    // A model whose context window comes only from provider capability
    // metadata must not be clamped to the 256k fallback: the send guard uses
    // 85% of the declared window.
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'declared-window',
      model: 'gpt-6-sol',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'assistant_text_delta', text: 'ok' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 750_000, hardThreshold: 892_500 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 1_050_000,
        messageParts: ['text']
      })
    })
    await h.threadStore.upsert(
      createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'gpt-6-sol' })
    )
    const started = await h.turns.startTurn({ threadId: h.threadId, request: { prompt: 'go' } })
    h.turnId = started.turnId

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const compressed = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'input_compressed'
    )
    expect(compressed).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'input_compressed',
      details: expect.objectContaining({ requestHardCapTokens: 892_500 })
    })
    const snapshot = events.find((event) => event.kind === 'context_snapshot')
    expect(snapshot?.kind === 'context_snapshot' ? snapshot.contextWindowTokens : 0).toBe(1_050_000)
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'context_window_exceeded'
    )).toBe(false)
  })

  it('keeps a 256k model on the 217600 send cap', async () => {
    const requests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'small-window',
      model: 'grok-4.5',
      async *stream(request): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        yield { kind: 'assistant_text_delta', text: 'ok' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 192_000, hardThreshold: 217_600 }),
      modelCapabilities: (model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        contextWindowTokens: 256_000,
        messageParts: ['text']
      })
    })
    await h.threadStore.upsert(
      createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'grok-4.5' })
    )
    const started = await h.turns.startTurn({ threadId: h.threadId, request: { prompt: 'go' } })
    h.turnId = started.turnId

    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    const compressed = events.find((event) =>
      event.kind === 'pipeline_stage' && event.stage === 'input_compressed'
    )
    expect(compressed).toMatchObject({
      kind: 'pipeline_stage',
      stage: 'input_compressed',
      details: expect.objectContaining({ requestHardCapTokens: 217_600 })
    })
  })

})
