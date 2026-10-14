import { describe, it, expect } from 'vitest'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { codeAgents, resolveCodeRoute } from './agents.js'

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

function runtime(options: { ready?: Record<string, unknown[]>; disabled?: string[]; providers?: unknown[] } = {}) {
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
      probedModels: (entry: { id: string }) => (entry.id === 'claude-code' ? ['claude-sonnet-4-5', 'claude-opus-4-1'] : undefined),
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
