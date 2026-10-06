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
  it('carries client generation high-water across delete and same-id re-add', async () => {
      const { a, b } = await sharedManagerRegistryPair()
      const connected = await a.connect(deepseekConnection())
      const clientId = '11111111-1111-4111-8111-111111111111'
      const firstToken = `credential:${clientId}:1`
      const fenced = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      const deleted = await b.delete('deepseek', fenced.revision)
      const readded = await b.connect({
        ...deepseekConnection(deleted.revision),
        credential: 'new-incarnation-secret'
      })

      await expect(a.fenceCredential('deepseek', {
        expectedRevision: readded.revision,
        operationToken: firstToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(a.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'new-incarnation-secret'
      })
      await expect(a.fenceCredential('deepseek', {
        expectedRevision: readded.revision,
        operationToken: `credential:${clientId}:2`
      })).resolves.toMatchObject({
        providers: [expect.objectContaining({ credentialStatus: 'missing' })]
      })
    })

  it('retains the current client when bounding sixty-four generation high-waters', async () => {
      const { a, manager } = await sharedManagerRegistryPair()
      let snapshot = await a.connect(deepseekConnection())
      const clientIds = Array.from({ length: 64 }, (_, index) =>
        `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`)
      for (const clientId of clientIds) {
        snapshot = await a.fenceCredential('deepseek', {
          expectedRevision: snapshot.revision,
          operationToken: `credential:${clientId}:1`
        })
      }
      snapshot = await a.fenceCredential('deepseek', {
        expectedRevision: snapshot.revision,
        operationToken: `credential:${clientIds[0]}:2`
      })

      const profile = manager.registryDocument().profiles.deepseek as {
        credentialMutationHighWater?: Record<string, number>
      }
      expect(Object.keys(profile.credentialMutationHighWater ?? {})).toHaveLength(64)
      expect(profile.credentialMutationHighWater?.[clientIds[0]!]).toBe(2)
      await expect(a.fenceCredential('deepseek', {
        expectedRevision: snapshot.revision,
        operationToken: `credential:${clientIds[0]}:1`
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
    })

  it('keeps an expired fence durable when recovery apply fails once', async () => {
      let now = 0
      let failRecovery = false
      let recoveryAttempts = 0
      const { a, b, manager } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000, nowMs: () => now },
        optionsB: {
          credentialFenceTtlMs: 60_000,
          nowMs: () => now,
          onChanged: (connections) => {
            if (!failRecovery || connections.providers.get('deepseek')?.apiKey !== 'original-secret') return
            recoveryAttempts += 1
            failRecovery = false
            throw new Error('fail recovery apply once')
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
      await a.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'abandoned-secret',
        operationToken
      })
      now = 70_000
      failRecovery = true

      await expect(b.resolveApiKey(sourceId)).resolves.toBeNull()
      expect(manager.registryDocument().credentialTransactions.deepseek?.phase).toBe('recovering')
      await expect(b.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'original-secret'
      })
      expect(recoveryAttempts).toBe(1)
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
    })

  it('rejects a new fence while another Registry is applying non-HTTP recovery', async () => {
      let now = 0
      let recoveryStarted!: () => void
      const started = new Promise<void>((resolve) => { recoveryStarted = resolve })
      let releaseRecovery!: () => void
      const released = new Promise<void>((resolve) => { releaseRecovery = resolve })
      let blockRecovery = false
      const { a, b } = await sharedManagerRegistryPair({
        optionsA: { credentialFenceTtlMs: 60_000, nowMs: () => now },
        optionsB: {
          credentialFenceTtlMs: 60_000,
          nowMs: () => now,
          onChanged: async (connections) => {
            if (!blockRecovery || connections.providers.get('sdk-provider')?.apiKey !== 'sdk-secret') return
            blockRecovery = false
            recoveryStarted()
            await released
          }
        }
      })
      const connected = await a.connect({
        expectedRevision: 0,
        id: 'sdk-provider',
        name: 'SDK Provider',
        kind: 'agent-sdk',
        authType: 'subscription',
        endpointFormat: 'messages',
        credential: 'sdk-secret',
        models: ['sdk-model'],
        selectedModel: 'sdk-model',
        probe: false,
        select: true
      })
      const sourceId = (await a.materialize()).providers.get('sdk-provider')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const nextToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const fenced = await a.fenceCredential('sdk-provider', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      await a.prepareCredential('sdk-provider', {
        expectedRevision: fenced.revision,
        credential: 'abandoned-sdk-secret',
        operationToken: firstToken
      })
      now = 70_000
      blockRecovery = true
      const recovering = b.resolveApiKey(sourceId)
      await started

      await expect(a.fenceCredential('sdk-provider', {
        expectedRevision: (await a.snapshot()).revision,
        operationToken: nextToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
      releaseRecovery()
      await expect(recovering).resolves.toEqual({ apiKey: 'sdk-secret' })

      const nextFence = await a.fenceCredential('sdk-provider', {
        expectedRevision: (await a.snapshot()).revision,
        operationToken: nextToken
      })
      expect(nextFence.providers[0]).toMatchObject({ credentialStatus: 'missing' })
      expect((await a.materialize()).providers.get('sdk-provider')).toMatchObject({ apiKey: '' })
    })

  it('keeps a cleanup tombstone when expiry deletes before a delayed secret write', async () => {
      let now = 0
      let commitRecorded!: () => void
      const recorded = new Promise<void>((resolve) => { commitRecorded = resolve })
      let releaseCommit!: () => void
      const released = new Promise<void>((resolve) => { releaseCommit = resolve })
      const { a, b, manager, credentialsB } = await sharedManagerRegistryPair({
        optionsA: {
          credentialFenceTtlMs: 60_000,
          nowMs: () => now,
          afterCredentialCommitRecord: async () => {
            commitRecorded()
            await released
          }
        },
        optionsB: { credentialFenceTtlMs: 60_000, nowMs: () => now }
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
        credential: 'late-orphan-secret',
        operationToken
      })
      const commit = a.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken
      })
      await recorded
      const staleRef = manager.registryDocument().credentialTransactions.deepseek!.nextCredentialRef!
      now = 70_000

      await expect(b.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'original-secret' })
      expect(manager.registryDocument().credentialRefCleanup).toHaveProperty(staleRef)
      await expect(credentialsB.get(staleRef)).resolves.toBeNull()
      releaseCommit()
      await expect(commit).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(credentialsB.get(staleRef)).resolves.toBeNull()
      expect(manager.registryDocument().credentialRefCleanup).not.toHaveProperty(staleRef)
    })

  it('keeps a retryable cleanup record when the stale writer delete fails once', async () => {
      let commitRecorded!: () => void
      const recorded = new Promise<void>((resolve) => { commitRecorded = resolve })
      let releaseCommit!: () => void
      const released = new Promise<void>((resolve) => { releaseCommit = resolve })
      const { a, b, manager, credentialsA, credentialsB } = await sharedManagerRegistryPair({
        optionsA: {
          afterCredentialCommitRecord: async () => {
            commitRecorded()
            await released
          }
        }
      })
      const connected = await a.connect(deepseekConnection())
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const fenced = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })
      const prepared = await a.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'delete-retry-secret',
        operationToken
      })
      const commit = a.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken
      })
      await recorded
      const staleRef = manager.registryDocument().credentialTransactions.deepseek!.nextCredentialRef!
      await b.fenceCredential('deepseek', {
        expectedRevision: manager.registryDocument().revision,
        operationToken: 'credential:11111111-1111-4111-8111-111111111111:2'
      })
      const originalDelete = credentialsA.delete.bind(credentialsA)
      let failDelete = true
      vi.spyOn(credentialsA, 'delete').mockImplementation(async (reference) => {
        if (reference === staleRef && failDelete) {
          failDelete = false
          throw new Error('delete failed once')
        }
        await originalDelete(reference)
      })
      releaseCommit()

      await expect(commit).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(credentialsB.get(staleRef)).resolves.toMatchObject({ apiKey: 'delete-retry-secret' })
      expect(manager.registryDocument().credentialRefCleanup[staleRef]).toEqual({
        reference: staleRef,
        enqueuedAt: expect.any(Number)
      })
      await b.initialize()
      await expect(credentialsB.get(staleRef)).resolves.toBeNull()
      expect(manager.registryDocument().credentialRefCleanup).not.toHaveProperty(staleRef)
    })
})
