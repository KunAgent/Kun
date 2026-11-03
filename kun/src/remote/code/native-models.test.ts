import { describe, expect, it, vi } from 'vitest'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { codeAgents } from './model-catalog.js'
import { NATIVE_MODELS_WAIT_MS } from './native-models.js'

const later = () => new Date(Date.now() + 60_000).toISOString()
const native = (harnessId: string, providerId?: string) =>
  ({ harnessId, credentialMode: 'native-login', ...(providerId ? { providerId } : {}), expiresAt: later() })
const agent = (id: string, transport: string) =>
  ({ id, displayName: id, transport, modelSource: 'probe', staticModels: [], credentialModes: ['native-login'] })

/** A desktop where Claude Code, Codex and Gemini are signed in but nobody has opened their model menu yet. */
function runtime(probes: Record<string, () => Promise<string[]>>, ready: Record<string, unknown[]>) {
  const list = [agent('kun', 'native-loop'), agent('claude-code', 'agent-sdk'), agent('codex', 'codex-app-server'), agent('gemini', 'acp')]
  const cache = new Map<string, string[]>()
  const calls: string[] = []
  const probe = (definition: { id: string }) => {
    calls.push(definition.id)
    return probes[definition.id]!().then((models) => { cache.set(definition.id, models); return models })
  }
  return {
    calls,
    runtime: {
      modelConnections: { snapshot: async () => ({ providers: [
        { id: 'deepseek', name: 'DeepSeek', kind: 'http', configured: true, credentialStatus: 'ready', models: ['deepseek-chat'] },
        { id: 'claude-account', name: 'Claude 订阅', kind: 'agent-sdk', configured: true, models: ['claude-sonnet-4-5'] }
      ], routePools: [] }) },
      harnesses: {
        catalog: { list: () => list, get: (id: string) => list.find((entry) => entry.id === id), isDisabled: () => false },
        readiness: { readyProfiles: async (id: string) => ready[id] ?? [], warmProfiles: () => {}, checking: () => false },
        probedModels: (definition: { id: string }) => cache.get(definition.id),
        agentSdkModels: { probe, peekInfo: () => undefined },
        codexModels: { probe, peekInfo: () => undefined },
        acpModels: { probe, peekInfo: () => undefined },
        detector: {}
      }
    } as unknown as ServerRuntime
  }
}

describe('Agent models on the phone', () => {
  it('loads the own-login models of signed-in Agents nobody has opened yet, so they are listed', async () => {
    const { runtime: live, calls } = runtime({
      'claude-code': async () => ['claude-sonnet-4-5', 'claude-opus-4-1'],
      codex: async () => ['gpt-5'],
      gemini: async () => []
    }, { 'claude-code': [native('claude-code')], codex: [native('codex')], gemini: [native('gemini')] })
    const agents = await codeAgents(live, [])
    expect(agents.map((entry) => entry.id)).toEqual(['kun', 'claude-code', 'codex'])
    expect(agents[1].routes).toMatchObject([{ credentialMode: 'native-login', models: ['claude-sonnet-4-5', 'claude-opus-4-1'] }])
    expect(calls.sort()).toEqual(['claude-code', 'codex', 'gemini'])
    // A cached list is read, never probed again.
    calls.length = 0
    await codeAgents(live, [])
    expect(calls).toEqual(['gemini'])
  })

  it('never probes an Agent whose only login comes from a Kun connection', async () => {
    const { runtime: live, calls } = runtime({}, { 'claude-code': [native('claude-code', 'claude-account')] })
    const agents = await codeAgents(live, [])
    expect(calls).toEqual([])
    expect(agents[1]).toMatchObject({ id: 'claude-code', routes: [{ providerId: 'claude-account', models: ['claude-sonnet-4-5'] }] })
  })

  it('waits a bounded time for a slow Agent and lists it on the next read', async () => {
    vi.useFakeTimers()
    try {
      let finish!: (models: string[]) => void
      const { runtime: live } = runtime({ codex: () => new Promise((resolve) => { finish = resolve }) }, { codex: [native('codex')] })
      const first = codeAgents(live, [])
      await vi.advanceTimersByTimeAsync(NATIVE_MODELS_WAIT_MS)
      expect((await first).map((entry) => entry.id)).toEqual(['kun'])
      finish(['gpt-5'])
      await vi.runAllTimersAsync()
      expect((await codeAgents(live, [])).map((entry) => entry.id)).toEqual(['kun', 'codex'])
    } finally { vi.useRealTimers() }
  })
})
