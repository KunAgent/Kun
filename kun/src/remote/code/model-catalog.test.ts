import { describe, it, expect } from 'vitest'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { validateModelProfiles } from '@kun/remote-protocol'
import { codeAgents, resolveCodeRoute } from './model-catalog.js'

const later = () => new Date(Date.now() + 60_000).toISOString()
const definition = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: id === 'kun' ? 'Kun' : id === 'claude-code' ? 'Claude Code' : id,
  transport: id === 'kun' ? 'native-loop' : 'agent-sdk',
  modelSource: 'probe',
  staticModels: ['fallback-model'],
  credentialModes: ['native-login', 'provider'],
  ...extra
})

type Options = { ready?: Record<string, unknown[]>; disabled?: string[]; providers?: unknown[]
  models?: Record<string, string[]>; info?: Record<string, unknown[]> }
function runtime(options: Options = {}) {
  const list = [
    definition('kun', { credentialModes: ['provider'] }),
    definition('claude-code'),
    definition('codex', { transport: 'codex-app-server' }),
    definition('shell-agent', { transport: 'terminal' }),
    definition('old-agent', { availability: 'retired' })
  ]
  return {
    defaultModel: 'deepseek-chat',
    modelConnections: {
      snapshot: async () => ({
        providers: options.providers ?? [
          { id: 'deepseek', name: 'DeepSeek', kind: 'http', configured: true, credentialStatus: 'ready', models: ['deepseek-chat', 'deepseek-reasoner'] },
          { id: 'claude-account', name: 'Claude 订阅', kind: 'agent-sdk', configured: true, models: ['claude-sonnet-4-5'] },
          { id: 'broken', name: 'Broken', kind: 'http', configured: true, credentialStatus: 'missing', models: ['x'] }
        ],
        defaultProviderId: 'deepseek',
        defaultModel: 'deepseek-chat'
      })
    },
    harnesses: {
      catalog: {
        list: () => list,
        get: (id: string) => list.find((entry) => entry.id === id),
        isDisabled: (id: string) => (options.disabled ?? []).includes(id)
      },
      readiness: {
        readyProfiles: async (id: string) => options.ready?.[id] ?? []
      },
      probedModels: (entry: { id: string }) => options.models?.[entry.id] ??
        (entry.id === 'claude-code' ? ['claude-sonnet-4-5', 'claude-opus-4-1'] : undefined),
      agentSdkModels: { peekInfo: (entry: { id: string }) => options.info?.[entry.id] },
      codexModels: { peekInfo: (entry: { id: string }) => options.info?.[entry.id] },
      detector: {}
    }
  } as unknown as ServerRuntime
}

describe('mobile Code agent catalog', () => {
  it('lists Kun connections and only ready, turn-serving third-party Agents', async () => {
    const agents = await codeAgents(runtime({
      ready: {
        'claude-code': [{ harnessId: 'claude-code', credentialMode: 'native-login', expiresAt: later() }],
        codex: [{ harnessId: 'codex', credentialMode: 'native-login', expiresAt: new Date(0).toISOString() }],
        'shell-agent': [{ harnessId: 'shell-agent', credentialMode: 'native-login', expiresAt: later() }]
      }
    }), ['deepseek-chat'])
    expect(agents.map((agent) => agent.id)).toEqual(['kun', 'claude-code'])
    expect(agents[0].routes).toEqual([
      { credentialMode: 'provider', providerId: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat' }
    ])
    expect(agents[1]).toMatchObject({
      name: 'Claude Code',
      routes: [{ credentialMode: 'native-login', label: 'Claude Code', models: ['claude-sonnet-4-5', 'claude-opus-4-1'] }]
    })
  })

  it('keeps disabled Agents out and falls back to the legacy Kun route', async () => {
    const agents = await codeAgents(runtime({
      providers: [],
      disabled: ['claude-code'],
      ready: { 'claude-code': [{ harnessId: 'claude-code', credentialMode: 'native-login', expiresAt: later() }] }
    }), ['deepseek-chat', 'used-before'])
    expect(agents).toEqual([
      { id: 'kun', name: 'Kun', routes: [{ label: 'Kun', models: ['deepseek-chat', 'used-before'], defaultModel: 'deepseek-chat' }] }
    ])
  })

  it('accepts only an exact Agent, route and model from the live catalog', async () => {
    const live = runtime({ ready: { 'claude-code': [{ harnessId: 'claude-code', credentialMode: 'native-login', expiresAt: later() }] } })
    await expect(resolveCodeRoute(live, { harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-opus-4-1' }, []))
      .resolves.toEqual({ harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-opus-4-1' })
    await expect(resolveCodeRoute(live, { harnessId: 'kun', credentialMode: 'provider', providerId: 'deepseek' }, []))
      .resolves.toEqual({ harnessId: 'kun', credentialMode: 'provider', providerId: 'deepseek', model: 'deepseek-chat' })
    await expect(resolveCodeRoute(live, { harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5' }, []))
      .rejects.toThrow('AGENT_NOT_AVAILABLE')
    await expect(resolveCodeRoute(live, { harnessId: 'claude-code', credentialMode: 'native-login', model: 'made-up' }, []))
      .rejects.toThrow('MODEL_NOT_AVAILABLE')
    await expect(resolveCodeRoute(live, { harnessId: 'kun', credentialMode: 'provider', providerId: 'broken', model: 'x' }, []))
      .rejects.toThrow('MODEL_NOT_AVAILABLE')
    // Legacy phones send only a model and keep the old Kun default route.
    await expect(resolveCodeRoute(live, { model: 'deepseek-chat' }, ['deepseek-chat']))
      .resolves.toEqual({ harnessId: 'kun', model: 'deepseek-chat' })
  })
})

describe('mobile Code reasoning profiles', () => {
  const native = (harnessId: string) => ({ harnessId, credentialMode: 'native-login', expiresAt: later() })
  const live = () => runtime({
    providers: [
      { id: 'deepseek', name: 'DeepSeek', kind: 'http', configured: true, credentialStatus: 'ready', models: ['deepseek-chat', 'deepseek-reasoner'],
        modelCapabilities: { 'deepseek-reasoner': { reasoning: { supportedEfforts: ['off', 'high', 'max'], defaultEffort: 'high' } } } },
      { id: 'claude-account', name: 'Claude 订阅', kind: 'agent-sdk', configured: true, models: ['claude-sonnet-4-5'] }
    ],
    ready: {
      'claude-code': [native('claude-code'), { harnessId: 'claude-code', credentialMode: 'provider', providerId: 'claude-account', expiresAt: later() }],
      codex: [native('codex')]
    },
    models: { codex: ['gpt-5', 'gpt-5-mini'] },
    info: {
      'claude-code': [{ id: 'claude-sonnet-4-5', reasoningEfforts: ['low', 'medium', 'high', 'max'], defaultReasoningEffort: 'high' }],
      // Codex-native names outside the wire's six levels never reach a phone.
      codex: [{ id: 'gpt-5', reasoningEfforts: ['minimal', 'low', 'high', 'xhigh'], defaultReasoningEffort: 'xhigh' }, { id: 'gpt-5-mini', reasoningEfforts: ['xhigh'] }]
    }
  })

  it('describes provider and native levels per model and only for models that have them', async () => {
    const agents = await codeAgents(live(), [])
    const routes = Object.fromEntries(agents.flatMap((agent) => agent.routes.map((route) => [`${agent.id}/${route.providerId ?? route.credentialMode}`, route])))
    expect(routes['kun/deepseek'].profiles).toEqual({ 'deepseek-reasoner': { efforts: ['off', 'high', 'max'], defaultEffort: 'high' } })
    expect(routes['claude-code/native-login'].profiles).toEqual({ 'claude-sonnet-4-5': { efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' } })
    // Native catalog facts describe the Agent's own login, not a provider route that lists the same id.
    expect(routes['claude-code/claude-account'].profiles).toBeUndefined()
    expect(routes['codex/native-login'].profiles).toEqual({ 'gpt-5': { efforts: ['low', 'high'] } })
    for (const route of Object.values(routes)) expect(() => validateModelProfiles(route)).not.toThrow()
  })

  it('accepts only a depth the exact route lists for the chosen model', async () => {
    const pick = { harnessId: 'kun', credentialMode: 'provider' as const, providerId: 'deepseek' }
    await expect(resolveCodeRoute(live(), { ...pick, model: 'deepseek-reasoner', reasoningEffort: 'max' }, []))
      .resolves.toEqual({ ...pick, model: 'deepseek-reasoner', reasoningEffort: 'max' })
    await expect(resolveCodeRoute(live(), { harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5', reasoningEffort: 'low' }, []))
      .resolves.toMatchObject({ harnessId: 'codex', reasoningEffort: 'low' })
    for (const refused of [
      { ...pick, model: 'deepseek-reasoner', reasoningEffort: 'low' as const },
      { ...pick, model: 'deepseek-chat', reasoningEffort: 'auto' as const },
      { harnessId: 'codex', credentialMode: 'native-login' as const, model: 'gpt-5', reasoningEffort: 'max' as const },
      { harnessId: 'claude-code', credentialMode: 'provider' as const, providerId: 'claude-account', model: 'claude-sonnet-4-5', reasoningEffort: 'high' as const },
      // A legacy model-only pick names no route to check a depth against.
      { model: 'deepseek-chat', reasoningEffort: 'high' as const }
    ]) await expect(resolveCodeRoute(live(), refused, ['deepseek-chat'])).rejects.toThrow('MODEL_NOT_AVAILABLE')
  })
})
