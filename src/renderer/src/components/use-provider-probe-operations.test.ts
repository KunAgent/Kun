import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderModelProfileV1, ModelProviderProfileV1 } from '@shared/app-settings'

const probeMock = vi.fn<(providerId: string) => Promise<string[]>>()
const flushMock = vi.fn<
  (request: { providerIds: string[]; mutationKinds: string[] }) =>
    Promise<{ ok: true } | { ok: false; error: unknown; timedOut: boolean }>
>()

vi.mock('./settings-section-providers-shared-api', () => ({
  MAX_SHARED_MODEL_CONNECTION_MODELS: 300,
  requestSharedModelConnectionProbe: (providerId: string) => probeMock(providerId),
  shouldUseSharedModelConnectionProbe: () => true
}))
vi.mock('./provider-mutation-flush', () => ({
  flushProviderMutations: (request: { providerIds: string[]; mutationKinds: string[] }) =>
    flushMock(request)
}))
vi.mock('./settings-section-providers-profile', () => ({
  providerConnectionFingerprint: (provider: ModelProviderProfileV1) => `${provider.id}:${provider.baseUrl}`,
  isCursorSubscriptionProvider: () => false,
  isGeminiSubscriptionProvider: () => false,
  isGeminiCliApiSubscriptionProvider: () => false,
  isAgentSdkProvider: () => false,
  CURSOR_SUBSCRIPTION_DISCOVERY_CHANNEL: 'cursor-subscription-discovery',
  addedModelCount: (current: string[], next: string[]) => next.filter((item) => !current.includes(item)).length,
  antigravityProviderCatalogPatch: () => ({ models: [], modelProfiles: {} }),
  cursorSubscriptionDiscoveryErrorMessage: (error: unknown) => String(error),
  defaultImageCapability: () => ({}),
  defaultMusicCapability: () => ({}),
  defaultSpeechCapability: () => ({}),
  defaultTextToSpeechCapability: () => ({}),
  defaultVideoCapability: () => ({}),
  presetImageCapability: () => undefined,
  presetMusicCapability: () => undefined,
  presetSpeechCapability: () => undefined,
  presetTextToSpeechCapability: () => undefined,
  presetVideoCapability: () => undefined
}))

const target = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  models: []
} as unknown as ModelProviderProfileV1

describe('useProviderProbeOperations shared connection barrier', () => {
  let setProbeStates: ReturnType<typeof vi.fn>
  let openModelImport: ReturnType<typeof vi.fn>
  let runProbe: (provider: ModelProviderProfileV1, mode: 'test' | 'fetch') => Promise<void>

  beforeEach(async () => {
    vi.clearAllMocks()
    probeMock.mockResolvedValue(['deepseek-chat'])
    flushMock.mockResolvedValue({ ok: true })
    setProbeStates = vi.fn()
    openModelImport = vi.fn()
    const scope = {
      t: (key: string) => key,
      setProbeStates,
      setCursorAccounts: vi.fn(),
      sharedConnectionFor: () => ({ configured: true, credentialStatus: 'valid' }),
      patchProviderProfile: vi.fn(),
      fetchModelsDevCatalogFor: vi.fn(async () => ({ models: [] })),
      openModelImport,
      flushSharedProviderCatalog: vi.fn(async () => undefined)
    }
    const { useProviderProbeOperations } = await import('./use-provider-probe-operations')
    const operations = useProviderProbeOperations(scope) as {
      runProbe: (provider: ModelProviderProfileV1, mode: 'test' | 'fetch') => Promise<void>
    }
    runProbe = operations.runProbe
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('runs the provider mutation barrier before the shared connection probe', async () => {
    let releaseBarrier!: () => void
    flushMock.mockReturnValue(
      new Promise((resolve) => { releaseBarrier = () => resolve({ ok: true }) })
    )
    const probing = runProbe(target, 'test')
    await vi.waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    // Barrier still pending: the probe must not fire with the old credential.
    expect(probeMock).not.toHaveBeenCalled()
    releaseBarrier()
    await probing
    expect(probeMock).toHaveBeenCalledTimes(1)
    expect(probeMock).toHaveBeenCalledWith('deepseek')
    expect(flushMock).toHaveBeenCalledWith({
      providerIds: ['deepseek'],
      mutationKinds: ['credential', 'catalog']
    })
  })

  it('waits for the barrier before opening the model import (fetch mode)', async () => {
    let releaseBarrier!: () => void
    flushMock.mockReturnValue(
      new Promise((resolve) => { releaseBarrier = () => resolve({ ok: true }) })
    )
    const scope = { fetchModelsDevCatalogFor: vi.fn(async () => ({ models: [] })) }
    void scope
    const probing = runProbe(target, 'fetch')
    await vi.waitFor(() => expect(flushMock).toHaveBeenCalledTimes(1))
    expect(probeMock).not.toHaveBeenCalled()
    releaseBarrier()
    await probing
    expect(probeMock).toHaveBeenCalledTimes(1)
  })

  it('forwards shared Codex probe IDs to the import dialog without models.dev metadata', async () => {
    probeMock.mockResolvedValue(['gpt-6-sol', 'gpt-6-luna'])
    await runProbe({ ...target, id: 'codex' }, 'fetch')
    expect(openModelImport).toHaveBeenCalledWith(expect.objectContaining({
      authoritative: true,
      providerModelIds: ['gpt-6-sol', 'gpt-6-luna']
    }))
  })

  it('reports a sync failure instead of probing when the barrier fails', async () => {
    flushMock.mockResolvedValue({ ok: false, error: new Error('registry unavailable'), timedOut: false })
    await runProbe(target, 'test')
    expect(probeMock).not.toHaveBeenCalled()
    const states = setProbeStates.mock.calls.map(
      (call) => typeof call[0] === 'function' ? call[0]({}) : call[0]
    )
    expect(states).toContainEqual(expect.objectContaining({
      deepseek: expect.objectContaining({ status: 'error', message: 'registry unavailable' })
    }))
  })

  it('reports a sync timeout instead of probing when the barrier times out', async () => {
    flushMock.mockResolvedValue({ ok: false, error: new Error('ignored'), timedOut: true })
    await runProbe(target, 'test')
    expect(probeMock).not.toHaveBeenCalled()
    const states = setProbeStates.mock.calls.map(
      (call) => typeof call[0] === 'function' ? call[0]({}) : call[0]
    )
    expect(states).toContainEqual(expect.objectContaining({
      deepseek: expect.objectContaining({
        status: 'error',
        message: expect.stringContaining('timed out')
      })
    }))
  })

  it('does not block the probe when no operations are registered', async () => {
    // flushProviderMutations resolves { ok: true } when nothing is registered;
    // simulated by the resolved default mock in beforeEach.
    await runProbe(target, 'test')
    expect(flushMock).toHaveBeenCalledTimes(1)
    expect(probeMock).toHaveBeenCalledWith('deepseek')
  })
})

it('saves officially discovered gpt-6 models as selectable Codex models', async () => {
  const { applyProviderModelImport } = await import('./use-provider-probe-operations')
  const codex = { ...target, id: 'codex', modelProfiles: {} }
  const saved = applyProviderModelImport(codex, {
    chat: ['gpt-6-sol', 'gpt-6-luna'],
    image: [], speech: [], tts: [], music: [], video: [], catalogModels: []
  }, true)
  expect(saved.models).toEqual(['gpt-6-sol', 'gpt-6-luna'])
})

describe('mergeDiscoveredModelProfile', () => {
  const enriched: ModelProviderModelProfileV1 = {
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    contextWindowTokens: 128_000,
    serviceTiers: ['priority']
  }
  const discovered: ModelProviderModelProfileV1 = {
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text']
  }

  it('replaces the stored tier declaration with the refreshed catalog result', async () => {
    const { mergeDiscoveredModelProfile } = await import('./use-provider-probe-operations')
    expect(mergeDiscoveredModelProfile(enriched, discovered)?.serviceTiers).toBeUndefined()
    expect(mergeDiscoveredModelProfile(enriched, { ...discovered, serviceTiers: [] })?.serviceTiers)
      .toEqual([])
    expect(mergeDiscoveredModelProfile(enriched, { ...discovered, serviceTiers: ['priority'] }))
      .toMatchObject({ contextWindowTokens: 128_000, serviceTiers: ['priority'] })
    expect(mergeDiscoveredModelProfile(enriched, undefined)).toBe(enriched)
  })
})
