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
  it('reconnects an authenticated preset in place and rotates its protected credential', async () => {
      const { dataDir, value } = await registry()
      const first = await value.connectAuthenticated({
        expectedRevision: 0,
        id: 'codex',
        name: 'ChatGPT subscription',
        presetSource: 'codex',
        kind: 'http',
        authType: 'oauth',
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
        endpointFormat: 'custom_endpoint',
        credential: 'first-oauth-secret',
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        select: true
      })
      const originalAccountId = first.providers[0]!.accountId
      const sourceId = (await value.materialize()).providers.get('codex')!.credentialSourceId!

      const second = await value.connectAuthenticated({
        expectedRevision: first.revision,
        id: 'codex',
        name: 'ChatGPT subscription',
        presetSource: 'codex',
        kind: 'http',
        authType: 'oauth',
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
        endpointFormat: 'custom_endpoint',
        credential: 'rotated-oauth-secret',
        models: ['gpt-5.6-sol', 'gpt-5.4'],
        selectedModel: 'gpt-5.6-sol',
        select: true
      })

      expect(second.providers).toHaveLength(1)
      expect(second.providers[0]).toMatchObject({
        id: 'codex',
        accountId: originalAccountId,
        configured: true,
        models: ['gpt-5.6-sol', 'gpt-5.4']
      })
      expect(JSON.stringify(second)).not.toContain('rotated-oauth-secret')
      expect((await value.resolveApiKey(sourceId))?.apiKey).toBe('rotated-oauth-secret')
      const registryDocument = await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')
      expect(registryDocument).not.toContain('first-oauth-secret')
      expect(registryDocument).not.toContain('rotated-oauth-secret')
    })

  it('materializes a verified Gemini CLI subscription with its native route kind', async () => {
      const { value } = await registry()
      const snapshot = await value.connectAuthenticated({
        expectedRevision: 0,
        id: 'gemini-cli-subscription',
        name: 'Gemini CLI subscription',
        presetSource: 'gemini-cli-subscription',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        select: true,
        externalAuthVerified: true
      })

      expect(snapshot.providers[0]).toMatchObject({
        id: 'gemini-cli-subscription',
        kind: 'gemini-cli-api',
        configured: true
      })
      expect((await value.materialize()).providers.get('gemini-cli-subscription')).toMatchObject({
        kind: 'gemini-cli-api',
        models: ['gemini-3.1-pro-preview']
      })
    })

  it('keeps managed non-HTTP subscription material available to its delegated runtime', async () => {
      const { value } = await registry()
      await value.initialize([{
        expectedRevision: 0,
        id: 'claude-subscription',
        name: 'Claude subscription',
        kind: 'agent-sdk',
        authType: 'subscription',
        endpointFormat: 'messages',
        credential: 'claude-setup-token',
        credentialSourceId: 'settings:provider:claude-subscription',
        models: ['claude-opus'],
        selectedModel: 'claude-opus',
        probe: false,
        select: true
      }])

      expect((await value.materialize()).providers.get('claude-subscription')).toMatchObject({
        kind: 'agent-sdk',
        apiKey: 'claude-setup-token',
        credentialSourceId: 'model-connection:claude-subscription'
      })
    })

  it('applies concurrent GUI/TUI revisions to the live runtime in durable order', async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-connections-'))
      roots.push(dataDir)
      const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
      const applied: string[] = []
      let releaseFirst!: () => void
      const firstBlocked = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      let markFirstStarted!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve
      })
      const value = new ModelConnectionRegistry({
        dataDir,
        credentials,
        onChanged: async (connections) => {
          const model = connections.selected?.model
          if (!model) return
          if (model === 'model-a') {
            markFirstStarted()
            await firstBlocked
          }
          applied.push(model)
        }
      })
      await value.initialize()

      const first = value.connect({
        expectedRevision: 0,
        id: 'shared',
        name: 'Shared provider',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://provider.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'secret',
        models: ['model-a', 'model-b'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })
      await firstStarted
      const revisionOne = await value.snapshot()
      const second = value.select({
        expectedRevision: revisionOne.revision,
        providerId: 'shared',
        accountId: 'account:shared',
        model: 'model-b'
      })
      await vi.waitFor(async () => {
        expect((await value.snapshot()).revision).toBe(2)
      })

      releaseFirst()
      await Promise.all([first, second])

      expect(applied).toEqual(['model-a', 'model-b'])
      expect((await value.snapshot()).defaultModel).toBe('model-b')
    })

  it('stores secrets only in protected storage and allocates stable account names', async () => {
      const { dataDir, value } = await registry()
      const first = await value.connect({
        expectedRevision: 0,
        name: 'Kimi Code',
        presetSource: 'kimi-code',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://api.kimi.com/coding/v1',
        endpointFormat: 'chat_completions',
        credential: 'sk-secret-one',
        models: ['kimi-k2.5'],
        selectedModel: 'kimi-k2.5',
        probe: false,
        select: true
      })
      const second = await value.connect({
        expectedRevision: first.revision,
        name: 'Kimi Code',
        presetSource: 'kimi-code',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://api.kimi.com/coding/v1',
        endpointFormat: 'chat_completions',
        credential: 'sk-secret-two',
        models: ['kimi-k2.5'],
        probe: false,
        select: false
      })

      expect(second.providers.map((provider) => provider.id)).toEqual(['kimi-code', 'kimi-code-2'])
      expect(JSON.stringify(second)).not.toContain('sk-secret')
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')).not.toContain('sk-secret')
      expect(await readFile(join(dataDir, 'credentials', 'credentials.enc.json'), 'utf8')).not.toContain('sk-secret')
    })

  it('rejects a provider selection carrying another account identifier', async () => {
      const { value } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'provider-a',
        name: 'Provider A',
        baseUrl: 'https://provider.example/v1',
        credential: 'secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })

      await expect(value.select({
        expectedRevision: connected.revision,
        providerId: 'provider-a',
        accountId: 'account:provider-b',
        model: 'model-a'
      })).rejects.toThrow('account does not belong')
    })

  it('clears a disconnected HTTP credential without deleting the provider catalog', async () => {
      const { value } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://example.test/v1',
        credential: 'secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      })

      const cleared = await value.clearCredential('custom', connected.revision)
      expect(cleared.providers[0]).toMatchObject({
        id: 'custom',
        configured: false,
        models: ['model-a']
      })
      expect(cleared.defaultProviderId).toBeUndefined()
      expect(cleared.defaultModel).toBeUndefined()
      expect((await value.materialize()).providers.has('custom')).toBe(false)
    })

  it('moves the shared default to another connected provider when its credential is cleared', async () => {
      const { value } = await registry()
      const fallback = await value.connect({
        expectedRevision: 0,
        id: 'fallback',
        name: 'Fallback',
        baseUrl: 'https://fallback.example/v1',
        credential: 'fallback-secret',
        models: ['model-f'],
        selectedModel: 'model-f',
        probe: false,
        select: false
      })
      const selected = await value.connect({
        expectedRevision: fallback.revision,
        id: 'selected',
        name: 'Selected',
        baseUrl: 'https://selected.example/v1',
        credential: 'selected-secret',
        models: ['model-s'],
        selectedModel: 'model-s',
        probe: false,
        select: true
      })

      const cleared = await value.clearCredential('selected', selected.revision)
      expect(cleared).toMatchObject({
        defaultProviderId: 'fallback',
        defaultAccountId: 'account:fallback',
        defaultModel: 'model-f'
      })
      expect(cleared.providers.find((provider) => provider.id === 'selected')).toMatchObject({
        configured: false
      })
    })

  it('synchronizes an explicit configured default without changing it during ordinary catalog initialization', async () => {
      const { value, applied } = await registry()
      const first = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        credential: 'deepseek-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const second = await value.connect({
        expectedRevision: first.revision,
        id: 'codex',
        name: 'Codex',
        baseUrl: 'https://example.test/codex',
        credential: 'codex-secret',
        models: ['gpt-next'],
        selectedModel: 'gpt-next',
        probe: false,
        select: false
      })

      const imported = await value.initialize([{
        expectedRevision: second.revision,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://example.test/codex',
        endpointFormat: 'responses',
        models: ['gpt-next'],
        selectedModel: 'gpt-next',
        probe: false,
        select: true
      }])
      expect(imported).toMatchObject({
        defaultProviderId: 'deepseek',
        defaultModel: 'deepseek-chat'
      })

      const synchronized = await value.synchronizeDefaultSelection({
        providerId: 'codex',
        model: 'gpt-next'
      })
      expect(synchronized).toMatchObject({
        revision: imported.revision + 1,
        defaultProviderId: 'codex',
        defaultAccountId: 'account:codex',
        defaultModel: 'gpt-next'
      })
      expect(applied.at(-1)).toBe('codex/gpt-next')
      await expect(value.synchronizeDefaultSelection({
        providerId: 'codex',
        model: 'gpt-next'
      })).resolves.toMatchObject({ revision: synchronized.revision })
    })
})
