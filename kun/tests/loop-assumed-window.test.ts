import { describe, expect, it } from 'vitest'
import { metadataEvidence } from '../src/contracts/model-metadata-evidence.js'
import type { ModelCapabilityMetadata } from '../src/contracts/capabilities.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

/**
 * A model without a registered profile gets a conservative 32k window whose
 * evidence is `unknown`. That number is a guess, so it must never be the
 * reason a conversation turn is rejected: a real window is checked by the
 * provider, and a declared window is still enforced locally.
 */
function capabilities(model: string, declared: boolean): ModelCapabilityMetadata {
  return {
    id: model,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    contextWindowTokens: 500,
    messageParts: ['text'],
    ...(declared ? {} : { evidence: metadataEvidence({}, 'adapter') })
  }
}

async function runOversizedTurn(declared: boolean) {
  const requests: ModelRequest[] = []
  const h = makeHarness({
    provider: 'window-guess',
    model: 'window-guess',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      requests.push(request)
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }, {
    tools: [],
    compactor: new ContextCompactor({ softThreshold: 100, hardThreshold: 200 }),
    modelCapabilities: (model) => capabilities(model, declared)
  })
  await bootstrapThread(h, { request: { prompt: `oversized current input ${'x'.repeat(4_000)}` } })
  const outcome = await h.loop.runTurn(h.threadId, h.turnId)
  const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
  return { outcome, requests, events }
}

describe('AgentLoop with an assumed context window', () => {
  it('still dispatches when the request outgrows a window that is only an estimate', async () => {
    const { outcome, requests, events } = await runOversizedTurn(false)

    expect(outcome).not.toBe('failed')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.maxTokens).toBeGreaterThan(1)
    expect(events.some((event) => event.kind === 'error' && event.code === 'context_window_exceeded')).toBe(false)
  })

  it('keeps rejecting an oversized request against a declared window', async () => {
    const { outcome, requests, events } = await runOversizedTurn(true)

    expect(outcome).toBe('failed')
    expect(requests).toHaveLength(0)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'context_window_exceeded'
    }))
  })
})
