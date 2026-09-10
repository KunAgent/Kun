import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RegistryDocumentSchema } from '../../kun/src/services/model-connection-registry-core.js'
import { normalizeAppSettings } from '../shared/app-settings'
import { projectRegistryCredentials } from './legacy-provider-settings-migration'

describe('persisted Kimi preset mode compatibility', () => {
  it.each(['api', 'token-plan'] as const)('reads and projects %s without dropping identity', async (presetMode) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-preset-mode-'))
    try {
      const path = join(root, 'model-connections.v1.json')
      await writeFile(path, JSON.stringify({
        schemaVersion: 1, proxyRoutingVersion: 1, revision: 1,
        profiles: { 'kimi-code': {
          id: 'kimi-code', accountId: 'account:kimi-code', name: 'Kimi Code',
          presetSource: 'kimi-code', presetMode, kind: 'http', authType: 'subscription',
          baseUrl: 'https://api.kimi.com/coding/v1', endpointFormat: 'chat_completions',
          useProxy: false, configured: false, models: ['kimi-test']
        } }
      }))
      const document = RegistryDocumentSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      const settings = normalizeAppSettings({ provider: { providers: [{
        id: 'kimi-code', name: 'Kimi Code', apiKey: '', models: ['kimi-test'],
        presetSource: { presetId: 'kimi-code', mode: presetMode }
      }] } } as never)
      const projected = await projectRegistryCredentials(settings, async (id) => ({
        authoritative: Boolean(document.profiles[id]), apiKey: ''
      }), ['kimi-code'])
      expect(document.profiles['kimi-code'].presetMode).toBe(presetMode)
      // GUI catalog normalization may canonicalize subscription presets to their base mode.
      // Credential projection must preserve that normalized identity, not reinterpret Registry metadata.
      expect(projected.provider.providers.find((provider) => provider.id === 'kimi-code')?.presetSource)
        .toEqual(settings.provider.providers.find((provider) => provider.id === 'kimi-code')?.presetSource)
      expect(() => RegistryDocumentSchema.parse({ ...document, profiles: {
        'kimi-code': { ...document.profiles['kimi-code'], presetMode: 'invalid' }
      } })).toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
