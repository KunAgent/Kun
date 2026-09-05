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
    registryDocument: () => documents.get(join(dataDir, 'model-connections.v1.json'))?.value as {
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
  nowMs?: () => number,
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
    ...(nowMs ? { nowMs } : {}),
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
  it('never exposes a superseded prepared credential to concurrent consumers', async () => {
      const { value, credentials } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'original-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const finalToken = 'credential:11111111-1111-4111-8111-111111111111:2'

      const firstFence = await value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      const firstPrepared = await value.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'first-new-secret',
        operationToken: firstToken
      })
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: ''
      })
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()
      await expect(value.credentialForCompatibility('deepseek')).resolves.toBeNull()
      await expect(value.probe('deepseek')).rejects.toThrow(/replacement is pending/u)
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({ apiKey: '' })

      const originalSet = credentials.set.bind(credentials)
      let commitStarted!: () => void
      const started = new Promise<void>((resolve) => { commitStarted = resolve })
      let releaseCommit!: () => void
      const released = new Promise<void>((resolve) => { releaseCommit = resolve })
      vi.spyOn(credentials, 'set').mockImplementation(async (reference, payload) => {
        if (payload.apiKey === 'first-new-secret') {
          commitStarted()
          await released
        }
        return originalSet(reference, payload)
      })
      const supersededCommit = value.commitPreparedCredential('deepseek', {
        expectedRevision: firstPrepared.revision,
        operationToken: firstToken
      })
      await started

      const finalFence = await value.fenceCredential('deepseek', {
        expectedRevision: (await value.snapshot()).revision,
        operationToken: finalToken
      })
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: ''
      })
      releaseCommit()
      await expect(supersededCommit).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()
      await expect(value.prepareCredential('deepseek', {
        expectedRevision: finalFence.revision,
        credential: 'first-new-secret',
        operationToken: firstToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)

      const finalPrepared = await value.prepareCredential('deepseek', {
        expectedRevision: finalFence.revision,
        credential: 'final-secret',
        operationToken: finalToken
      })
      const committed = await value.commitPreparedCredential('deepseek', {
        expectedRevision: finalPrepared.revision,
        operationToken: finalToken
      })

      expect(committed.revision).toBeGreaterThan(finalPrepared.revision)
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'final-secret'
      })
      await expect(value.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'final-secret' })
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({
        apiKey: 'final-secret'
      })
    })

  it('rolls back a stale credential whose durable write completed before a newer fence', async () => {
      let commitWriteFinished!: () => void
      const commitWritten = new Promise<void>((resolve) => { commitWriteFinished = resolve })
      let releaseCommit!: () => void
      const commitRelease = new Promise<void>((resolve) => { releaseCommit = resolve })
      let delayNextCommit = true
      const afterCredentialCommitWrite = vi.fn(async () => {
        if (!delayNextCommit) return
        delayNextCommit = false
        commitWriteFinished()
        await commitRelease
      })
      const { value } = await registry(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        afterCredentialCommitWrite
      )
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'original-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const finalToken = 'credential:11111111-1111-4111-8111-111111111111:2'
      const firstFence = await value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      const firstPrepared = await value.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'durably-written-stale-secret',
        operationToken: firstToken
      })
      const staleCommit = value.commitPreparedCredential('deepseek', {
        expectedRevision: firstPrepared.revision,
        operationToken: firstToken
      })
      await commitWritten

      await value.fenceCredential('deepseek', {
        expectedRevision: (await value.snapshot()).revision,
        operationToken: finalToken
      })
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()
      releaseCommit()
      await expect(staleCommit).rejects.toBeInstanceOf(ModelConnectionConflictError)
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()

      const rolledBack = await value.snapshot()
      const finalPrepared = await value.prepareCredential('deepseek', {
        expectedRevision: rolledBack.revision,
        credential: 'final-secret',
        operationToken: finalToken
      })
      await value.commitPreparedCredential('deepseek', {
        expectedRevision: finalPrepared.revision,
        operationToken: finalToken
      })

      await expect(value.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'final-secret' })
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'final-secret'
      })
    })

  it('expires an abandoned prepared credential and restores the durable credential', async () => {
      let now = 0
      const { dataDir, value } = await registry(
        undefined,
        undefined,
        undefined,
        undefined,
        60_000,
        () => now
      )
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'durable-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'

      const fenced = await value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })
      await value.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'abandoned-plaintext',
        operationToken
      })
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()
      expect(await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8'))
        .not.toContain('abandoned-plaintext')

      now += 60_000

      await expect(value.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'durable-secret' })
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'durable-secret'
      })
      expect((await value.materialize()).providers.get('deepseek')).toMatchObject({
        apiKey: 'durable-secret'
      })
      await expect(value.commitPreparedCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)
    })

  it('cancels an older expiry when a newer fence takes ownership', async () => {
      let now = 0
      const { value } = await registry(
        undefined,
        undefined,
        undefined,
        undefined,
        60_000,
        () => now
      )
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'durable-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!
      const firstToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const secondToken = 'credential:11111111-1111-4111-8111-111111111111:2'

      const firstFence = await value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })
      await value.prepareCredential('deepseek', {
        expectedRevision: firstFence.revision,
        credential: 'superseded-plaintext',
        operationToken: firstToken
      })
      now += 50_000
      await value.fenceCredential('deepseek', {
        expectedRevision: (await value.snapshot()).revision,
        operationToken: secondToken
      })

      now += 10_000
      await expect(value.resolveApiKey(sourceId)).resolves.toBeNull()
      await expect(value.commitPreparedCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken: firstToken
      })).rejects.toBeInstanceOf(ModelConnectionConflictError)

      now += 50_000
      await expect(value.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'durable-secret' })
    })

  it('cancels the expiry after the matching prepared credential commits', async () => {
      vi.useFakeTimers()
      const { value } = await registry(undefined, undefined, undefined, undefined, 10)
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'durable-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'

      const fenced = await value.fenceCredential('deepseek', {
        expectedRevision: connected.revision,
        operationToken
      })
      const prepared = await value.prepareCredential('deepseek', {
        expectedRevision: fenced.revision,
        credential: 'committed-secret',
        operationToken
      })
      await value.commitPreparedCredential('deepseek', {
        expectedRevision: prepared.revision,
        operationToken
      })
      await vi.advanceTimersByTimeAsync(20)

      await expect(value.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: 'committed-secret' })
    })
})
