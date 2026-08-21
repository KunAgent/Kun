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
  it('reconciles explicit gateway globals even after the registry already exists', async () => {
    const { value } = await registry()
    const connected = await value.connect(deepseekConnection())
    const routePools = [{
      id: 'local-route-1',
      name: 'Local route',
      modelId: 'local-chat',
      enabled: true,
      strategy: 'priority' as const,
      targets: [{ id: 'target-1', providerId: 'deepseek', modelId: 'deepseek-chat', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    }]

    const applied = await value.initialize([], {
      proxy: { enabled: false, url: '' },
      routePools,
      localModelGateway: { enabled: true }
    })

    expect(applied.revision).toBeGreaterThan(connected.revision)
    expect(applied.routePools).toEqual(routePools)
    expect(applied.localModelGateway).toEqual({ enabled: true })
  })

  it.each([
      {
        label: 'an origin root',
        baseUrl: 'https://catalog.example.test',
        endpointFormat: 'chat_completions' as const,
        expectedUrl: 'https://catalog.example.test/v1/models'
      },
      {
        label: 'an existing v1 root',
        baseUrl: 'https://catalog.example.test/v1/',
        endpointFormat: 'responses' as const,
        expectedUrl: 'https://catalog.example.test/v1/models'
      },
      {
        label: 'a versioned chat completions endpoint',
        baseUrl: 'https://catalog.example.test/v2/chat/completions?deployment=blue#fragment',
        endpointFormat: 'chat_completions' as const,
        expectedUrl: 'https://catalog.example.test/v2/models'
      },
      {
        label: 'a prefixed Responses endpoint',
        baseUrl: 'https://catalog.example.test/openai/v1/responses',
        endpointFormat: 'responses' as const,
        expectedUrl: 'https://catalog.example.test/openai/v1/models'
      },
      {
        label: 'a Messages endpoint',
        baseUrl: 'https://catalog.example.test/v1/messages',
        endpointFormat: 'messages' as const,
        expectedUrl: 'https://catalog.example.test/v1/models'
      },
      {
        label: 'a beta inference endpoint',
        baseUrl: 'https://catalog.example.test/beta/responses',
        endpointFormat: 'responses' as const,
        expectedUrl: 'https://catalog.example.test/v1/models'
      }
    ])('derives the provider models URL from $label', async ({
      baseUrl,
      endpointFormat,
      expectedUrl
    }) => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({
          data: [{ id: 'discovered-model' }]
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)
      const { value } = await registry()

      await value.connect({
        expectedRevision: 0,
        id: 'url-probe',
        name: 'URL Probe',
        kind: 'http',
        authType: 'api-key',
        baseUrl,
        endpointFormat,
        credential: 'registry-secret',
        models: ['fallback-model'],
        selectedModel: 'fallback-model',
        probe: true,
        select: false
      })

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(expectedUrl)
    })

  it('returns configured models for a custom full inference endpoint without guessing a models URL', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { value } = await registry()
      await value.connect({
        expectedRevision: 0,
        id: 'custom-full-endpoint',
        name: 'Custom Full Endpoint',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://gateway.example.test/inference/team-a/respond',
        endpointFormat: 'custom_endpoint',
        credential: 'registry-secret',
        models: ['configured-model'],
        selectedModel: 'configured-model',
        probe: false,
        select: false
      })

      await expect(value.probe('custom-full-endpoint')).resolves.toEqual({
        ok: true,
        models: ['configured-model']
      })
      expect(fetchMock).not.toHaveBeenCalled()
      await expect(value.snapshot()).resolves.toMatchObject({
        providers: [expect.objectContaining({
          id: 'custom-full-endpoint',
          models: ['configured-model']
        })]
      })
    })

  it('rejects custom_endpoint probe when no models are configured', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { value } = await registry()
      await value.connect({
        expectedRevision: 0,
        id: 'custom-empty-models',
        name: 'Custom Empty Models',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://gateway.example.test/inference/team-a/respond',
        endpointFormat: 'custom_endpoint',
        credential: 'registry-secret',
        models: [],
        probe: false,
        select: false
      })

      await expect(value.probe('custom-empty-models')).rejects.toThrow(
        'custom_endpoint does not define a models URL'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('probes Codex with configured models without requesting a models URL', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { value } = await registry()
      await value.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'ChatGPT 订阅',
        kind: 'http',
        authType: 'oauth',
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
        endpointFormat: 'custom_endpoint',
        credential: JSON.stringify({
          kind: 'codex-oauth',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 60_000,
          accountId: 'account-1'
        }),
        models: ['gpt-5.5', 'gpt-5.4'],
        selectedModel: 'gpt-5.5',
        probe: false,
        select: false
      })

      await expect(value.probe('codex')).resolves.toEqual({
        ok: true,
        models: ['gpt-5.5', 'gpt-5.4']
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('probes Messages providers with the Registry credential and Anthropic headers', async () => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
        data: [{ id: 'claude-sonnet-4-5' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)
      const { value } = await registry()
      await value.connect({
        expectedRevision: 0,
        id: 'anthropic',
        name: 'Anthropic',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.anthropic.com/v1/messages',
        endpointFormat: 'messages',
        credential: 'registry-secret',
        models: ['claude-fallback'],
        selectedModel: 'claude-fallback',
        probe: false,
        select: true
      })

      await expect(value.probe('anthropic')).resolves.toEqual({
        ok: true,
        models: ['claude-sonnet-4-5', 'claude-fallback']
      })
      expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'registry-secret',
          'anthropic-version': '2023-06-01'
        })
      }))
      expect(JSON.stringify(fetchMock.mock.calls[0]?.[1])).not.toContain('authorization')
    })

  it('resolves a legacy credential source at persisted-provider probe time', async () => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const resolveCredentialSource = vi.fn(async () => ({
        apiKey: 'resolved-latest-secret',
        headers: { 'x-account-id': 'account-1' }
      }))
      const { value } = await registry(undefined, undefined, resolveCredentialSource)
      await value.initialize([{
        expectedRevision: 0,
        id: 'legacy-http',
        name: 'Legacy HTTP',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://example.com/v1',
        endpointFormat: 'responses',
        credentialSourceId: 'settings:provider:legacy-http',
        models: ['model-a'],
        selectedModel: 'model-a',
        probe: false,
        select: true
      }])

      await value.probe('legacy-http')
      expect(resolveCredentialSource).toHaveBeenCalledWith('settings:provider:legacy-http')
      expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer resolved-latest-secret',
          'x-account-id': 'account-1'
        })
      }))
    })

  it('keeps Registry-owned credentials authoritative across legacy seed reconciliation', async () => {
      const { dataDir, value } = await registry()
      const direct = await value.connect({
        expectedRevision: 0,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        credential: 'stale-expanded-access-token',
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        probe: false,
        select: true
      })

      const registrySourceId = (await value.materialize()).providers.get('codex')!.credentialSourceId!
      const sourceId = 'settings:provider:codex'
      const reconciled = await value.initialize([{
        expectedRevision: direct.revision,
        id: 'codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        endpointFormat: 'responses',
        credentialSourceId: sourceId,
        models: ['gpt-5.6-sol'],
        selectedModel: 'gpt-5.6-sol',
        probe: false,
        select: true
      }])

      expect(JSON.stringify(reconciled)).not.toContain(sourceId)
      const stored = await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8')
      expect(stored).not.toContain(sourceId)
      const materialized = await value.materialize()
      expect(materialized.providers.get('codex')).toMatchObject({
        apiKey: 'stale-expanded-access-token',
        credentialSourceId: registrySourceId
      })
    })

  it('does not resurrect a cleared credential from a later settings seed', async () => {
      const { dataDir, value } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        credential: 'old-secret',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      })
      const cleared = await value.clearCredential('deepseek', connected.revision)

      const reconciled = await value.initialize([{
        expectedRevision: cleared.revision,
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

      expect(reconciled.providers[0]).toMatchObject({ configured: false })
      const stored = await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8')
      expect(stored).not.toContain('settings:provider:deepseek')
      expect((await value.materialize()).providers.has('deepseek')).toBe(false)
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: ''
      })
    })

  it('backfills an OpenCode Go numbered account without changing its credential binding', async () => {
    const { dataDir, value } = await registry()
    const connected = await value.connect({
      expectedRevision: 0,
      id: 'opencode-go-2',
      name: 'OpenCode Go 2',
      kind: 'http',
      authType: 'subscription',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      endpointFormat: 'chat_completions',
      credential: 'opencode-second-secret',
      models: ['muse-spark-1.2-contributor'],
      modelCapabilities: {
        'muse-spark-1.2-contributor': {
          id: 'muse-spark-1.2-contributor',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'low', 'medium', 'high', 'max'],
            defaultEffort: 'max',
            requestProtocol: 'thinking-toggle-chat-completions'
          }
        }
      },
      selectedModel: 'muse-spark-1.2-contributor',
      probe: false,
      select: true
    })
    const before = JSON.parse(await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8')) as {
      profiles: Record<string, { credentialRef?: string }>
    }
    const credentialRef = before.profiles['opencode-go-2']?.credentialRef

    const repaired = await value.initialize([{
      expectedRevision: connected.revision,
      id: 'opencode-go-2',
      name: 'OpenCode Go 2',
      presetSource: 'opencode-go',
      presetMode: 'api',
      kind: 'http',
      authType: 'subscription',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      endpointFormat: 'chat_completions',
      models: ['muse-spark-1.2-contributor'],
      selectedModel: 'muse-spark-1.2-contributor',
      probe: false,
      select: false
    }])

    expect(repaired.providers.find((profile) => profile.id === 'opencode-go-2')).toMatchObject({
      accountId: 'account:opencode-go-2',
      presetSource: 'opencode-go',
      presetMode: 'api',
      authType: 'subscription',
      modelCapabilities: {
        'muse-spark-1.2-contributor': {
          reasoning: { requestProtocol: 'none', supportedEfforts: ['auto'] }
        }
      }
    })
    const after = JSON.parse(await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8')) as {
      profiles: Record<string, { credentialRef?: string }>
    }
    expect(after.profiles['opencode-go-2']?.credentialRef).toBe(credentialRef)
    const reapplied = await value.initialize([])
    expect(reapplied.revision).toBe(repaired.revision)
  })

  it('rotates a legacy source to a Registry-owned credential that survives hot apply', async () => {
      const { dataDir, value } = await registry()
      const seed = {
        expectedRevision: 0,
        id: 'deepseek',
        name: 'DeepSeek',
        kind: 'http' as const,
        authType: 'api-key' as const,
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions' as const,
        credentialSourceId: 'settings:provider:deepseek',
        models: ['deepseek-chat'],
        selectedModel: 'deepseek-chat',
        probe: false,
        select: true
      }
      const legacy = await value.initialize([seed])
      const replaced = await value.replaceCredential('deepseek', {
        expectedRevision: legacy.revision,
        credential: 'replacement-secret'
      })
      const final = await value.replaceCredential('deepseek', {
        expectedRevision: replaced.revision,
        credential: 'final-secret'
      })
      const registrySourceId = (await value.materialize()).providers.get('deepseek')!.credentialSourceId!

      const hotApplied = await value.initialize([{ ...seed, expectedRevision: final.revision }])
      const materialized = await value.materialize()
      expect(hotApplied.providers[0]).toMatchObject({ configured: true })
      expect(materialized.providers.get('deepseek')).toMatchObject({
        apiKey: 'final-secret',
        credentialSourceId: registrySourceId
      })
      expect((await value.resolveApiKey(registrySourceId))?.apiKey).toBe('final-secret')
      await expect(value.credentialStateForInternalConsumer('deepseek')).resolves.toEqual({
        authoritative: true,
        apiKey: 'final-secret'
      })
      const stored = await readFile(join(dataDir, 'model-connections.v1.json'), 'utf8')
      expect(stored).not.toContain('settings:provider:deepseek')
      expect(stored).not.toContain('replacement-secret')
      expect(stored).not.toContain('final-secret')
    })
})
