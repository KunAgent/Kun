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
  it('moves an existing Registry AtomicJson client from Manager M1 to M2', async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'kun-registry-manager-rebind-'))
      roots.push(dataDir)
      const documents = new Map<string, FakeManagerDocument>()
      const requests: Array<{ url: string; method: string }> = []
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          expectedRevision?: number
          value?: unknown
          path: string
        }
        let document = documents.get(body.path) ?? { revision: 0, value: null }
        requests.push({ url, method: String(init?.method ?? 'GET') })
        if (url.endsWith('/read')) return Response.json({ snapshot: structuredClone(document) })
        if (body.expectedRevision !== document.revision) {
          return Response.json({ currentRevision: document.revision }, { status: 409 })
        }
        document = {
          revision: document.revision + 1,
          value: structuredClone(body.value ?? null)
        }
        documents.set(body.path, document)
        return Response.json({ snapshot: structuredClone(document) })
      }))
      configureManagerAtomicJsonClient({
        baseUrl: 'http://manager-one.test',
        token: 'manager-one-token',
        dataDir
      })
      const value = new ModelConnectionRegistry({
        dataDir,
        credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' })
      })
      await value.initialize()
      const rebindAt = requests.length

      configureManagerAtomicJsonClient({
        baseUrl: 'http://manager-two.test',
        token: 'manager-two-token',
        dataDir
      })
      await value.connect({
        expectedRevision: 0,
        id: 'claude-subscription',
        name: 'Claude subscription',
        kind: 'agent-sdk',
        authType: 'subscription',
        endpointFormat: 'messages',
        models: ['claude-sonnet'],
        selectedModel: 'claude-sonnet',
        probe: false,
        select: true
      })

      const reboundRequests = requests.slice(rebindAt)
      expect(reboundRequests.some((request) => request.url.endsWith('/write'))).toBe(true)
      expect(reboundRequests.length).toBeGreaterThan(1)
      expect(reboundRequests.every((request) =>
        request.url.startsWith('http://manager-two.test/'))).toBe(true)
    })

  it('rejects a delayed lower generation after the newer generation committed', async () => {
      const { a, b } = await sharedManagerRegistryPair()
      const connected = await a.connect(deepseekConnection())
      const clientId = '11111111-1111-4111-8111-111111111111'
      const newerToken = `credential:${clientId}:2`
      const staleToken = `credential:${clientId}:1`
      const fenced = await b.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: newerToken
      })
      const prepared = await b.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'newer-secret',
        operationToken: newerToken
      })
      const committed = await b.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken: newerToken
      })

      await expect(a.fenceCredential('deepseek', {
        expectedRevision: committed.revision,
        operationToken: staleToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(a.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'newer-secret'
      })
    })

  it('releases local prepared plaintext after another Registry supersedes and commits', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const { a, b } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000 },
        optionsB: { credentialFenceTtlMs: 60_000 }
      })
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const secondToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const firstFence = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      await a.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'abandoned-local-plaintext',
        operationToken: firstToken
      })
      const firstProcess = a as unknown as {
        preparedCredentialSecrets: Map<string, { operationToken: string }>
        recoverExpiredCredentialTransaction(providerId: string, operationToken: string): Promise<boolean>
      }
      expect(firstProcess.preparedCredentialSecrets.get('deepseek')).toMatchObject({
        operationToken: firstToken
      })

      const secondFence = await b.fenceCredential('deepseek', {
        expectedRevision: (await b.snapshot()).revision,
        operationToken: secondToken
      })
      await a.materialize()
      expect(firstProcess.preparedCredentialSecrets.get('deepseek')).toMatchObject({
        operationToken: firstToken
      })
      const secondPrepared = await b.prepareCredential('deepseek', {
        expectedRevision: secondFence.revision,
        credential: 'authoritative-second-secret',
        operationToken: secondToken
      })
      await b.commitPreparedCredential('deepseek', {
        expectedRevision: secondPrepared.revision,
        operationToken: secondToken
      })
      await vi.advanceTimersByTimeAsync(70_000)
      expect(firstProcess.preparedCredentialSecrets.has('deepseek')).toBe(false)
      await expect(b.resolveApiKey(sourceId)).resolves.toEqual({
        apiKey: 'authoritative-second-secret'
      })
      expect((await b.snapshot()).providers[0]).toMatchObject({ configured: true })
    })

  it('releases local prepared plaintext after another Registry deletes the provider', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const { a, b, manager } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000 },
        optionsB: { credentialFenceTtlMs: 60_000 }
      })
      const connected = await a.connect(deepseekConnection())
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const firstFence = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      await a.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'deleted-local-plaintext',
        operationToken: firstToken
      })
      const firstProcess = a as unknown as {
        preparedCredentialSecrets: Map<string, { operationToken: string }>
      }
      const secondToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const secondFence = await b.fenceCredential('deepseek', {
        expectedRevision: (await b.snapshot()).revision,
        operationToken: secondToken
      })
      await a.materialize()
      expect(firstProcess.preparedCredentialSecrets.get('deepseek')).toMatchObject({
        operationToken: firstToken
      })
      await b.delete('deepseek', secondFence.revision)

      await vi.advanceTimersByTimeAsync(70_000)
      expect(firstProcess.preparedCredentialSecrets.has('deepseek')).toBe(false)
      expect((await b.snapshot()).providers).toEqual([])
      expect(manager.registryDocument().profiles.deepseek).toBeUndefined()
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
    })

  it('does not clear a current prepared secret when a stale durable schedule resumes', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const { a, manager } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000 }
      })
      const connected = await a.connect(deepseekConnection())
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const secondToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const firstFence = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      await a.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'superseded-local-secret',
        operationToken: firstToken
      })
      const staleTransaction = structuredClone(
        manager.registryDocument().credentialTransactions.deepseek
      )

      const secondFence = await a.fenceCredential('deepseek', {
        expectedRevision: (await a.snapshot()).revision,
        operationToken: secondToken
      })
      const secondPrepared = await a.prepareCredential('deepseek', {
        expectedRevision: secondFence.revision,
        credential: 'current-local-secret',
        operationToken: secondToken
      })
      const firstProcess = a as unknown as {
        preparedCredentialSecrets: Map<string, { operationToken: string }>
        scheduleCredentialRecovery(providerId: string, transaction: unknown): void
      }

      firstProcess.scheduleCredentialRecovery('deepseek', staleTransaction)
      expect(firstProcess.preparedCredentialSecrets.get('deepseek')).toMatchObject({
        operationToken: secondToken
      })
      await a.commitPreparedCredential('deepseek', {
        expectedRevision: secondPrepared.revision,
        operationToken: secondToken
      })
      await expect(a.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'current-local-secret'
      })
    })

  it('expires the same operation token independently for two providers', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const { a } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000 }
      })
      const first = await a.connect(deepseekConnection())
      const second = await a.connect({
        ...deepseekConnection(first.revision),
        id: 'other-provider',
        name: 'Other Provider'
      })
      const sharedToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const firstFence = await a.fenceCredential('deepseek', {
        expectedRevision: second.revision,
        operationToken: sharedToken
      })
      await a.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'deepseek-pending-secret',
        operationToken: sharedToken
      })
      const secondFence = await a.fenceCredential('other-provider', {
        expectedRevision: (await a.snapshot()).revision,
        operationToken: sharedToken
      })
      await a.prepareCredential('other-provider', {
        expectedRevision: secondFence.revision,
        credential: 'other-pending-secret',
        operationToken: sharedToken
      })
      const firstProcess = a as unknown as {
        preparedCredentialSecrets: Map<string, { operationToken: string }>
        preparedCredentialSecretTimers: Map<string, ReturnType<typeof setTimeout>>
      }
      expect(firstProcess.preparedCredentialSecrets.size).toBe(2)
      expect(firstProcess.preparedCredentialSecretTimers.size).toBe(2)

      await vi.advanceTimersByTimeAsync(70_000)
      expect(firstProcess.preparedCredentialSecrets.size).toBe(0)
      expect(firstProcess.preparedCredentialSecretTimers.size).toBe(0)
    })
})
