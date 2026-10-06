import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import {
  isModelConnectionCredentialSourceId,
  ModelConnectionConflictError,
  ModelConnectionRegistry
} from './model-connection-registry.js'
import { CodexOAuthCredentialRefresher } from './codex-oauth-credential-refresher.js'

const roots: string[] = []

afterEach(async () => {
  configureManagerAtomicJsonClient(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

type FakeManagerDocument = { revision: number; value: unknown | null }

function installFakeAtomicJsonManager(dataDir: string) {
  const documents = new Map<string, FakeManagerDocument>()
  const externalRequests: string[] = []
  vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://manager.test')
  vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
  vi.stubEnv('KUN_MANAGER_DATA_DIR', dataDir)
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (!url.startsWith('http://manager.test/')) {
      externalRequests.push(url)
      return Response.json({ data: [{ id: 'external-model' }] })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      path: string
      expectedRevision?: number
      value?: unknown
    }
    const current = documents.get(body.path) ?? { revision: 0, value: null }
    if (url.endsWith('/read')) return Response.json({ snapshot: structuredClone(current) })
    if (body.expectedRevision !== current.revision) {
      return Response.json({ currentRevision: current.revision }, { status: 409 })
    }
    const next = url.endsWith('/delete')
      ? { revision: current.revision + 1, value: null }
      : { revision: current.revision + 1, value: structuredClone(body.value ?? null) }
    documents.set(body.path, next)
    return Response.json({ snapshot: structuredClone(next) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    documents,
    externalRequests,
    registryDocument: () => documents.get(join(dataDir, 'model-connections.v2.json'))?.value as {
      revision: number
      profiles: Record<string, { credentialRef?: string }>
      credentialTransactions: Record<string, {
        operationToken: string
        phase: string
        nextCredentialRef?: string
      }>
      credentialRefCleanup: Record<string, { reference: string; writerPid?: number }>
    }
  }
}

async function sharedManagerRegistryPair(input: {
  dataDir?: string
  optionsA?: Partial<ConstructorParameters<typeof ModelConnectionRegistry>[0]>
  optionsB?: Partial<ConstructorParameters<typeof ModelConnectionRegistry>[0]>
} = {}) {
  const dataDir = input.dataDir ?? await mkdtemp(join(tmpdir(), 'kun-model-connections-manager-'))
  if (!input.dataDir) roots.push(dataDir)
  const manager = installFakeAtomicJsonManager(dataDir)
  const credentialsA = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const credentialsB = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const a = new ModelConnectionRegistry({
    dataDir,
    credentials: credentialsA,
    ...input.optionsA
  })
  const b = new ModelConnectionRegistry({
    dataDir,
    credentials: credentialsB,
    ...input.optionsB
  })
  await a.initialize()
  await b.initialize()
  return { dataDir, manager, credentialsA, credentialsB, a, b }
}

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

async function registry(
  modelCapabilities?: ConstructorParameters<typeof ModelConnectionRegistry>[0]['modelCapabilities'],
  retireLegacyCredentialSource?: (sourceId: string) => Promise<void>,
  resolveCredentialSource?: ConstructorParameters<typeof ModelConnectionRegistry>[0]['resolveCredentialSource'],
  inspectCredentialSource?: ConstructorParameters<typeof ModelConnectionRegistry>[0]['inspectCredentialSource'],
  credentialFenceTtlMs?: number,
  beforeCredentialFenceInstall?: ConstructorParameters<
    typeof ModelConnectionRegistry
  >[0]['beforeCredentialFenceInstall'],
  afterCredentialCommitWrite?: ConstructorParameters<
    typeof ModelConnectionRegistry
  >[0]['afterCredentialCommitWrite']
) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-connections-'))
  roots.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const applied: string[] = []
  const value = new ModelConnectionRegistry({
    dataDir,
    credentials,
    ...(modelCapabilities ? { modelCapabilities } : {}),
    ...(retireLegacyCredentialSource ? { retireLegacyCredentialSource } : {}),
    ...(resolveCredentialSource ? { resolveCredentialSource } : {}),
    inspectCredentialSource: inspectCredentialSource ?? (async () => 'ready'),
    ...(credentialFenceTtlMs ? { credentialFenceTtlMs } : {}),
    ...(beforeCredentialFenceInstall ? { beforeCredentialFenceInstall } : {}),
    ...(afterCredentialCommitWrite ? { afterCredentialCommitWrite } : {}),
    onChanged: (connections) => {
      if (connections.selected) applied.push(`${connections.selected.profile.id}/${connections.selected.model}`)
    }
  })
  await value.initialize()
  return { dataDir, value, applied, credentials }
}

describe('ModelConnectionRegistry', () => {
  it('reclaims acknowledged credential refs without an unbounded cleanup queue', async () => {
      const { a, manager, credentialsA } = await sharedManagerRegistryPair()
      let snapshot = await a.connect(deepseekConnection())
      const deletedRefs: string[] = []
      const originalDelete = credentialsA.delete.bind(credentialsA)
      vi.spyOn(credentialsA, 'delete').mockImplementation(async (reference) => {
        deletedRefs.push(reference)
        await originalDelete(reference)
      })

      for (let index = 0; index < 8; index += 1) {
        snapshot = await a.replaceCredential('deepseek', {
          expectedRevision: snapshot.revision,
          credential: `rotated-${index}`
        })
        expect(manager.registryDocument().credentialRefCleanup).toEqual({})
      }
      expect(new Set(deletedRefs).size).toBe(8)
      expect(deletedRefs).toHaveLength(8)
      await a.initialize()
      expect(deletedRefs).toHaveLength(8)
    })

  it('isolates an unreadable legacy credential and reports replacement as ready', async () => {
      const retired = vi.fn(async (_sourceId: string) => undefined)
      const inspectLegacy = vi.fn(async (sourceId: string) => {
        if (sourceId === 'settings:provider:deepseek') {
          throw new Error(`decrypt failed for ${sourceId}: secret material must stay private`)
        }
        return 'missing' as const
      })
      const { dataDir, value } = await registry(
        undefined,
        retired,
        undefined,
        inspectLegacy
      )
      const seeded = await value.initialize([
        {
          expectedRevision: 0,
          id: 'deepseek',
          name: 'DeepSeek',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://api.deepseek.com',
          endpointFormat: 'chat_completions',
          credentialSourceId: 'settings:provider:deepseek',
          models: ['deepseek-chat'],
          selectedModel: 'deepseek-chat',
          probe: false,
          select: true
        },
        {
          expectedRevision: 0,
          id: 'healthy',
          name: 'Healthy Provider',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://healthy.example.test/v1',
          endpointFormat: 'chat_completions',
          credential: 'healthy-secret',
          models: ['healthy-model'],
          selectedModel: 'healthy-model',
          probe: false,
          select: false
        }
      ])

      expect(seeded.providers.find((profile) => profile.id === 'deepseek')).toMatchObject({
        configured: false,
        credentialStatus: 'unreadable',
        credentialErrorCode: 'credential_unreadable'
      })
      expect(seeded.defaultProviderId).toBeUndefined()
      expect(seeded.providers.find((profile) => profile.id === 'healthy')).toMatchObject({
        configured: true,
        credentialStatus: 'ready'
      })
      expect(JSON.stringify(seeded)).not.toContain('settings:provider:deepseek')
      expect(JSON.stringify(seeded)).not.toContain('decrypt failed')
      expect(JSON.stringify(seeded)).not.toContain('secret material')
      const beforeReplacement = await value.materialize()
      expect(beforeReplacement.providers.get('healthy')).toMatchObject({
        apiKey: 'healthy-secret'
      })
      expect(beforeReplacement.providers.has('deepseek')).toBe(false)
      await expect(value.select({
        expectedRevision: seeded.revision,
        providerId: 'deepseek',
        model: 'deepseek-chat'
      })).rejects.toThrow('provider is not connected')

      const replaced = await value.replaceCredential('deepseek', {
        expectedRevision: seeded.revision,
        credential: 'replacement-secret'
      })

      expect(replaced.providers.find((profile) => profile.id === 'deepseek')).toMatchObject({
        configured: true,
        credentialStatus: 'ready'
      })
      expect(replaced.providers.find((profile) => profile.id === 'deepseek'))
        .not.toHaveProperty('credentialErrorCode')
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({
        credentialSourceId: 'model-connection:deepseek',
        apiKey: 'replacement-secret'
      })
      expect(retired).toHaveBeenCalledWith('settings:provider:deepseek')

      const stored = await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')
      expect(stored).not.toContain('credentialStatus')
      expect(stored).not.toContain('credentialErrorCode')
      expect(stored).not.toContain('replacement-secret')
    })

  it('keeps failed targeted legacy retirement durable and retries it on initialize', async () => {
      const retired: string[] = []
      let attempts = 0
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { dataDir, value } = await registry(undefined, async (sourceId) => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary legacy store failure')
        retired.push(sourceId)
      })
      const legacy = await value.initialize([{
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credentialSourceId: 'settings:provider:deepseek',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      }])

      await value.replaceCredential('deepseek', {
        expectedRevision: legacy.revision,
        credential: 'replacement-secret'
      })
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8'))
        .toContain('settings:provider:deepseek')
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({
        apiKey: 'replacement-secret',
        credentialSourceId: 'model-connection:deepseek'
      })

      await value.initialize()
      expect(retired).toEqual(['settings:provider:deepseek'])
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8'))
        .not.toContain('settings:provider:deepseek')
      warn.mockRestore()
    })

  it('keeps provider deletion durable across stale seeds and allows an explicit same-id re-add', async () => {
      const { dataDir, value } = await registry()
      const request = {
        expectedRevision: 0,
        id: 'restart-safe',
        name: 'Restart Safe',
        kind: 'http' as const,
        authType: 'api-key' as const,
        baseUrl: 'https://restart-safe.example/v1',
        endpointFormat: 'chat_completions' as const,
        credential: 'old-secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      }
      const connected = await value.connect(request)
      const deleted = await value.delete('restart-safe', connected.revision)

      const staleSeed = await value.initialize([{ ...request, expectedRevision: deleted.revision }])
      expect(staleSeed.providers).toEqual([])

      const restarted = new ModelConnectionRegistry({
        dataDir,
        credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' })
      })
      const afterRestart = await restarted.initialize([{ ...request, expectedRevision: deleted.revision }])
      expect(afterRestart.providers).toEqual([])

      const readded = await restarted.connect({
        ...request,
        expectedRevision: afterRestart.revision,
        credential: 'new-secret'
      })
      expect(readded.providers).toEqual([
        expect.objectContaining({ id: 'restart-safe', configured: true })
      ])
      expect((await restarted.materialize()).providers.get('restart-safe')?.apiKey).toBe('new-secret')
      const stored = JSON.parse(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')) as {
        tombstones: Record<string, unknown>
      }
      expect(stored.tombstones).toEqual({})
    })
})
