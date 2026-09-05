import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import {
  ModelConnectionConflictError,
  ModelConnectionRegistry
} from './model-connection-registry.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function registry(onChanged?: ConstructorParameters<typeof ModelConnectionRegistry>[0]['onChanged']) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-proxy-'))
  roots.push(dataDir)
  const value = new ModelConnectionRegistry({
    dataDir,
    credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }),
    inspectCredentialSource: async () => 'ready',
    ...(onChanged ? { onChanged } : {})
  })
  return { dataDir, value }
}

function connection(expectedRevision: number, useProxy: boolean) {
  return {
    expectedRevision,
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.deepseek.com',
    endpointFormat: 'chat_completions' as const,
    useProxy,
    credential: 'secret',
    models: ['deepseek-chat'],
    selectedModel: 'deepseek-chat',
    probe: false,
    select: true
  }
}

describe('ModelConnectionRegistry provider proxy routing', () => {
  it.each([
    { enabled: true, explicit: undefined, expected: true },
    { enabled: false, explicit: undefined, expected: false },
    { enabled: true, explicit: false, expected: false }
  ])('atomically upgrades legacy profiles from the stored global state', async ({
    enabled,
    explicit,
    expected
  }) => {
    const { dataDir, value } = await registry()
    const path = join(dataDir, 'model-connections.v1.json')
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      revision: 4,
      profiles: {
        deepseek: {
          id: 'deepseek',
          accountId: 'account:deepseek',
          name: 'DeepSeek',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://api.deepseek.com',
          endpointFormat: 'chat_completions',
          ...(explicit === undefined ? {} : { useProxy: explicit }),
          configured: false,
          models: ['deepseek-chat'],
          selectedModel: 'deepseek-chat'
        }
      },
      tombstones: {},
      credentialTransactions: {},
      credentialRefCleanup: {},
      proxy: { enabled, url: 'http://127.0.0.1:7890' },
      routePools: [],
      localModelGateway: { enabled: false }
    }))

    const snapshot = await value.initialize()

    expect(snapshot).toMatchObject({
      proxyRoutingVersion: 1,
      providers: [expect.objectContaining({ id: 'deepseek', useProxy: expected })]
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      proxyRoutingVersion: 1,
      profiles: { deepseek: { useProxy: expected } }
    })
  })

  it('persists connect and patch choices, hot-applies them, and blocks global fallback', async () => {
    const applied: Array<string | undefined> = []
    const { value } = await registry((connections) => {
      applied.push(connections.providers.get('deepseek')?.modelProxyUrl)
    })
    await value.initialize([], {
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
    })
    const connected = await value.connect(connection(1, false))

    expect(connected.providers[0]?.useProxy).toBe(false)
    expect((await value.materialize()).providers.get('deepseek')?.modelProxyUrl).toBe('')

    const patched = await value.patch('deepseek', {
      expectedRevision: connected.revision,
      useProxy: true
    })
    expect(patched.providers[0]?.useProxy).toBe(true)
    expect((await value.materialize()).providers.get('deepseek')?.modelProxyUrl)
      .toBe('http://127.0.0.1:7890/')
    expect(applied.at(-1)).toBe('http://127.0.0.1:7890/')

    const reseeded = await value.initialize([{
      ...connection(0, false),
      useProxy: undefined
    }])
    expect(reseeded.providers[0]?.useProxy).toBe(true)

    await expect(value.patch('deepseek', {
      expectedRevision: connected.revision,
      useProxy: false
    })).rejects.toBeInstanceOf(ModelConnectionConflictError)
  })

  it('fails closed for an invalid selected proxy and keeps delegated providers direct', async () => {
    const { value } = await registry()
    await value.initialize([], { proxy: { enabled: true, url: 'not-a-proxy' } })
    await value.connect(connection(1, true))
    await expect(value.materialize()).rejects.toMatchObject({ code: 'provider_proxy_invalid' })

    const snapshot = await value.snapshot()
    await value.patch('deepseek', { expectedRevision: snapshot.revision, kind: 'agent-sdk' })
    expect((await value.materialize()).providers.get('deepseek')?.modelProxyUrl).toBe('')
  })
})
