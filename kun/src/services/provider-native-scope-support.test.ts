import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { ProviderConfigurationStateSchema } from '../contracts/provider-configuration.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
const base = { id: 'native', name: 'Native', kind: 'gemini-cli-api' as const, endpointFormat: 'chat_completions', useProxy: false }
const auth = (purposes: ('inference' | 'discovery' | 'oauth' | 'quota')[]) => ({ mode: 'adapter' as const, prefix: 'Bearer ' as const,
  scope: { hosts: ['cloudcode-pa.googleapis.com'], purposes } })
describe('native adapter scope boundary', () => {
  it('preserves legacy native behavior but rejects unsupported direct and inherited HTTP/OAuth scopes', () => {
    expect(effectiveProviderConfiguration(base, ProviderConfigurationStateSchema.parse({})).authProfile).toBeUndefined()
    for (const purpose of ['inference', 'discovery', 'oauth'] as const) {
      expect(() => effectiveProviderConfiguration(base, ProviderConfigurationStateSchema.parse({ connections: { native: { authProfile: auth([purpose]) } } }))).toThrow('Unsupported native provider scopes')
      expect(() => effectiveProviderConfiguration(base, ProviderConfigurationStateSchema.parse({ groups: { group: { id: 'group', name: 'Group', defaults: { authProfile: auth([purpose]) } } },
        connections: { native: { groupId: 'group', inherit: ['authProfile'] } } }))).toThrow('Unsupported native provider scopes')
    }
    expect(effectiveProviderConfiguration(base, ProviderConfigurationStateSchema.parse({ connections: { native: { authProfile: auth(['quota']) } } })).authProfile).toEqual(auth(['quota']))
    expect(() => effectiveProviderConfiguration(base, ProviderConfigurationStateSchema.parse({ connections: { native: {
      headerProfile: { scope: { hosts: ['cloudcode-pa.googleapis.com'], purposes: ['quota'] } } } } }))).toThrow('Unsupported native provider scopes')
  })
  it('rejects the unsupported profile before configuration preview or persistence', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-native-scopes-'))
    try {
      const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
      await registry.initialize()
      const snapshot = await registry.connect({ expectedRevision: 0, id: base.id, name: base.name, kind: base.kind, models: ['model-a'], probe: false, select: false })
      await expect(registry.previewConfiguration({ expectedRevision: snapshot.revision, operations: [{ kind: 'configure-connection', connectionId: base.id,
        configuration: { authProfile: auth(['inference']) } }] })).rejects.toThrow('Unsupported native provider scopes')
      expect((await registry.configurationSnapshot()).configuration.connections[base.id]?.authProfile).toBeUndefined()
    } finally { await rm(dataDir, { recursive: true, force: true }) }
  })
})
