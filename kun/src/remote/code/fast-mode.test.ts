import { describe, expect, it } from 'vitest'
import { MODEL_INFO_CAPABILITY, hasModelInfo, validateModelInfo } from '@kun/remote-protocol'
import { remoteFixture } from '../testing/runtime.test-support.js'

const capability = (id: string, serviceTiers: string[]) => ({ id, inputModalities: ['text', 'image'], outputModalities: ['text'],
  supportsToolCalling: true, messageParts: ['text', 'input_image'], serviceTiers })
const codex = {
  id: 'codex', name: 'Codex', kind: 'http', presetSource: 'codex', configured: true, credentialStatus: 'ready', models: ['fast', 'slow'],
  modelCapabilities: { fast: capability('fast', ['priority']), slow: capability('slow', ['flex']) }
}
const route = (model: string) => ({ harnessId: 'kun', credentialMode: 'provider', providerId: 'codex', model })

async function fixture() {
  const f = await remoteFixture()
  Object.assign(f.runtime, { modelConnections: { snapshot: async () => ({ providers: [codex], defaultProviderId: 'codex', defaultModel: 'fast' }) } })
  await f.code()
  const projectId: string = (await f.call('catalog.get', {})).projects[0].id
  const create = async (model: string) => (await f.call('code.create', { projectId, ...route(model) })).receipt.result.thread.id as string
  return { ...f, create }
}

describe('Code model info and Fast mode from a phone', () => {
  it('advertises the capability with names, vision and Fast per model', async () => {
    const f = await fixture()
    try {
      const catalog = await f.call('catalog.get', {})
      expect(catalog.capabilities).toContain(MODEL_INFO_CAPABILITY)
      expect(hasModelInfo(catalog)).toBe(true)
      const codexRoute = catalog.agents[0].routes[0]
      expect(codexRoute.modelInfo).toEqual({ fast: { inputModalities: ['text', 'image'], fastMode: 'supported' },
        slow: { inputModalities: ['text', 'image'], fastMode: 'unsupported' } })
      expect(validateModelInfo(codexRoute)).toBe(codexRoute)
    } finally { await f.close() }
  })

  it('applies Fast to a phone turn only on a model that supports it', async () => {
    const f = await fixture()
    try {
      const fast = await f.create('fast')
      await f.call('code.turn.start', { threadId: fast, text: 'quick', serviceTier: 'priority' })
      expect((await f.h.threads.get(fast))?.turns[0].serviceTier).toBe('priority')
      const slow = await f.create('slow')
      await f.call('code.turn.start', { threadId: slow, text: 'quick', serviceTier: 'priority' })
      expect((await f.h.threads.get(slow))?.turns[0].serviceTier).toBeUndefined()
      const plain = await f.create('fast')
      await f.call('code.turn.start', { threadId: plain, text: 'normal' })
      expect((await f.h.threads.get(plain))?.turns[0].serviceTier).toBeUndefined()
    } finally { await f.close() }
  })

  it('refuses a tier other than priority without an effect', async () => {
    const f = await fixture()
    try {
      const id = await f.create('fast')
      await expect(f.call('code.turn.start', { threadId: id, text: 'x', serviceTier: 'flex' })).rejects.toThrow()
      expect((await f.h.threads.get(id))?.turns).toHaveLength(0)
    } finally { await f.close() }
  })
})
