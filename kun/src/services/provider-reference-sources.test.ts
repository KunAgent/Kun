import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { providerProductReferenceSources } from './provider-reference-sources.js'
import { scanProviderReferences } from './provider-configuration-references.js'
const manager = { discovery: { baseUrl: 'http://manager.test', managerToken: 'test' } } as ServiceManagerConnection
afterEach(() => vi.unstubAllGlobals())
describe('Manager-owned product reference inventory', () => {
  it('projects only reference fields from schedules, workflow, ADE projects and media for direct Runtime administration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ snapshot: { revision: 2, value: JSON.stringify({
      agents: { kun: { providerId: 'one', apiKey: 'never-project', imageGeneration: { providerId: 'one' }, ade: { projectDefaults: { project: { route: { providerId: 'one' } } } } } },
      provider: { providers: [{ id: 'one', apiKey: 'never-project' }], routePools: [{ targets: [{ providerId: 'one' }] }] },
      schedule: { tasks: [{ providerId: 'one', title: 'Nightly' }] }, workflow: { workflows: [{ nodes: [{ config: { providerId: 'one' } }] }] }
    }) } })))
    const inventory = await providerProductReferenceSources(manager)
    const references = scanProviderReferences(inventory, new Set(['one']), 'productSettings')
    expect(references).toHaveLength(4)
    expect(JSON.stringify(inventory)).not.toContain('never-project')
    expect(JSON.stringify(references)).not.toContain('routePools')
  })
  it('fails closed when authoritative Manager settings cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Manager disconnected')))
    await expect(providerProductReferenceSources(manager)).rejects.toThrow()
  })
})
