import { prepareExplicitProviderRemoval } from './provider-removal-test-helpers.js'
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
  it('does not restore a deleted model from a stale AppSettings seed after restart', async () => {
      const { dataDir, value } = await registry()
      const seed = {
        expectedRevision: 0,
        id: 'catalog-owner',
        name: 'Catalog Owner',
        kind: 'http' as const,
        authType: 'api-key' as const,
        baseUrl: 'https://catalog.example/v1',
        endpointFormat: 'chat_completions' as const,
        credential: 'secret',
        models: ['keep-model', 'delete-model'],
        selectedModel: 'keep-model',
        probe: false,
        select: true
      }
      const connected = await value.connect(seed)
      const patched = await value.patch('catalog-owner', {
        expectedRevision: connected.revision,
        models: ['keep-model'],
        selectedModel: 'keep-model'
      })
      const staleApplied = await value.initialize([{ ...seed, expectedRevision: patched.revision }])
      expect(staleApplied.providers[0]?.models).toEqual(['keep-model'])

      const restarted = new ModelConnectionRegistry({
        dataDir,
        credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' })
      })
      const afterRestart = await restarted.initialize([{ ...seed, expectedRevision: staleApplied.revision }])
      expect(afterRestart.providers[0]?.models).toEqual(['keep-model'])
    })

  it('selects the first remaining model when a catalog removes the active model', async () => {
      const { value } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'catalog-owner',
        name: 'Catalog Owner',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://catalog.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'secret',
        models: ['model-a', 'model-b'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })

      const patched = await value.patch('catalog-owner', {
        expectedRevision: connected.revision,
        models: ['model-b']
      })

      expect(patched.providers[0]).toMatchObject({
        models: ['model-b'],
        selectedModel: 'model-b'
      })
      expect(patched).toMatchObject({
        defaultProviderId: 'catalog-owner',
        defaultAccountId: 'account:catalog-owner',
        defaultModel: 'model-b'
      })
    })

  it('clears the default selection when the active provider loses its last model', async () => {
      const { value } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'catalog-owner',
        name: 'Catalog Owner',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://catalog.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })

      const patched = await value.patch('catalog-owner', {
        expectedRevision: connected.revision,
        models: []
      })

      expect(patched.providers[0]).toMatchObject({ models: [] })
      expect(patched.providers[0]).not.toHaveProperty('selectedModel')
      expect(patched).not.toHaveProperty('defaultProviderId')
      expect(patched).not.toHaveProperty('defaultAccountId')
      expect(patched).not.toHaveProperty('defaultModel')
    })

  it('falls back to another configured provider when the default provider loses its last model', async () => {
      const { value } = await registry()
      const primary = await value.connect({
        expectedRevision: 0,
        id: 'primary',
        name: 'Primary',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://primary.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'primary-secret',
        models: ['primary-model'],
        selectedModel: 'primary-model',
        probe: false,
        select: true
      })
      const withFallback = await value.connect({
        expectedRevision: primary.revision,
        id: 'fallback',
        name: 'Fallback',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://fallback.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'fallback-secret',
        models: ['fallback-model'],
        selectedModel: 'fallback-model',
        probe: false,
        select: false
      })

      const patched = await value.patch('primary', {
        expectedRevision: withFallback.revision,
        models: []
      })

      expect(patched.providers.find((provider) => provider.id === 'primary'))
        .not.toHaveProperty('selectedModel')
      expect(patched).toMatchObject({
        defaultProviderId: 'fallback',
        defaultAccountId: 'account:fallback',
        defaultModel: 'fallback-model'
      })
    })

  it('retries deleted-provider legacy source retirement without allowing seed resurrection', async () => {
      let attempts = 0
      const retired: string[] = []
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { dataDir, value } = await registry(undefined, async (sourceId) => {
        attempts += 1
        if (attempts === 1) throw new Error('temporary cleanup outage')
        retired.push(sourceId)
      })
      const seed = {
        expectedRevision: 0,
        id: 'legacy-delete',
        name: 'Legacy Delete',
        kind: 'http' as const,
        authType: 'api-key' as const,
        baseUrl: 'https://legacy-delete.example/v1',
        endpointFormat: 'chat_completions' as const,
        credentialSourceId: 'settings:provider:legacy-delete',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      }
      const connected = await value.initialize([seed])
      const deletionReady = await prepareExplicitProviderRemoval(value, 'legacy-delete', connected.revision)
      const deleted = await value.delete('legacy-delete', deletionReady.revision)
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8'))
        .toContain('settings:provider:legacy-delete')

      const restarted = await value.initialize([{ ...seed, expectedRevision: deleted.revision }])
      expect(restarted.providers).toEqual([])
      expect(retired).toEqual(['settings:provider:legacy-delete'])
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8'))
        .not.toContain('settings:provider:legacy-delete')
      warn.mockRestore()
    })

  it('refreshes Registry-owned Codex OAuth credentials through their protected source', async () => {
      const { value } = await registry()
      const credentials = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'expired-access',
        refreshToken: 'refresh-one',
        expiresAt: 1,
        accountId: 'account-one'
      })
      await value.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        credential: credentials,
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        probe: false,
        select: true
      })
      const config = (await value.materialize()).providers.get('codex')
      expect(config?.credentialSourceId).toSatisfy(isModelConnectionCredentialSourceId)
      expect(config?.apiKey).toBe('expired-access')

      let refreshOrdinal = 0
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        refreshOrdinal += 1
        return new Response(JSON.stringify({
          access_token: `rotated-access-${refreshOrdinal}`,
          refresh_token: `refresh-${refreshOrdinal + 1}`,
          expires_in: 3600
        }), { status: 200 })
      })
      const refresher = new CodexOAuthCredentialRefresher(value, {
        fetchImpl,
        nowMs: () => 10_000
      })
      const resolved = await refresher.resolve(config!.credentialSourceId!)
      expect(resolved.refreshable).toBe(true)
      expect(JSON.parse(resolved.rawApiKey)).toMatchObject({
        accessToken: 'rotated-access-1',
        refreshToken: 'refresh-2'
      })
      const afterRejectedBearer = await refresher.resolve(
        config!.credentialSourceId!,
        'rotated-access-1'
      )
      expect(JSON.parse(afterRejectedBearer.rawApiKey)).toMatchObject({
        accessToken: 'rotated-access-2',
        refreshToken: 'refresh-3'
      })
      expect(JSON.parse((await value.resolveApiKey(config!.credentialSourceId!))!.apiKey))
        .toMatchObject({ accessToken: 'rotated-access-2' })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

  it('does not let a late OAuth refresh overwrite a newer Registry credential', async () => {
      const { value } = await registry()
      const oldCredential = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'expired-access',
        refreshToken: 'old-refresh',
        expiresAt: 1,
        accountId: 'old-account'
      })
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        credential: oldCredential,
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        probe: false,
        select: true
      })
      const sourceId = (await value.materialize()).providers.get('codex')!.credentialSourceId!
      let signalFetchStarted!: () => void
      const fetchStarted = new Promise<void>((resolve) => { signalFetchStarted = resolve })
      let releaseFetch!: () => void
      const fetchReleased = new Promise<void>((resolve) => { releaseFetch = resolve })
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        signalFetchStarted()
        await fetchReleased
        return Response.json({
          access_token: 'late-old-account-access',
          refresh_token: 'late-old-account-refresh',
          expires_in: 3600
        })
      })
      const refresher = new CodexOAuthCredentialRefresher(value, {
        fetchImpl,
        nowMs: () => 10_000
      })

      const pendingRefresh = refresher.resolve(sourceId)
      await fetchStarted
      const replacement = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'new-account-access',
        refreshToken: 'new-account-refresh',
        expiresAt: 9_999_999,
        accountId: 'new-account'
      })
      await value.replaceCredential('codex', {
        expectedRevision: connected.revision,
        credential: replacement
      })
      releaseFetch()

      await expect(pendingRefresh).resolves.toEqual({
        rawApiKey: replacement,
        refreshable: true
      })
      expect((await value.resolveApiKey(sourceId))?.apiKey).toBe(replacement)
    })

  it('makes a delayed OAuth refresh conflict with a newer durable user generation', async () => {
      const { a, b } = await sharedManagerRegistryPair()
      const oldCredential = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'expired-access',
        refreshToken: 'old-refresh',
        expiresAt: 1,
        accountId: 'old-account'
      })
      const connected = await a.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        credential: oldCredential,
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        probe: false,
        select: true
      })
      const sourceId = (await a.materialize()).providers.get('codex')!.credentialSourceId!
      let refreshStarted!: () => void
      const started = new Promise<void>((resolve) => { refreshStarted = resolve })
      let releaseRefresh!: () => void
      const released = new Promise<void>((resolve) => { releaseRefresh = resolve })
      const refresher = new CodexOAuthCredentialRefresher(a, {
        nowMs: () => 10_000,
        fetchImpl: async () => {
          refreshStarted()
          await released
          return Response.json({
            access_token: 'late-access',
            refresh_token: 'late-refresh',
            expires_in: 3_600
          })
        }
      })
      const lateRefresh = refresher.resolve(sourceId)
      await started

      const replacement = JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: 9_999_999,
        accountId: 'new-account'
      })
      const operationToken = 'credential:11111111-1111-4111-8111-111111111111:1'
      const fenced = await b.fenceCredential('codex', {
        expectedRevision: connected.revision,
        operationToken
      })
      const prepared = await b.prepareCredential('codex', {
        expectedRevision: fenced.revision,
        credential: replacement,
        operationToken
      })
      await b.commitPreparedCredential('codex', {
        expectedRevision: prepared.revision,
        operationToken
      })
      releaseRefresh()

      await expect(lateRefresh).resolves.toEqual({ rawApiKey: replacement, refreshable: true })
      await expect(a.resolveApiKey(sourceId)).resolves.toEqual({ apiKey: replacement })
    })

  it('keeps direct Registry API keys request-resolvable but non-refreshable', async () => {
      const { value } = await registry()
      await value.connect({
        expectedRevision: 0,
        id: 'custom',
        name: 'Custom',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://example.test/v1',
        endpointFormat: 'chat_completions',
        credential: 'plain-secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })
      const config = (await value.materialize()).providers.get('custom')
      const fetchImpl = vi.fn<typeof fetch>()
      const refresher = new CodexOAuthCredentialRefresher(value, { fetchImpl })

      await expect(refresher.resolve(config!.credentialSourceId!)).resolves.toEqual({
        rawApiKey: 'plain-secret',
        refreshable: false
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    })
})
