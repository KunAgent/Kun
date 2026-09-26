import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function deepseekConnection(expectedRevision = 0) {
  return {
    expectedRevision,
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.deepseek.com',
    endpointFormat: 'chat_completions' as const,
    credential: 'original-secret',
    models: ['deepseek-chat'],
    selectedModel: 'deepseek-chat',
    probe: false,
    select: true
  }
}

async function registry() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-connections-globals-'))
  roots.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const value = new ModelConnectionRegistry({ dataDir, credentials })
  await value.initialize()
  return { dataDir, value }
}

describe('ModelConnectionRegistry globals', () => {
  it('keeps failover groups when a globals patch omits the field', async () => {
    const { value } = await registry()
    const connected = await value.connect(deepseekConnection())
    const failover = [{
      providerId: 'deepseek',
      members: [{ providerId: 'deepseek', enabled: true, models: [] }],
      strategy: 'order' as const,
      fallbackTargets: []
    }]
    const withFailover = await value.updateGlobals({
      expectedRevision: connected.revision,
      proxy: { enabled: false, url: '' },
      routePools: [],
      failover,
      localModelGateway: { enabled: false, exposeProviderModels: false }
    })
    expect(withFailover.failover).toEqual(failover)

    const partial = await value.updateGlobals({
      expectedRevision: withFailover.revision,
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
      routePools: [],
      localModelGateway: { enabled: false, exposeProviderModels: false }
    })
    expect(partial.failover).toEqual(failover)
    expect(partial.proxy).toEqual({ enabled: true, url: 'http://127.0.0.1:7890' })
  })
})
