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
  it('restores the previous credential when tokenless replace live apply fails', async () => {
      let rejectCommittingApply = false
      const { a, manager } = await sharedManagerRegistryPair({
        optionsA: {
          onChanged: (connections) => {
            if (
              rejectCommittingApply &&
              connections.providers.get('deepseek')?.apiKey === ''
            ) {
              rejectCommittingApply = false
              throw new Error('reject replace apply')
            }
          }
        }
      })
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      rejectCommittingApply = true

      await expect(a.replaceCredential('deepseek', {
        expectedRevision: connected.revision,
        credential: 'rejected-replacement-secret'
      })).rejects.toThrow('reject replace apply')

      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'original-secret' })
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
      expect(manager.registryDocument().credentialRefCleanup).toEqual({})
    })

  it('restores the previous credential when OAuth refresh live apply fails', async () => {
      let rejectCommittingApply = false
      const { a, manager } = await sharedManagerRegistryPair({
        optionsA: {
          onChanged: (connections) => {
            if (
              rejectCommittingApply &&
              connections.providers.get('deepseek')?.apiKey === ''
            ) {
              rejectCommittingApply = false
              throw new Error('reject refresh apply')
            }
          }
        }
      })
      await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      rejectCommittingApply = true

      await expect(a.updateResolvedApiKey(
        sourceId,
        'original-secret',
        'rejected-refresh-secret'
      )).rejects.toThrow('reject refresh apply')

      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'original-secret' })
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
      expect(manager.registryDocument().credentialRefCleanup).toEqual({})
    })

  it('lets a second Manager-backed Registry supersede a delayed committing generation', async () => {
      let commitRecorded!: () => void
      const recorded = new Promise<void>((resolve) => { commitRecorded = resolve })
      let releaseCommit!: () => void
      const released = new Promise<void>((resolve) => { releaseCommit = resolve })
      const { a, b, manager, credentialsB } = await sharedManagerRegistryPair({
        optionsA: {
          afterCredentialCommitRecord: async () => {
            commitRecorded()
            await released
          }
        }
      })
      const connected = await a.connect(deepseekConnection())
      const sourceId = (await a.materialize()).providers.get('deepseek')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const finalToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const firstFence = await a.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      const firstPrepared = await a.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'superseded-secret',
        operationToken: firstToken
      })
      const staleCommit = a.commitPreparedCredential('deepseek', {
        expectedRevision: firstPrepared.revision,
        operationToken: firstToken
      })
      await recorded
      const staleRef = manager.registryDocument().credentialTransactions.deepseek!.nextCredentialRef!

      const finalFence = await b.fenceCredential('deepseek', {
        expectedRevision: manager.registryDocument().revision,
        operationToken: finalToken
      })
      releaseCommit()
      await expect(staleCommit).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(credentialsB.get(staleRef)).resolves.toBeNull()

      const finalPrepared = await b.prepareCredential('deepseek', {
        expectedRevision: finalFence.revision,
        credential: 'final-secret',
        operationToken: finalToken
      })
      await b.commitPreparedCredential('deepseek', {
        expectedRevision: finalPrepared.revision,
        operationToken: finalToken
      })
      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'final-secret' })
      expect(JSON.stringify(manager.registryDocument())).not.toContain('superseded-secret')
      expect(JSON.stringify(manager.registryDocument())).not.toContain('final-secret')
    })

  it('retries connect cleanup after final CAS conflict while the writer is still alive', async () => {
      let managerRef: ReturnType<typeof installFakeAtomicJsonManager> | undefined
      let dataDirRef = ''
      let reservedRef = ''
      const pair = await sharedManagerRegistryPair({
        optionsA: {
          afterCredentialConnectWrite: async (providerId) => {
            const manager = managerRef!
            const path = join(dataDirRef, 'model-connections.v2.json')
            const entry = manager.documents.get(path)!
            const value = structuredClone(entry.value) as {
              revision: number
              credentialTransactions: Record<string, { nextCredentialRef?: string }>
            }
            reservedRef = value.credentialTransactions[providerId]!.nextCredentialRef!
            delete value.credentialTransactions[providerId]
            value.revision += 1
            manager.documents.set(path, { revision: entry.revision + 1, value })
          }
        }
      })
      managerRef = pair.manager
      dataDirRef = pair.dataDir
      const deleteCredential = vi.spyOn(pair.credentialsA, 'delete')
        .mockRejectedValueOnce(new Error('keychain delete failed'))

      await expect(pair.a.connect(deepseekConnection())).rejects.toBeInstanceOf(
        ModelConnectionConflictError
      )
      expect(reservedRef).toMatch(/^cred_/u)
      expect(deleteCredential).toHaveBeenCalledTimes(2)
      await expect(pair.credentialsB.get(reservedRef)).resolves.toBeNull()
      expect(pair.manager.registryDocument().credentialRefCleanup).not.toHaveProperty(reservedRef)
      expect(pair.manager.registryDocument().profiles.deepseek).toBeUndefined()
    })

  it('recovers a connect reservation after the writer crashes between secret write and finalize', async () => {
      let writeStarted!: () => void
      const started = new Promise<void>((resolve) => { writeStarted = resolve })
      let releaseWriter!: () => void
      const released = new Promise<void>((resolve) => { releaseWriter = resolve })
      const { a, b, manager, credentialsB } = await sharedManagerRegistryPair({
        optionsA: {
          afterCredentialConnectWrite: async () => {
            writeStarted()
            await released
          }
        },
        optionsB: { isProcessAlive: () => false }
      })
      const connecting = a.connect(deepseekConnection())
      await started
      const reservedRef = manager.registryDocument().credentialTransactions.deepseek!.nextCredentialRef!
      await expect(credentialsB.get(reservedRef)).resolves.toEqual({ apiKey: 'original-secret' })

      await b.initialize()
      expect(manager.registryDocument().credentialTransactions.deepseek).toBeUndefined()
      await expect(credentialsB.get(reservedRef)).resolves.toBeNull()
      releaseWriter()
      await expect(connecting).rejects.toBeInstanceOf(ModelConnectionConflictError)
      expect(manager.registryDocument().profiles.deepseek).toBeUndefined()
      expect(manager.registryDocument().credentialRefCleanup).not.toHaveProperty(reservedRef)
    })

  it('fails closed instead of using local Registry RMW outside Manager authority', async () => {
      const managedDataDir = await mkdtemp(join(tmpdir(), 'kun-managed-registry-authority-'))
      const mismatchedDataDir = await mkdtemp(join(tmpdir(), 'kun-mismatched-registry-authority-'))
      roots.push(managedDataDir, mismatchedDataDir)
      installFakeAtomicJsonManager(managedDataDir)
      const credentials = new ExtensionCredentialStore({
        dataDir: mismatchedDataDir,
        profileId: 'test'
      })

      expect(() => new ModelConnectionRegistry({
        dataDir: mismatchedDataDir,
        credentials
      })).toThrow(/outside the configured Manager data directory/)
      await expect(readFile(
        join(mismatchedDataDir, 'model-connections.v2.json'),
        'utf8'
      )).rejects.toMatchObject({ code: 'ENOENT' })
    })
})
