import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { CompatModelClient } from './compat-model-client.js'
import { MultiProviderModelClient } from './multi-provider-model-client.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'

const baseRequest = (): ModelRequest => ({ threadId: 'paper', turnId: 'turn', model: 'model',
  providerId: 'api', tools: [], history: [], prefix: [], maxRetryAttempts: 0,
  abortSignal: new AbortController().signal })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('paper model transport fence', () => {
  it('blocks protocol fallback after one physical HTTP call', async () => {
    const fetchImpl = vi.fn(async () => new Response('stream_options unsupported', { status: 400 }))
    const client = new CompatModelClient({ baseUrl: 'https://api.example', apiKey: 'fake', model: 'model', fetchImpl })
    let attempts = 0
    const chunks = await collect(client.stream({ ...baseRequest(), paperReadOnly: {
      assertCurrent: client.paperReadOnlyDispatchGuard(), takeAttempt: () => attempts++ === 0
    } }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(chunks.at(-1)).toMatchObject({ kind: 'error', code: 'paper_request_budget_exhausted' })
  })

  it('rejects route replacement before private content is transmitted', () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.example', apiKey: 'fake', model: 'model', fetchImpl })
    const direct = new MultiProviderModelClient({ default: client, providers: new Map([['api', client]]) })
    const guard = direct.paperReadOnlyDispatchGuard(baseRequest())
    direct.replace({ default: client, providers: new Map([['api', client]]) })
    expect(() => direct.stream({ ...baseRequest(), paperReadOnly: { assertCurrent: guard, takeAttempt: () => true } })).toThrow('changed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects automatic account/provider failover and unsupported clients', () => {
    const client = new CompatModelClient({ baseUrl: 'https://api.example', apiKey: 'fake', model: 'model', fetchImpl: vi.fn() })
    const direct = new MultiProviderModelClient({ default: client, providers: new Map([['api', client]]) })
    const routed = new RoutePoolModelClient(direct, [], () => ({ id: 'model', supportsToolCalling: true,
      inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'] }))
    routed.replaceFailoverGroups([{ providerId: 'api', strategy: 'order',
      members: [{ providerId: 'api', models: ['model'], enabled: true }, { providerId: 'other', models: ['model'], enabled: true }], fallbackTargets: [] }])
    expect(() => routed.paperReadOnlyDispatchGuard(baseRequest())).toThrow('failover')
    const unsupported = new MultiProviderModelClient({ default: { provider: 'sdk', model: 'model', async *stream() {} } })
    expect(() => unsupported.paperReadOnlyDispatchGuard({ model: 'model' })).toThrow('cannot enforce')
  })
})
