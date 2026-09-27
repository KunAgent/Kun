import { describe, expect, it } from 'vitest'
import { HarnessAdmissionError, HarnessRouter, HarnessRuntimeMap } from './harness-router.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { ProviderKindsView } from './resolve-turn-harness.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

const thread = (over: Partial<ThreadRecord> = {}): ThreadRecord =>
  ({ id: 't1', harnessId: undefined, model: 'kun-model', ...over }) as ThreadRecord

const turn = (over: Partial<Turn> = {}): Turn =>
  ({ id: 'u1', threadId: 't1', providerId: 'default', ...over }) as Turn

const kinds = (over: Partial<ProviderKindsView> = {}): ProviderKindsView => ({
  byId: {},
  defaultKind: 'http',
  ...over
})

const stubRuntime = (over: Partial<DelegatedTurnRuntime> = {}): DelegatedTurnRuntime => ({
  handlesProvider: () => true,
  capabilities: () => undefined,
  runTurn: async () => 'completed',
  ...over
})

const makeRouter = (over: Partial<ConstructorParameters<typeof HarnessRouter>[0]> = {}) =>
  new HarnessRouter({
    enabled: () => true,
    catalog: new HarnessCatalog(),
    runtimes: () => ({}),
    providerKinds: () => kinds(),
    defaultModel: () => 'default-model',
    ...over
  })

describe('HarnessRouter', () => {
  it('resolves the native loop without a delegated runtime', () => {
    const router = makeRouter()
    const result = router.resolve(thread(), turn({ providerId: 'default' }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.runtime).toBeUndefined()
      expect(result.resolved.route.harnessId).toBe('kun')
      expect(result.resolved.route.credentialMode).toBe('provider')
      expect(result.resolved.route.model).toBe('kun-model')
    }
  })

  it('prefers the frozen turn harness over thread and provider inference', () => {
    const runtime = stubRuntime({ handlesProvider: () => true })
    const router = makeRouter({ runtimes: () => ({ 'cursor-sdk': runtime }) })
    const result = router.resolve(
      thread({ harnessId: 'kun' as never }),
      turn({ harnessId: 'cursor' as never, providerId: 'cur-1' })
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolved.route.harnessId).toBe('cursor')
      expect(result.runtime).toBe(runtime)
    }
  })

  it('infers claude-code for legacy agent-sdk providers', () => {
    const runtime = stubRuntime()
    const router = makeRouter({
      runtimes: () => ({ 'agent-sdk': runtime }),
      providerKinds: () => kinds({ byId: { sub: 'agent-sdk' }, defaultKind: 'http' })
    })
    const result = router.resolve(thread(), turn({ providerId: 'sub' }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolved.route.harnessId).toBe('claude-code')
      expect(result.resolved.route.credentialMode).toBe('native-login')
    }
  })

  it('fails with harness_unknown for a catalog miss', () => {
    const router = makeRouter()
    const result = router.resolve(thread(), turn({ harnessId: 'nope' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(HarnessAdmissionError)
      expect(result.error.code).toBe('harness_unknown')
    }
  })

  it('fails with harness_unavailable when no runtime owns the transport', () => {
    const router = makeRouter()
    const result = router.resolve(thread(), turn({ harnessId: 'cursor' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('harness_unavailable')
  })

  it('fails with route_unsupported when the runtime rejects the route', () => {
    const runtime = stubRuntime({ handlesProvider: () => false })
    const router = makeRouter({ runtimes: () => ({ 'agent-sdk': runtime }) })
    const result = router.resolve(thread(), turn({ harnessId: 'claude-code' as never }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('route_unsupported')
  })

  it('honours handlesRoute over handlesProvider', () => {
    const seen: unknown[] = []
    const runtime = stubRuntime({
      handlesProvider: () => {
        throw new Error('legacy admission must not run for route-aware runtimes')
      },
      handlesRoute: (route) => {
        seen.push(route)
        return route.providerId === 'sub'
      }
    })
    const router = makeRouter({ runtimes: () => ({ 'agent-sdk': runtime }) })
    const ok = router.resolve(thread(), turn({ harnessId: 'claude-code' as never, providerId: 'sub' }))
    expect(ok.ok).toBe(true)
    const bad = router.resolve(thread(), turn({ harnessId: 'claude-code' as never, providerId: 'other' }))
    expect(bad.ok).toBe(false)
    expect(seen).toHaveLength(2)
  })

  it('uses resolveProvider to pin the immutable runtime generation', () => {
    const inner = stubRuntime()
    const outer = stubRuntime({
      handlesProvider: () => true,
      resolveProvider: () => inner
    })
    const router = makeRouter({ runtimes: () => ({ 'cursor-sdk': outer }) })
    const result = router.resolve(thread(), turn({ harnessId: 'cursor' as never }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.runtime).toBe(inner)
  })

  it('passes admission hook failures through', () => {
    const error = new HarnessAdmissionError('capability_missing', 'needs fork')
    const router = makeRouter({ admission: () => error })
    const result = router.resolve(thread(), turn())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('capability_missing')
  })

  it('reads the runtime map live so hot swaps apply to the next resolve', () => {
    const map = new HarnessRuntimeMap({})
    const router = makeRouter({ runtimes: () => map.get() })
    expect(router.resolve(thread(), turn({ harnessId: 'cursor' as never })).ok).toBe(false)
    map.replace({ 'cursor-sdk': stubRuntime() })
    expect(router.resolve(thread(), turn({ harnessId: 'cursor' as never })).ok).toBe(true)
  })

  it('reports enabled state from the deps flag', () => {
    let flag = false
    const router = makeRouter({ enabled: () => flag })
    expect(router.enabled()).toBe(false)
    flag = true
    expect(router.enabled()).toBe(true)
  })
})
