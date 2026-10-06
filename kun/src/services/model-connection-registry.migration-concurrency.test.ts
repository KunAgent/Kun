import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('does not commit a custom provider when model discovery fails and can explicitly use supplied models', async () => {
      const { dataDir, value } = await registry()
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }))
      try {
        await expect(value.connect({
          expectedRevision: 0,
          id: 'company-proxy',
          name: 'Company Proxy',
          baseUrl: 'https://models.company.test/v1',
          endpointFormat: 'responses',
          credential: 'probe-secret',
          models: ['company-model'],
          selectedModel: 'company-model',
          probe: true,
          select: true
        })).rejects.toThrow('provider probe failed with HTTP 404')

        const failed = await value.snapshot()
        expect(failed).toMatchObject({ revision: 0, providers: [] })
        expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8').catch(() => ''))
          .not.toContain('company-proxy')

        const connected = await value.connect({
          expectedRevision: failed.revision,
          id: 'company-proxy',
          name: 'Company Proxy',
          baseUrl: 'https://models.company.test/v1',
          endpointFormat: 'responses',
          credential: 'probe-secret',
          models: ['company-model'],
          selectedModel: 'company-model',
          probe: false,
          select: true
        })
        expect(connected).toMatchObject({
          revision: 2,
          defaultProviderId: 'company-proxy',
          defaultModel: 'company-model'
        })
        expect(JSON.stringify(connected)).not.toContain('probe-secret')
        expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')).not.toContain('probe-secret')
      } finally {
        fetchMock.mockRestore()
      }
    })

  it('projects secret-free per-model capabilities without persisting derived metadata', async () => {
      const { dataDir, value } = await registry((model) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text'],
        reasoning: {
          supportedEfforts: ['off', 'low', 'high'],
          defaultEffort: 'high',
          requestProtocol: 'deepseek-chat-completions'
        }
      }))
      const snapshot = await value.connect({
        expectedRevision: 0,
        name: 'Reasoning provider',
        baseUrl: 'https://example.com/v1',
        credential: 'secret',
        models: ['reasoning-model'],
        selectedModel: 'reasoning-model',
        probe: false
      })

      expect(snapshot.providers[0]?.modelCapabilities?.['reasoning-model']?.reasoning).toMatchObject({
        supportedEfforts: ['off', 'low', 'high'], defaultEffort: 'high'
      })
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')).not.toContain('modelCapabilities')
    })

  it('persists provider-authored secret-free capabilities and keeps them authoritative', async () => {
      const { dataDir, value } = await registry(() => ({
        id: 'reasoning-model',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text'],
        reasoning: {
          supportedEfforts: ['high'],
          defaultEffort: 'high',
          requestProtocol: 'none'
        }
      }))
      const snapshot = await value.connect({
        expectedRevision: 0,
        name: 'GUI-configured provider',
        baseUrl: 'https://example.com/v1',
        credential: 'secret',
        models: ['reasoning-model'],
        modelCapabilities: {
          'reasoning-model': {
            id: 'reasoning-model',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            reasoning: {
              supportedEfforts: ['low', 'medium', 'high'],
              defaultEffort: 'medium',
              requestProtocol: 'openai-responses'
            }
          }
        },
        selectedModel: 'reasoning-model',
        probe: false
      })

      expect(snapshot.providers[0]?.modelCapabilities?.['reasoning-model']?.reasoning).toEqual({
        supportedEfforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        requestProtocol: 'openai-responses'
      })
      const stored = await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')
      expect(stored).toContain('"modelCapabilities"')
      expect(stored).not.toContain('secret')
      const materialized = await value.materialize()
      expect(materialized.selected?.config).toMatchObject({
        models: ['reasoning-model'],
        selectedModel: 'reasoning-model',
        modelCapabilities: {
          'reasoning-model': {
            reasoning: {
              supportedEfforts: ['low', 'medium', 'high'],
              requestProtocol: 'openai-responses'
            }
          }
        }
      })
    })

  it('repairs historical out-of-range model limits once without changing provider identity or selection', async () => {
      const { dataDir, value, credentials } = await registry()
      const connected = await value.connect({
        expectedRevision: 0,
        id: 'zenmux',
        name: 'ZenMux',
        baseUrl: 'https://zenmux.ai/api/v1',
        credential: 'secret',
        models: ['qwen/qwen3.5-flash'],
        modelCapabilities: {
          'qwen/qwen3.5-flash': {
            id: 'qwen/qwen3.5-flash',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            contextWindowTokens: 1_020_000,
            maxOutputTokens: 1_000_000,
            messageParts: ['text', 'image_url']
          }
        },
        selectedModel: 'qwen/qwen3.5-flash',
        probe: false,
        select: true
      })
      const registryPath = join(dataDir, 'model-connections.v2.json')
      const historical = JSON.parse(await readFile(registryPath, 'utf8')) as {
        revision: number
        profiles: Record<string, {
          credentialRef?: string
          modelCapabilities?: Record<string, { maxOutputTokens?: number }>
        }>
      }
      const credentialRef = historical.profiles.zenmux?.credentialRef
      historical.profiles.zenmux!.modelCapabilities!['qwen/qwen3.5-flash']!.maxOutputTokens = 1_020_000
      await writeFile(registryPath, `${JSON.stringify(historical, null, 2)}\n`)

      const restarted = new ModelConnectionRegistry({
        dataDir,
        credentials,
        inspectCredentialSource: async () => 'ready'
      })
      const repaired = await restarted.initialize()
      expect(repaired.revision).toBe(connected.revision + 1)
      expect(repaired.defaultProviderId).toBe('zenmux')
      expect(repaired.defaultModel).toBe('qwen/qwen3.5-flash')
      expect(repaired.providers[0]?.models).toEqual(['qwen/qwen3.5-flash'])
      expect(repaired.providers[0]?.modelCapabilities?.['qwen/qwen3.5-flash']).toMatchObject({
        contextWindowTokens: 1_020_000,
        inputModalities: ['text', 'image']
      })
      expect(repaired.providers[0]?.modelCapabilities?.['qwen/qwen3.5-flash']?.maxOutputTokens)
        .toBeUndefined()
      const persisted = JSON.parse(await readFile(registryPath, 'utf8')) as typeof historical
      expect(persisted.profiles.zenmux?.credentialRef).toBe(credentialRef)
      expect(persisted.profiles.zenmux?.modelCapabilities?.['qwen/qwen3.5-flash']?.maxOutputTokens)
        .toBeUndefined()

      const repeated = await restarted.initialize()
      expect(repeated.revision).toBe(repaired.revision)
    })

  it('fills missing reasoning from the selected provider without replacing stored model metadata', async () => {
      const { value } = await registry((model, profile) => ({
        id: model,
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text'],
        reasoning: {
          supportedEfforts: profile?.id === 'zenmux' ? ['low', 'medium', 'high'] : ['high'],
          defaultEffort: 'medium',
          requestProtocol: 'openai-chat-completions'
        }
      }))
      const snapshot = await value.connect({
        expectedRevision: 0,
        id: 'zenmux',
        name: 'ZenMux',
        baseUrl: 'https://zenmux.ai/api/v1',
        credential: 'secret',
        models: ['openai/gpt-5.4'],
        modelCapabilities: {
          'openai/gpt-5.4': {
            id: 'openai/gpt-5.4',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        },
        selectedModel: 'openai/gpt-5.4',
        probe: false
      })

      expect(snapshot.providers[0]?.modelCapabilities?.['openai/gpt-5.4']).toMatchObject({
        inputModalities: ['text', 'image'],
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          requestProtocol: 'openai-chat-completions'
        }
      })
    })

  it('preserves Gemini Code Assist transport and protected OAuth material', async () => {
      const { dataDir, value } = await registry()
      const credential = JSON.stringify({
        kind: 'gemini-oauth',
        accessToken: 'gemini-access',
        refreshToken: 'gemini-refresh',
        expiresAt: Date.now() + 60_000,
        projectId: 'project-1',
        userTier: 'standard'
      })
      const snapshot = await value.connect({
        expectedRevision: 0,
        id: 'gemini-subscription',
        name: 'Gemini subscription',
        kind: 'gemini-code-assist',
        authType: 'subscription',
        baseUrl: 'https://cloudcode-pa.googleapis.com',
        endpointFormat: 'custom_endpoint',
        credential,
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview',
        probe: false,
        select: true
      })

      expect(snapshot.providers[0]).toMatchObject({
        id: 'gemini-subscription',
        kind: 'gemini-code-assist',
        configured: true
      })
      expect(JSON.stringify(snapshot)).not.toContain('gemini-access')
      expect(await readFile(join(dataDir, 'model-connections.v2.json'), 'utf8')).not.toContain('gemini-access')
      const materialized = await value.materialize()
      expect(materialized.selected?.config).toMatchObject({
        kind: 'gemini-code-assist',
        apiKey: 'gemini-access',
        geminiAuth: {
          kind: 'gemini-oauth',
          refreshToken: 'gemini-refresh',
          projectId: 'project-1'
        }
      })
    })
})
