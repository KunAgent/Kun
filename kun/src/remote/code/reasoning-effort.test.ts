import { describe, expect, it } from 'vitest'
import { REASONING_EFFORT_CAPABILITY, hasReasoningEffort } from '@kun/remote-protocol'
import { remoteFixture } from '../testing/runtime.test-support.js'

const deepseek = {
  id: 'deepseek', name: 'DeepSeek', kind: 'http', configured: true, credentialStatus: 'ready', models: ['fake', 'plain'],
  modelCapabilities: { fake: { id: 'fake', reasoning: { supportedEfforts: ['off', 'high', 'max'], defaultEffort: 'high' } } }
}
const route = (model: string, reasoningEffort?: string) => ({ harnessId: 'kun', credentialMode: 'provider', providerId: 'deepseek', model,
  ...(reasoningEffort ? { reasoningEffort } : {}) })

async function fixture() {
  const f = await remoteFixture()
  Object.assign(f.runtime, { modelConnections: { snapshot: async () => ({ providers: [deepseek], defaultProviderId: 'deepseek', defaultModel: 'fake' }) } })
  await f.code()
  const projectId: string = (await f.call('catalog.get', {})).projects[0].id
  const create = async (model: string, effort?: string) => (await f.call('code.create', { projectId, ...route(model, effort) })).receipt
  return { ...f, create }
}

describe('Code reasoning depth from a phone', () => {
  it('advertises the capability with per-model profiles', async () => {
    const f = await fixture()
    try {
      const catalog = await f.call('catalog.get', {})
      expect(catalog.capabilities).toContain(REASONING_EFFORT_CAPABILITY)
      expect(hasReasoningEffort(catalog)).toBe(true)
      expect(catalog.agents[0].routes[0]).toMatchObject({ providerId: 'deepseek', models: ['fake', 'plain'],
        profiles: { fake: { efforts: ['off', 'high', 'max'], defaultEffort: 'high' } } })
      expect(Object.keys(catalog.agents[0].routes[0].profiles)).toEqual(['fake'])
    } finally { await f.close() }
  })

  it('stores the depth at create, echoes it in settings and applies it to phone turns', async () => {
    const f = await fixture()
    try {
      const created = await f.create('fake', 'max')
      expect(created.status).toBe('applied')
      const id = created.result.thread.id
      expect((await f.h.threads.getMetadata(id))?.executionConfig?.route).toEqual(route('fake', 'max'))
      const settings = await f.call('code.settings.get', { threadId: id })
      expect(settings.effective).toEqual(route('fake', 'max'))
      expect(settings.next).toEqual(route('fake', 'max'))
      await f.call('code.turn.start', { threadId: id, text: 'think hard' })
      expect((await f.h.threads.get(id))?.turns[0].reasoningEffort).toBe('max')
    } finally { await f.close() }
  })

  it('changes only the next depth while a turn runs and clears it when the phone sends none', async () => {
    const f = await fixture()
    try {
      const id = (await f.create('fake', 'max')).result.thread.id
      await f.call('code.turn.start', { threadId: id, text: 'keep working' })
      const before = await f.call('code.settings.get', { threadId: id })
      const after = (await f.call('code.settings.update', { threadId: id, expectedRevision: before.revision,
        next: route('fake', 'off') })).receipt.result
      expect(after.effective.reasoningEffort).toBe('max')
      expect(after.next.reasoningEffort).toBe('off')
      const cleared = (await f.call('code.settings.update', { threadId: id, expectedRevision: after.revision,
        next: route('plain') })).receipt.result
      expect(cleared.next).toEqual(route('plain'))
    } finally { await f.close() }
  })

  it('refuses a depth the chosen model does not list, without an effect', async () => {
    const f = await fixture()
    try {
      await expect(f.create('fake', 'low')).rejects.toThrow('MODEL_NOT_AVAILABLE')
      await expect(f.create('plain', 'high')).rejects.toThrow('MODEL_NOT_AVAILABLE')
      const id = (await f.create('fake', 'high')).result.thread.id
      const before = await f.call('code.settings.get', { threadId: id })
      expect((await f.call('code.settings.update', { threadId: id, expectedRevision: before.revision,
        next: route('fake', 'low') })).receipt.error).toEqual({ code: 'MODEL_NOT_AVAILABLE', definitive: true })
      expect((await f.call('code.settings.get', { threadId: id })).next).toEqual(route('fake', 'high'))
    } finally { await f.close() }
  })
})
