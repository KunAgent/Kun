import { describe, it, expect } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { MoaConfigAdapter } from './moa-config.js'
import { MoaDispatchModelClient } from './moa-model-client.js'

/**
 * Fake underlying model client that echoes which model/provider it was asked
 * for, so we can assert MoA routes proposers/aggregator correctly.
 */
class RecordingModelClient implements ModelClient {
  readonly provider = 'recording'
  readonly model = 'recording'
  readonly requests: ModelRequest[] = []
  maxConcurrent = 0
  private inFlight = 0

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    this.inFlight += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight)
    // Yield control so concurrent streams overlap before decrementing.
    await new Promise((resolve) => setTimeout(resolve, 1))
    yield { kind: 'assistant_text_delta', text: `out:${request.model}` }
    yield { kind: 'completed', stopReason: 'stop' }
    this.inFlight -= 1
  }
}

function makeRequest(model: string): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'turn1',
    model,
    providerId: 'moa',
    systemPrompt: 'sys',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

async function collectText(stream: AsyncIterable<ModelStreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
  }
  return text
}

describe('MoaDispatchModelClient', () => {
  const config = {
    maxConcurrentProposers: 2,
    presets: [
      {
        id: 'p-two',
        name: 'Two Proposers',
        description: 'two proposers + aggregator',
        layers: [
          { type: 'proposer' as const, models: ['default/m1', 'default/m2'] },
          { type: 'aggregator' as const, models: ['default/agg'] }
        ],
        costMultiplier: 3,
        enabled: true
      },
      {
        id: 'p-three',
        name: 'Three Proposers',
        description: 'three proposers + aggregator',
        layers: [
          { type: 'proposer' as const, models: ['default/a', 'default/b', 'default/c'] },
          { type: 'aggregator' as const, models: ['default/agg2'] }
        ],
        costMultiplier: 4,
        enabled: true
      }
    ]
  }

  it('routes to the preset named by the stable moa:{presetId} model id', async () => {
    const adapter = new MoaConfigAdapter({ rawConfig: config })
    const underlying = new RecordingModelClient()
    const dispatch = new MoaDispatchModelClient({ configAdapter: adapter, multiProviderClient: underlying })

    const text = await collectText(dispatch.stream(makeRequest('moa:p-two')))

    // Aggregator output is streamed out.
    expect(text).toBe('out:agg')
    // 2 proposers + 1 aggregator = 3 underlying requests.
    expect(underlying.requests.map(r => r.model)).toEqual(['m1', 'm2', 'agg'])
  })

  it('supports multiple presets through the same dispatcher (no provider collision)', async () => {
    const adapter = new MoaConfigAdapter({ rawConfig: config })
    const underlying = new RecordingModelClient()
    const dispatch = new MoaDispatchModelClient({ configAdapter: adapter, multiProviderClient: underlying })

    await collectText(dispatch.stream(makeRequest('moa-p-two')))
    await collectText(dispatch.stream(makeRequest('moa-p-three')))

    // Second preset used 3 proposers + 1 aggregator.
    const models = underlying.requests.map(r => r.model)
    expect(models).toContain('agg') // from p-two
    expect(models).toContain('agg2') // from p-three
    expect(models).toContain('a')
    expect(models).toContain('c')
  })

  it('respects maxConcurrentProposers', async () => {
    const adapter = new MoaConfigAdapter({ rawConfig: config })
    const underlying = new RecordingModelClient()
    const dispatch = new MoaDispatchModelClient({ configAdapter: adapter, multiProviderClient: underlying })

    await collectText(dispatch.stream(makeRequest('moa-p-three')))

    // 3 proposers with a cap of 2 -> concurrency never exceeds 2.
    expect(underlying.maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('emits an error chunk for an unknown preset', async () => {
    const adapter = new MoaConfigAdapter({ rawConfig: config })
    const underlying = new RecordingModelClient()
    const dispatch = new MoaDispatchModelClient({ configAdapter: adapter, multiProviderClient: underlying })

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of dispatch.stream(makeRequest('moa-does-not-exist'))) {
      chunks.push(chunk)
    }

    expect(chunks.some(c => c.kind === 'error')).toBe(true)
    expect(underlying.requests).toHaveLength(0)
  })
})
