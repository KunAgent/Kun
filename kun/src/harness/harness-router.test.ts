import { describe, expect, it } from 'vitest'
import { HarnessAdmissionError, HarnessRouter, HarnessRuntimeMap } from './harness-router.js'
import { HarnessCatalog } from './harness-catalog.js'
import type { ProviderKindsView } from './resolve-turn-harness.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { agentSdkCapabilities } from '../runtime/agent-sdk/agent-sdk-runtime-stream.js'

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
    catalog: new HarnessCatalog({ custom: () => [], enabledProfiles: () => [
      ...['claude-code', 'codex', 'antigravity', 'opencode', 'pi', 'devin'].map((harnessId) => ({ harnessId, credentialMode: 'native-login' as const })),
      ...['sub', 'other'].map((providerId) => ({ harnessId: 'claude-code', credentialMode: 'native-login' as const, providerId })),
      ...['default', 'cur-1'].map((providerId) => ({ harnessId: 'cursor', credentialMode: 'provider' as const, providerId }))
    ] }),
    readiness: { configurationSignature: () => 'fixture', prepareTurn: async () => undefined, releaseTurn: () => undefined },
    runtimes: () => ({}),
    providerKinds: () => kinds(),
    defaultModel: () => 'default-model',
    ...over
  })

describe('HarnessRouter', () => {
  it('routes OpenCode2 through ACP without borrowing V1 consent', () => {
    const runtime = stubRuntime()
    const router = makeRouter({ catalog: new HarnessCatalog({ custom: () => [], enabledProfiles: () => [
      { harnessId: 'opencode2', credentialMode: 'native-login' }
    ] }), runtimes: () => ({ acp: runtime }) })
    const result = router.resolve(thread(), turn({ harnessId: 'opencode2', credentialMode: 'native-login', providerId: undefined, model: 'openai/gpt-5.2' }))
    expect(result).toMatchObject({ ok: true, resolved: { route: {
      harnessId: 'opencode2', credentialMode: 'native-login', model: 'openai/gpt-5.2'
    } } })
    expect(router.resolve(thread(), turn({ harnessId: 'opencode', credentialMode: 'native-login', providerId: undefined })).ok).toBe(false)
  })
  it('blocks Kun canvas and Graph lead intent even when the external engine has Kun tools', () => {
    const router = makeRouter({ runtimes: () => ({
      'agent-sdk': stubRuntime({ capabilities: () => agentSdkCapabilities() })
    }) })
    for (const intent of [{ guiDesignCanvas: true }, { guiDesignMode: true }, { agentSurface: 'design' },
      { orchestration: 'graph' },
      { orchestration: 'graph', graphPlanningLifecycle: {} }]) {
      const result = router.resolve(thread(), turn({ harnessId: 'claude-code', ...intent } as Partial<Turn>))
      expect(result).toMatchObject({ ok: false, error: { code: 'route_unsupported' } })
    }
  })

  it('retains ordinary external Agent and Graph worker capability routing', () => {
    const router = makeRouter({ runtimes: () => ({
      'agent-sdk': stubRuntime({ capabilities: () => agentSdkCapabilities() })
    }) })
    expect(router.resolve(thread(), turn({ harnessId: 'claude-code', agentSurface: 'code' })).ok).toBe(true)
    expect(router.resolve(thread({ relation: 'side', parentThreadId: 'parent' }),
      turn({ harnessId: 'claude-code', orchestration: 'graph' })).ok).toBe(true)
  })

  it('uses the frozen turn route for a Kun Design turn after the thread changes Agents', () => {
    expect(makeRouter().resolve(thread({ harnessId: 'codex' }), turn({
      harnessId: 'kun', agentSurface: 'design', guiDesignCanvas: true
    })).ok).toBe(true)
  })

  it('checks inherited legacy Design and plan modes, while honoring explicit frozen agent mode', () => {
    const router = makeRouter({ runtimes: () => ({ 'agent-sdk': stubRuntime() }) })
    for (const inherited of [{ agentSurface: 'design' as const }, { mode: 'plan' as const }]) {
      expect(router.resolve(thread(inherited), turn({ harnessId: 'claude-code' })))
        .toMatchObject({ ok: false, error: { code: 'route_unsupported' } })
    }
    expect(router.resolve(thread({ mode: 'plan' }), turn({ harnessId: 'claude-code', mode: 'agent' })).ok).toBe(true)
  })

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

  it.each(['agent-sdk', 'cursor-sdk', 'antigravity-cli'] as const)(
    'rejects an explicit Kun route to an external %s provider even with the router flag off', (kind) => {
      const router = makeRouter({ enabled: () => false,
        catalog: new HarnessCatalog({ custom: () => [] }),
        providerKinds: () => kinds({ byId: { subscription: kind }, defaultKind: kind }),
        runtimes: () => ({ [kind]: stubRuntime() })
      })
      for (const providerId of ['subscription', 'default']) {
        expect(router.resolve(thread(), turn({ harnessId: 'kun', providerId })))
          .toMatchObject({ ok: false, error: { code: 'route_unsupported' } })
        expect(router.resolve(thread(), turn({ harnessId: 'kun', providerId: 'http',
          actingModelRoute: { providerId, model: 'native-model' } })))
          .toMatchObject({ ok: false, error: { code: 'route_unsupported' } })
      }
    }
  )

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
      expect(result.runtime?.handlesProvider(undefined)).toBe(runtime.handlesProvider(undefined))
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
    if (result.ok) expect(result.runtime?.handlesProvider(undefined)).toBe(inner.handlesProvider(undefined))
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

  it('fails closed without explicit opt-in even when router preference is off or provider inference selects an engine', () => {
    const router = makeRouter({ enabled: () => false, catalog: new HarnessCatalog(),
      runtimes: () => ({ 'agent-sdk': stubRuntime() }),
      providerKinds: () => kinds({ defaultKind: 'agent-sdk' }) })
    expect(router.resolve(thread(), turn())).toMatchObject({ ok: false, error: { code: 'harness_unavailable' } })
    expect(router.resolve(thread(), turn({ harnessId: 'claude-code' }))).toMatchObject({ ok: false, error: { code: 'harness_unavailable' } })
  })

  it('fails closed when readiness composition is absent', () => {
    const router = makeRouter({ readiness: undefined, runtimes: () => ({ 'agent-sdk': stubRuntime() }) })
    expect(router.resolve(thread(), turn({ harnessId: 'claude-code' }))).toMatchObject({ ok: false, error: { code: 'harness_not_ready' } })
  })

  it('reports enabled state from the deps flag', () => {
    let flag = false
    const router = makeRouter({ enabled: () => flag })
    expect(router.enabled()).toBe(false)
    flag = true
    expect(router.enabled()).toBe(true)
  })
})
