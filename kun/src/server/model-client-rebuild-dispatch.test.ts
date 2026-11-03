import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildModelClientRouterInput } from './runtime-factory-model.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { RoutePoolModelClient } from '../adapters/model/route-pool-model-client.js'
import type { ModelRoutePoolConfig } from '../contracts/model-route-pool.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'

const capabilities = () => ({ id: 'fixture-model', inputModalities: ['text' as const], outputModalities: ['text' as const],
  messageParts: ['text' as const], supportsToolCalling: true })

function options(overrides: { apiKey?: string; baseUrl?: string; maxInputTokens?: number } = {}): KunServeRuntimeOptions {
  const apiKey = overrides.apiKey ?? 'synthetic-fixture-only'
  const baseUrl = overrides.baseUrl ?? 'https://synthetic.invalid/v1'
  // Mirrors what Registry materialization hands both startup and settings apply.
  return { host: '127.0.0.1', port: 0, dataDir: '/tmp/kun-rebuild-fixture', runtimeToken: 'test',
    apiKey, baseUrl, model: 'fixture-model', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    tokenEconomyMode: false, insecure: false, modelConnectionSelectionRequired: true, activeProviderId: 'fixture',
    providers: { fixture: { kind: 'http', apiKey, baseUrl, models: ['fixture-model'],
      modelCapabilities: { 'fixture-model': { ...capabilities(), maxInputTokens: overrides.maxInputTokens ?? 64_000 } } } } }
}

function request(turnId: string, providerId?: string, model = 'fixture-model'): ModelRequest {
  return { threadId: 'isolated-fixture', turnId, model, ...(providerId ? { providerId } : {}),
    prefix: [], history: [], tools: [], abortSignal: new AbortController().signal }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

let sent: string[]
beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${url} ${new Headers(init.headers).get('authorization')}`)
    return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: 'fixture' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => { vi.unstubAllGlobals() })

const build = (value: KunServeRuntimeOptions) => buildModelClientRouterInput(value, capabilities)

/** Re-applies settings while the selected request waits on admission check `at`. */
function applyDuringAdmission(router: MultiProviderModelClient, at: number, next: () => void) {
  let checks = 0
  router.setDispatchAuthority(async () => { if (++checks === at) next() })
}

describe('model client rebuild during dispatch', () => {
  for (const providerId of [undefined, 'fixture']) {
    for (const at of [2, 3]) {
      it(`sends a ${providerId ?? 'default'} turn when settings apply rebuilds identical clients (check ${at})`, async () => {
        const router = new MultiProviderModelClient(build(options()))
        applyDuringAdmission(router, at, () => router.replace(build(options())))
        const chunks = await drain(router.stream(request('first-turn', providerId)))
        expect(chunks).not.toContainEqual(expect.objectContaining({ kind: 'error' }))
        expect(chunks).toContainEqual(expect.objectContaining({ kind: 'completed' }))
        expect(sent).toEqual(['https://synthetic.invalid/v1/chat/completions Bearer synthetic-fixture-only'])
      })
    }
  }

  it('treats a catalog metadata refresh as the same dispatch target', async () => {
    const router = new MultiProviderModelClient(build(options()))
    applyDuringAdmission(router, 2, () => router.replace(build(options({ maxInputTokens: 128_000 }))))
    const chunks = await drain(router.stream(request('metadata', 'fixture')))
    expect(chunks).toContainEqual(expect.objectContaining({ kind: 'completed' }))
    expect(sent).toHaveLength(1)
  })

  for (const [change, next] of [
    ['credential', options({ apiKey: 'rotated-fixture-only' })],
    ['route', options({ baseUrl: 'https://other.invalid/v1' })]
  ] as const) {
    for (const providerId of [undefined, 'fixture']) {
      it(`still refuses a ${providerId ?? 'default'} turn after a real ${change} change`, async () => {
        const router = new MultiProviderModelClient(build(options()))
        applyDuringAdmission(router, 2, () => router.replace(build(next)))
        const chunks = await drain(router.stream(request(`changed-${change}`, providerId)))
        expect(chunks).toContainEqual(expect.objectContaining({ kind: 'error', code: 'provider_configuration_changed' }))
        expect(sent).toEqual([])
      })
    }
  }

  it('follows the live client for the rest of the turn after an identical rebuild', async () => {
    const router = new MultiProviderModelClient(build(options()))
    applyDuringAdmission(router, 2, () => router.replace(build(options())))
    await drain(router.stream(request('multi-step', 'fixture')))
    router.replace(build(options({ apiKey: 'rotated-fixture-only' })))
    await drain(router.stream(request('multi-step', 'fixture')))
    // An admitted turn keeps its pinned credential; the pin moved to the
    // rebuilt client, which carries the same credential as the original.
    expect(sent.map((line) => line.split(' ').at(-1))).toEqual(['synthetic-fixture-only', 'synthetic-fixture-only'])
  })

  it('keeps gateway and review fences open across an identical rebuild only', async () => {
    const router = new MultiProviderModelClient(build(options()))
    const gateway = router.gatewayDispatchGuard(), review = router.capture('fixture')
    router.replace(build(options()))
    expect(() => gateway()).not.toThrow()
    expect(await drain(review.stream(request('review', 'fixture')))).toContainEqual(expect.objectContaining({ kind: 'completed' }))
    router.replace(build(options({ apiKey: 'rotated-fixture-only' })))
    expect(() => gateway()).toThrow()
    await expect(Promise.resolve().then(() => drain(review.stream(request('review-after-change', 'fixture')))))
      .rejects.toThrow()
    expect(sent).toHaveLength(1)
  })

  it('does not fence a pool target when settings apply re-sends the same pools', async () => {
    const pool: ModelRoutePoolConfig = { id: 'fixture-pool', name: 'Fixture pool', modelId: 'auto', enabled: true,
      strategy: 'priority', targets: [{ id: 'fixture', providerId: 'fixture', modelId: 'fixture-model', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 2, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }
    const router = new MultiProviderModelClient(build(options()))
    const routed = new RoutePoolModelClient(router, [pool], capabilities)
    routed.replaceFailoverGroups([])
    applyDuringAdmission(router, 2, () => {
      router.replace(build(options()))
      routed.replacePools([structuredClone(pool)])
      routed.replaceFailoverGroups([])
    })
    const chunks = await drain(routed.stream(request('pooled', undefined, 'auto')))
    expect(chunks).toContainEqual(expect.objectContaining({ kind: 'completed' }))
    expect(sent).toHaveLength(1)
  })
})
