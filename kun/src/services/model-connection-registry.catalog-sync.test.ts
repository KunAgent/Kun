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
  it('does not select CLI-backed providers before external authentication is verified', async () => {
      const { value } = await registry()
      const snapshot = await value.connect({
        expectedRevision: 0,
        id: 'gemini-cli-subscription',
        name: 'Gemini CLI subscription',
        presetSource: 'gemini-cli-subscription',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        probe: false,
        select: true
      })

      expect(snapshot.providers[0]).toMatchObject({
        id: 'gemini-cli-subscription',
        kind: 'gemini-cli-api',
        configured: false
      })
      expect(snapshot.defaultProviderId).toBeUndefined()
      expect((await value.materialize()).selected).toBeUndefined()
    })

  it('migrates the legacy Gemini subscription transport without changing identity or default', async () => {
      const { dataDir, value } = await registry()
      const codex = await value.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'ChatGPT subscription',
        kind: 'agent-sdk',
        authType: 'subscription',
        endpointFormat: 'responses',
        models: ['gpt-5.6-luna'],
        selectedModel: 'gpt-5.6-luna',
        probe: false,
        select: true
      })
      const legacy = await value.connect({
        expectedRevision: codex.revision,
        id: 'gemini-subscription',
        name: 'Gemini subscription',
        presetSource: 'gemini-subscription',
        kind: 'gemini-code-assist',
        authType: 'subscription',
        baseUrl: 'https://cloudcode-pa.googleapis.com',
        endpointFormat: 'custom_endpoint',
        credential: JSON.stringify({
          kind: 'gemini-oauth',
          accessToken: 'gemini-access',
          refreshToken: 'gemini-refresh'
        }),
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        probe: false,
        select: false
      })
      const registryPath = join(dataDir, 'model-connections.v1.json')
      const before = JSON.parse(await readFile(registryPath, 'utf8')) as {
        profiles: Record<string, { credentialRef?: string }>
      }
      const credentialRef = before.profiles['gemini-subscription']?.credentialRef

      const migrated = await value.initialize([{
        expectedRevision: legacy.revision,
        id: 'gemini-subscription',
        name: 'Gemini subscription',
        presetSource: 'gemini-subscription',
        kind: 'antigravity-cli',
        authType: 'subscription',
        endpointFormat: 'chat_completions',
        models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        probe: false,
        select: false
      }])

      expect(migrated).toMatchObject({
        revision: legacy.revision + 2,
        defaultProviderId: 'codex',
        defaultAccountId: 'account:codex',
        defaultModel: 'gpt-5.6-luna'
      })
      expect(migrated.providers.find((profile) => profile.id === 'gemini-subscription')).toMatchObject({
        accountId: 'account:gemini-subscription',
        kind: 'antigravity-cli',
        configured: true,
        models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
        selectedModel: 'gemini-3.1-pro-preview'
      })
      const after = JSON.parse(await readFile(registryPath, 'utf8')) as {
        profiles: Record<string, { credentialRef?: string; baseUrl?: string }>
      }
      expect(after.profiles['gemini-subscription']?.credentialRef).toBe(credentialRef)
      expect(after.profiles['gemini-subscription']?.baseUrl).toBeUndefined()
      const materialized = await value.materialize()
      expect(materialized.providers.get('gemini-subscription')).toMatchObject({
        kind: 'antigravity-cli',
        models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview']
      })

      const reapplied = await value.initialize([{
        expectedRevision: migrated.revision,
        id: 'gemini-subscription',
        name: 'Gemini subscription',
        presetSource: 'gemini-subscription',
        kind: 'antigravity-cli',
        authType: 'subscription',
        endpointFormat: 'chat_completions',
        models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        probe: false,
        select: false
      }])
      expect(reapplied.revision).toBe(migrated.revision)
    })

  it('returns the latest snapshot on optimistic concurrency conflicts', async () => {
      const { value, applied } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        name: 'Custom',
        baseUrl: 'https://example.com/v1',
        credential: 'secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false
      })
      const error = await value.select({
        expectedRevision: 0,
        providerId: 'custom',
        model: 'model-a'
      }).catch((value) => value)
      expect(error).toBeInstanceOf(ModelConnectionConflictError)
      expect((error as ModelConnectionConflictError).snapshot.revision).toBe(connected.revision)
      expect((error as ModelConnectionConflictError).snapshot.providers[0]).toMatchObject({
        credentialStatus: 'ready'
      })
      expect(applied).toContain('custom/model-a')
    })

  it('falls back only to another configured provider when deleting the shared default', async () => {
      const { value } = await registry()
      const unavailable = await value.connect({
        expectedRevision: 0,
        id: 'unconfigured',
        name: 'Needs a key',
        baseUrl: 'https://unconfigured.example/v1',
        models: ['model-u'],
        selectedModel: 'model-u',
        probe: false,
        select: false
      })
      const configured = await value.connect({
        expectedRevision: unavailable.revision,
        id: 'configured',
        name: 'Configured',
        baseUrl: 'https://configured.example/v1',
        credential: 'secret',
        models: ['model-c'],
        selectedModel: 'model-c',
        probe: false,
        select: false
      })
      const selected = await value.connect({
        expectedRevision: configured.revision,
        id: 'selected',
        name: 'Selected',
        baseUrl: 'https://selected.example/v1',
        credential: 'secret',
        models: ['model-s'],
        selectedModel: 'model-s',
        probe: false,
        select: true
      })

      const removed = await value.delete('selected', selected.revision)
      expect(removed).toMatchObject({
        defaultProviderId: 'configured',
        defaultAccountId: 'account:configured',
        defaultModel: 'model-c'
      })
    })

  it('versions shared proxy and model-routing configuration with provider connections', async () => {
      const { value } = await registry()
      const snapshot = await value.updateGlobals({
        expectedRevision: 0,
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
        routePools: [{
          id: 'pool-a', name: 'Pool A', modelId: 'model-a', enabled: true,
          strategy: 'priority',
          targets: [{ id: 'target-a', providerId: 'provider-a', modelId: 'model-a', enabled: true, weight: 1 }],
          failurePolicy: {
            failoverHttpStatusCodes: [429, 500, 502, 503],
            failoverOnNetworkError: true,
            failoverOnTimeout: true,
            failoverOnAuthError: false
          },
          healthPolicy: { failureThreshold: 3, cooldownMs: 30_000, halfOpenMaxAttempts: 1 }
        }],
        localModelGateway: { enabled: true }
      })

      expect(snapshot).toMatchObject({
        revision: 1,
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
        localModelGateway: { enabled: true }
      })
      expect(snapshot.routePools).toHaveLength(1)
    })

  it('pushes the next revision to waiting GUI and TUI clients', async () => {
      const { value } = await registry()
      const abort = new AbortController()
      const waiting = value.waitForRevision(0, abort.signal, 5_000)
      const connected = await value.connect({
        expectedRevision: 0,
        name: 'Event provider',
        baseUrl: 'https://example.com/v1',
        credential: 'secret',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false
      })

      await expect(waiting).resolves.toMatchObject({ revision: connected.revision })
    })

  it('preserves the selected GUI provider while seeding a new registry', async () => {
      const { value } = await registry()
      const snapshot = await value.initialize([
        {
          expectedRevision: 0,
          id: 'deepseek',
          name: 'DeepSeek',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://api.deepseek.com',
          endpointFormat: 'chat_completions',
          credential: 'deepseek-secret',
          models: ['deepseek-chat'],
          selectedModel: 'deepseek-chat',
          probe: false,
          select: false
        },
        {
          expectedRevision: 0,
          id: 'kimi-code',
          name: 'Kimi Code',
          kind: 'http',
          authType: 'subscription',
          baseUrl: 'https://api.kimi.com/coding/v1',
          endpointFormat: 'chat_completions',
          credential: 'kimi-secret',
          models: ['kimi-k2.5'],
          selectedModel: 'kimi-k2.5',
          probe: false,
          select: true
        }
      ])

      expect(snapshot).toMatchObject({
        defaultProviderId: 'kimi-code',
        defaultAccountId: 'account:kimi-code',
        defaultModel: 'kimi-k2.5'
      })
    })

  it('preserves the shared default when a hot-applied catalog carries a stale active model', async () => {
      const { value } = await registry()
      const initial = await value.connect({
        expectedRevision: 0,
        id: 'provider-a',
        name: 'Provider A',
        baseUrl: 'https://provider.example/v1',
        credential: 'secret',
        models: ['model-before', 'model-after'],
        selectedModel: 'model-before',
        probe: false,
        select: true
      })

      const snapshot = await value.initialize([{
        expectedRevision: initial.revision,
        id: 'provider-a',
        name: 'Provider A',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://provider.example/v1',
        endpointFormat: 'chat_completions',
        models: ['model-before', 'model-after'],
        selectedModel: 'model-after',
        probe: false,
        select: true
      }])

      expect(snapshot).toMatchObject({
        defaultProviderId: 'provider-a',
        defaultModel: 'model-before',
        providers: [expect.objectContaining({
          id: 'provider-a',
          selectedModel: 'model-before'
        })]
      })
    })

  it('imports missing GUI providers without letting stale seeds overwrite a Registry catalog', async () => {
      const { value } = await registry()
      const initial = await value.connect({
        expectedRevision: 0,
        id: 'secondary',
        name: 'Secondary',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://secondary.example/v1',
        endpointFormat: 'chat_completions',
        credential: 'secondary-secret',
        models: ['deepseek-v4-pro'],
        selectedModel: 'deepseek-v4-pro',
        probe: false,
        select: true
      })

      const snapshot = await value.initialize([
        {
          expectedRevision: initial.revision,
          id: 'secondary',
          name: 'Secondary',
          kind: 'http',
          authType: 'api-key',
          baseUrl: 'https://secondary.example/v1',
          endpointFormat: 'chat_completions',
          credential: 'secondary-secret',
          models: ['secondary-chat', 'secondary-reasoning'],
          selectedModel: 'secondary-chat',
          probe: false,
          select: false
        },
        {
          expectedRevision: initial.revision,
          id: 'kimi-code',
          name: 'Kimi Code',
          kind: 'http',
          authType: 'subscription',
          baseUrl: 'https://api.kimi.com/coding/v1',
          endpointFormat: 'chat_completions',
          credential: 'kimi-secret',
          models: ['kimi-k2.5', 'kimi-k2-thinking'],
          selectedModel: 'kimi-k2.5',
          probe: false,
          select: false
        }
      ])

      expect(snapshot).toMatchObject({
        defaultProviderId: 'secondary',
        defaultModel: 'deepseek-v4-pro'
      })
      expect(snapshot.providers.find((profile) => profile.id === 'secondary')?.models)
        .toEqual(['deepseek-v4-pro'])
      expect(snapshot.providers.find((profile) => profile.id === 'kimi-code')?.models)
        .toEqual(['kimi-k2.5', 'kimi-k2-thinking'])
    })
})
