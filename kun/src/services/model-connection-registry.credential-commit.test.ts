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
  it('does not attach a delayed old fence to an explicitly re-added provider incarnation', async () => {
      let fenceReachedInstall!: () => void
      const fenceAtInstall = new Promise<void>((resolve) => { fenceReachedInstall = resolve })
      let releaseFence!: () => void
      const fenceRelease = new Promise<void>((resolve) => { releaseFence = resolve })
      const beforeCredentialFenceInstall = vi.fn(async () => {
        fenceReachedInstall()
        await fenceRelease
      })
      const { value } = await registry(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        beforeCredentialFenceInstall
      )
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'old-incarnation-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const oldToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const delayedFence = value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: oldToken
      })
      await fenceAtInstall

      const deleted = await value.delete('deepseek', connected.revision)
      const readded = await value.connect({
        expectedRevision: deleted.revision,
        id: 'deepseek',
        name: 'DeepSeek Re-added',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'new-incarnation-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      releaseFence()

      await expect(delayedFence).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(value.prepareCredential('deepseek', {
        expectedRevision: readded.revision,
        credential: 'stale-secret',
        operationToken: oldToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'new-incarnation-secret'
      })
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({
        apiKey: 'new-incarnation-secret'
      })
    })

  it('shares a durable credential fence across two Manager-backed Registry instances', async () => {
      const { a, b, manager } = await sharedManagerRegistryPair()
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'

      const fenced = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })

      await expect(b.snapshot()).resolves.toMatchObject({
        revision: fenced.revision,
        providers: [expect.objectContaining({
          id: 'deepseek',
          credentialStatus: 'missing'
        })]
      })
      await expect(b.resolveApiKey(sourceId)).resolves.toBeNull()
      await expect(b.credentialForCompatibility('deepseek')).resolves.toBeNull()
      await expect(b.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: ''
      })
      expect((await b.materialize()).providers.get('deepseek')).toMatchObject({ apiKey: '' })
      await expect(b.probe('deepseek')).rejects.toThrow(/replacement is pending/u)
      await expect(b.replaceCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'tokenless-bypass'
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(b.patch('deepseek', {
        expectedRevision: fenced.revision,
        models: ['catalog-bypass'],
        selectedModel: 'catalog-bypass'
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(b.select({
        expectedRevision: fenced.revision,
        providerId: 'deepseek',
        model: 'deepseek-chat'
      })).rejects.toThrow(/replacement is pending/u)
      expect(manager.externalRequests).toEqual([])
      expect(JSON.stringify(manager.registryDocument())).not.toContain('tokenless-bypass')
    })

  it('keeps authenticated and verified CLI reconnects behind an active durable fence', async () => {
      const { a, b } = await sharedManagerRegistryPair()
      const connected = await a.connect(deepseekConnection())
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const fenced = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })

      await expect(b.connectAuthenticated({
        expectedRevision: fenced.revision,
        id: 'deepseek',
        name: 'DeepSeek OAuth',
        kind: 'http',
        authType: 'oauth',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'authenticated-bypass',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        select: true
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)

      await expect(b.connectAuthenticated({
        expectedRevision: fenced.revision,
        id: 'deepseek',
        name: 'Verified CLI bypass',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        select: true,
        externalAuthVerified: true
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)

      await expect(a.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: ''
      })
    })

  it('does not let a delayed authenticated reconnect overwrite a newer user generation', async () => {
      const { a, b, manager, credentialsA, credentialsB } = await sharedManagerRegistryPair()
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      const originalSet = credentialsA.set.bind(credentialsA)
      let writeStarted!: () => void
      const started = new Promise<void>((resolve) => { writeStarted = resolve })
      let releaseWrite!: () => void
      const released = new Promise<void>((resolve) => { releaseWrite = resolve })
      vi.spyOn(credentialsA, 'set').mockImplementation(async (reference, payload) => {
        if (payload.apiKey === 'delayed-authenticated-secret') {
          writeStarted()
          await released
        }
        await originalSet(reference, payload)
      })

      const reconnect = a.connectAuthenticated({
        expectedRevision: connected.revision,
        id: 'deepseek',
        name: 'DeepSeek OAuth',
        kind: 'http',
        authType: 'oauth',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'delayed-authenticated-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        select: true
      })
      await started
      const staleRef = manager.registryDocument().credentialTransactions.deepseek!.nextCredentialRef!
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const fenced = await b.fenceCredential('deepseek', {
        expectedRevision: manager.registryDocument().revision,
        operationToken
      })
      releaseWrite()

      await expect(reconnect).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(credentialsB.get(staleRef)).resolves.toBeNull()
      const prepared = await b.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'final-user-secret',
        operationToken
      })
      await b.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken
      })

      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'final-user-secret' })
      expect(JSON.stringify(manager.registryDocument())).not.toContain('delayed-authenticated-secret')
      expect(JSON.stringify(manager.registryDocument())).not.toContain('final-user-secret')
    })

  it('restores the previous credential when prepared commit live apply fails', async () => {
      let rejectCommittingApply = false
      const { a, manager } = await sharedManagerRegistryPair({
        optionsA: {
          onChanged: (connections) => {
            if (
              rejectCommittingApply &&
              connections.providers.get('deepseek')?.apiKey === ''
            ) {
              rejectCommittingApply = false
              throw new Error('reject committing apply')
            }
          }
        }
      })
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const fenced = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })
      const prepared = await a.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'rejected-secret',
        operationToken
      })
      rejectCommittingApply = true

      await expect(a.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken
      })).rejects.toThrow('reject committing apply')

      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'original-secret' })
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
      expect(manager.registryDocument().credentialRefCleanup).toEqual({})
    })
})
