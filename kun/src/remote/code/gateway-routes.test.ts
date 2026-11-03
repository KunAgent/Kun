import { describe, expect, it } from 'vitest'
import { validateModelRoute } from '@kun/remote-protocol'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { gatewayRouteKey, resolveCodeRoute } from './model-catalog.js'

const later = () => new Date(Date.now() + 60_000).toISOString()
const provider = (id: string) => ({ id, name: id, kind: 'http', authType: 'api-key', configured: true, credentialStatus: 'ready',
  models: ['fake', 'deepseek-chat'] })
const pool = (id: string, name: string, modelId: string, providerId: string, enabled = true) => ({ id, name, modelId, enabled,
  strategy: 'priority', targets: [{ id: id + '-t', providerId, modelId: 'deepseek-chat', enabled: true, weight: 1 }] })
const binding = (routeId: string, allowedConnectionIds = ['deepseek']) => ({ main: { routeId, allowedConnectionIds } })
const gateway = (routeId: string, allowed?: string[]) =>
  ({ harnessId: 'claude-code', credentialMode: 'kun-gateway', gatewayBinding: binding(routeId, allowed), expiresAt: later() })
const claude = { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk', modelSource: 'static',
  staticModels: ['claude-sonnet-4-5'], credentialModes: ['native-login', 'kun-gateway'] }

/** A desktop whose Claude Code is checked on its own login and on three gateway routes, one per failure reason. */
async function fixture() {
  const f = await remoteFixture()
  const routePools = [pool('fast', 'Fast lane', 'kun-fast', 'deepseek'), pool('deep', 'Deep lane', 'kun-deep', 'deepseek'),
    pool('off', 'Switched off', 'kun-off', 'deepseek', false), pool('other', 'Other account', 'kun-other', 'backup')]
  const ready = [{ harnessId: 'claude-code', credentialMode: 'native-login', expiresAt: later() },
    gateway('fast'), gateway('deep'), gateway('off'), gateway('other', ['deepseek'])]
  Object.assign(f.runtime, {
    modelConnections: { snapshot: async () => ({ providers: [provider('deepseek'), provider('backup')], routePools,
      defaultProviderId: 'deepseek', defaultModel: 'fake' }) },
    harnesses: {
      catalog: { list: () => [claude], get: (id: string) => id === claude.id ? claude : undefined, isDisabled: () => false },
      readiness: { readyProfiles: async () => ready, warmProfiles: () => {}, checking: () => false }
    }
  })
  await f.code()
  const projectId: string = (await f.call('catalog.get', {})).projects[0].id
  const fast = gatewayRouteKey(gateway('fast') as never), deep = gatewayRouteKey(gateway('deep') as never)
  const create = async (route: Record<string, unknown>) => (await f.call('code.create', { projectId, ...route })).receipt
  return { ...f, fast, deep, create }
}
const pick = (routeKey?: string, model = 'kun-fast') =>
  ({ harnessId: 'claude-code', credentialMode: 'kun-gateway' as const, model, ...(routeKey ? { routeKey } : {}) })

describe('Kun gateway routes on a phone', () => {
  it('lists each usable gateway route by name and alias model, keyed without its binding', async () => {
    const f = await fixture()
    try {
      const catalog = await f.call('catalog.get', {})
      const agent = catalog.agents.find((entry: { id: string }) => entry.id === 'claude-code')
      expect(agent.routes).toEqual([
        { credentialMode: 'native-login', label: 'Claude Code', models: ['claude-sonnet-4-5'], defaultModel: 'claude-sonnet-4-5' },
        { credentialMode: 'kun-gateway', routeKey: f.fast, label: 'Fast lane', models: ['kun-fast'], defaultModel: 'kun-fast' },
        { credentialMode: 'kun-gateway', routeKey: f.deep, label: 'Deep lane', models: ['kun-deep'], defaultModel: 'kun-deep' }
      ])
      // A disabled route, or one whose targets are outside the approved connections, is not offered.
      const wire = JSON.stringify(catalog)
      for (const hidden of ['allowedConnectionIds', 'gatewayBinding', 'routeId', 'Switched off', 'Other account']) expect(wire).not.toContain(hidden)
      expect(f.fast).toMatch(/^alias-v1:[a-f0-9]{64}$/)
    } finally { await f.close() }
  })

  it('creates a task on the keyed route with the desktop binding and echoes only the key', async () => {
    const f = await fixture()
    try {
      const created = await f.create(pick(f.deep, 'kun-deep'))
      expect(created.status).toBe('applied')
      const id = created.result.thread.id
      expect((await f.h.threads.getMetadata(id))?.executionConfig?.route).toEqual({ model: 'kun-deep', harnessId: 'claude-code',
        credentialMode: 'kun-gateway', gatewayBinding: binding('deep') })
      const settings = await f.call('code.settings.get', { threadId: id })
      expect(settings.effective).toEqual(pick(f.deep, 'kun-deep'))
      expect(settings.next).toEqual(pick(f.deep, 'kun-deep'))
      expect(validateModelRoute(settings.next)).toEqual(pick(f.deep, 'kun-deep'))
    } finally { await f.close() }
  })

  it('switches a task onto a gateway route and back off it', async () => {
    const f = await fixture()
    try {
      const id = (await f.create({ harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-sonnet-4-5' })).result.thread.id
      const before = await f.call('code.settings.get', { threadId: id })
      const onto = (await f.call('code.settings.update', { threadId: id, expectedRevision: before.revision, next: pick(f.fast) })).receipt
      expect(onto.status).toBe('applied')
      expect(onto.result.next).toEqual(pick(f.fast))
      expect((await f.h.threads.getMetadata(id))?.executionConfig?.route.gatewayBinding).toEqual(binding('fast'))
      const off = (await f.call('code.settings.update', { threadId: id, expectedRevision: onto.result.revision,
        next: { harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-sonnet-4-5' } })).receipt.result
      expect(off.next).toEqual({ harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-sonnet-4-5' })
      expect((await f.h.threads.getMetadata(id))?.executionConfig?.route.gatewayBinding).toBeUndefined()
    } finally { await f.close() }
  })

  it('refuses a missing, stale or mismatched key before any receipt, as older phones always were', async () => {
    const f = await fixture()
    try {
      const before = (await f.h.threads.list({ workbenchScope: 'code', limit: 100 })).length
      // An older phone without keys cannot reach a gateway route.
      await expect(f.create(pick())).rejects.toThrow('MODEL_NOT_AVAILABLE')
      for (const refused of [pick('alias-v1:' + '0'.repeat(64)), pick(f.fast, 'kun-deep'), pick(f.fast, 'kun-fast'.toUpperCase()),
        { ...pick(f.fast), credentialMode: 'provider' }, { ...pick(f.fast), providerId: 'deepseek' }, { ...pick(f.fast), harnessId: 'kun' },
        { ...pick(f.fast), reasoningEffort: 'high' }, { routeKey: f.fast, model: 'kun-fast' }])
        await expect(f.create(refused)).rejects.toThrow('MODEL_NOT_AVAILABLE')
      await expect(f.create({ ...pick(f.fast), harnessId: 'codex' })).rejects.toThrow('AGENT_NOT_AVAILABLE')
      await expect(f.create({ ...pick(), routeKey: '{"routeId":"fast"}' })).rejects.toThrow()
      expect((await f.h.threads.list({ workbenchScope: 'code', limit: 100 })).length).toBe(before)
      const id = (await f.h.threads.list({ workbenchScope: 'code', limit: 1 }))[0].id
      const settings = await f.call('code.settings.get', { threadId: id })
      expect((await f.call('code.settings.update', { threadId: id, expectedRevision: settings.revision, next: pick() })).receipt.error)
        .toEqual({ code: 'MODEL_NOT_AVAILABLE', definitive: true })
    } finally { await f.close() }
  })

  it('resolves the binding from the live catalog only', async () => {
    const f = await fixture()
    try {
      await expect(resolveCodeRoute(f.runtime, pick(f.fast), [])).resolves.toEqual({ harnessId: 'claude-code',
        credentialMode: 'kun-gateway', gatewayBinding: binding('fast'), model: 'kun-fast' })
      await expect(resolveCodeRoute(f.runtime, { harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-sonnet-4-5' }, []))
        .resolves.not.toHaveProperty('gatewayBinding')
    } finally { await f.close() }
  })
})
