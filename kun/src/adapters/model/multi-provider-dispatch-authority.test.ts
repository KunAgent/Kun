import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import { MultiProviderModelClient } from './multi-provider-model-client.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'

function fixture() {
  const calls: string[] = []
  const client = (label: string) => new CompatModelClient({
    baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-fixture-only', model: 'fixture-model',
    fetchImpl: (async () => {
      calls.push(label)
      return new Response(JSON.stringify({ choices: [
        { index: 0, finish_reason: 'stop', message: { content: 'fixture' } }
      ] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
  })
  const old = client('old'), fresh = client('fresh')
  const input = (value: CompatModelClient) => ({ default: value, providers: new Map([['fixture', value]]) })
  return { calls, old, fresh, input, router: new MultiProviderModelClient(input(old)) }
}

function request(turnId: string, providerId?: string): ModelRequest {
  return { threadId: 'isolated-fixture', turnId, model: 'fixture-model',
    ...(providerId ? { providerId } : {}), prefix: [], history: [], tools: [],
    abortSignal: new AbortController().signal }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('model dispatch configuration authority', () => {
  for (const providerId of [undefined, 'fixture']) {
    it(`catches up before pinning the first ${providerId ?? 'default'} request`, async () => {
      const f = fixture()
      let pending = true
      f.router.setDispatchAuthority(async () => {
        if (pending) { pending = false; f.router.replace(f.input(f.fresh)) }
      })
      const chunks = await drain(f.router.stream(request('first', providerId)))
      expect(chunks.some(chunk => chunk.kind === 'error')).toBe(false)
      expect(chunks.some(chunk => chunk.kind === 'completed')).toBe(true)
      expect(f.calls).toEqual(['fresh'])
    })
  }

  it('does not fall back to the default when catch-up removes the requested provider', async () => {
    const f = fixture()
    let pending = true
    f.router.setDispatchAuthority(async () => {
      if (pending) { pending = false; f.router.replace({ default: f.fresh }) }
    })
    await expect(drain(f.router.stream(request('revoked', 'fixture')))).rejects.toThrow(/unknown model provider/)
    expect(f.calls).toEqual([])
  })

  for (const replacementCheck of [2, 3]) {
    it(`fences a replacement during admission check ${replacementCheck} without replay`, async () => {
      const f = fixture()
      let checks = 0
      f.router.setDispatchAuthority(async () => {
        checks++
        if (checks === replacementCheck) f.router.replace(f.input(f.fresh))
      })
      const chunks = await drain(f.router.stream(request('late-change', 'fixture')))
      expect(chunks).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'error', code: 'provider_configuration_changed' })
      ]))
      expect(f.calls).toEqual([])
    })
  }

  for (const replacementCheck of [1, 2]) {
    it(`keeps a captured review client bound across admission check ${replacementCheck}`, async () => {
      const f = fixture(), captured = f.router.capture('fixture')
      let checks = 0
      f.router.setDispatchAuthority(async () => {
        checks++
        if (checks === replacementCheck) f.router.replace(f.input(f.fresh))
      })
      const chunks = await drain(captured.stream(request('review', 'fixture')))
      expect(chunks).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'error', code: 'provider_configuration_changed' })
      ]))
      expect(f.calls).toEqual([])
    })
  }

  it('rechecks identity after the caller final-dispatch callback', async () => {
    const f = fixture()
    f.router.setDispatchAuthority(async () => {})
    const chunks = await drain(f.router.stream({ ...request('callback', 'fixture'),
      beforeProviderDispatch: async () => { f.router.replace(f.input(f.fresh)) } }))
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'provider_configuration_changed' })
    ]))
    expect(f.calls).toEqual([])
  })

  it('retains an admitted turn client while new turns use the current client', async () => {
    const f = fixture()
    f.router.setDispatchAuthority(async () => {})
    await drain(f.router.stream(request('running', 'fixture')))
    f.router.replace(f.input(f.fresh))
    await drain(f.router.stream(request('running', 'fixture')))
    await drain(f.router.stream(request('new-turn', 'fixture')))
    expect(f.calls).toEqual(['old', 'old', 'fresh'])
  })

  it('does not dispatch if cancellation happens while configuration catches up', async () => {
    const f = fixture(), controller = new AbortController()
    f.router.setDispatchAuthority(async () => { controller.abort() })
    await expect(drain(f.router.stream({ ...request('cancelled'), abortSignal: controller.signal })))
      .rejects.toThrow()
    expect(f.calls).toEqual([])
  })

  it('preserves synchronous refusal of an unknown explicit provider', () => {
    const f = fixture()
    f.router.setDispatchAuthority(async () => { throw new Error('must not run') })
    expect(() => f.router.stream(request('unknown', 'missing'))).toThrow(/unknown model provider/)
    expect(f.calls).toEqual([])
  })

  it('refuses a pool target removed by catch-up, without trying the old pool alternatives', async () => {
    const f = fixture()
    const pool = (providerId: string): ModelRoutePoolConfig => ({
      id: 'fixture-pool', name: 'Fixture pool', modelId: 'auto', enabled: true, strategy: 'priority',
      targets: [{ id: providerId, providerId, modelId: 'fixture-model', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [503], failoverOnNetworkError: true,
        failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 2, cooldownMs: 1000, halfOpenMaxAttempts: 1 }
    })
    const routed = new RoutePoolModelClient(f.router, [pool('fixture')], () => ({
      id: 'fixture-model', inputModalities: ['text'], outputModalities: ['text'],
      supportsToolCalling: true, messageParts: ['text']
    }))
    let pending = true
    f.router.setDispatchAuthority(async () => {
      if (!pending) return
      pending = false
      routed.replacePools([pool('backup')])
      f.router.replace({ default: f.fresh,
        providers: new Map([['fixture', f.fresh], ['backup', f.fresh]]) })
    })
    const chunks = await drain(routed.stream({ ...request('old-pool'), model: 'auto' }))
    expect(f.calls).toEqual([])
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', failure: expect.objectContaining({ failoverAllowed: false }) })
    ]))
    const next = await drain(routed.stream({ ...request('new-pool'), model: 'auto' }))
    expect(f.calls).toEqual(['fresh'])
    expect(next).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant_text_delta', route: expect.objectContaining({ providerId: 'backup' }) })
    ]))
  })

  it('fences an account-group member disabled by catch-up', async () => {
    const f = fixture()
    const routed = new RoutePoolModelClient(f.router, [], () => ({
      id: 'fixture-model', inputModalities: ['text'], outputModalities: ['text'],
      supportsToolCalling: true, messageParts: ['text']
    }))
    routed.replaceFailoverGroups([{ providerId: 'fixture', strategy: 'order', fallbackTargets: [],
      members: [{ providerId: 'fixture', enabled: true, models: ['fixture-model'] }] }])
    let pending = true
    f.router.setDispatchAuthority(async () => {
      if (!pending) return
      pending = false
      routed.replaceFailoverGroups([{ providerId: 'fixture', strategy: 'order', fallbackTargets: [],
        members: [{ providerId: 'fixture', enabled: false, models: ['fixture-model'] },
          { providerId: 'backup', enabled: true, models: ['fixture-model'] }] }])
      f.router.replace({ default: f.fresh,
        providers: new Map([['fixture', f.fresh], ['backup', f.fresh]]) })
    })
    const chunks = await drain(routed.stream(request('old-group', 'fixture')))
    expect(f.calls).toEqual([])
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', failure: expect.objectContaining({ failoverAllowed: false }) })
    ]))
  })
})
