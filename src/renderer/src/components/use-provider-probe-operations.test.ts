import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderProfileV1 } from '@shared/app-settings'

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
  let runProbe: (provider: ModelProviderProfileV1, mode: 'test' | 'fetch') => Promise<void>

  beforeEach(async () => {
    vi.clearAllMocks()
    probeMock.mockResolvedValue(['deepseek-chat'])
    flushMock.mockResolvedValue({ ok: true })
    setProbeStates = vi.fn()
    const scope = {
      t: (key: string) => key,
      setProbeStates,
      setCursorAccounts: vi.fn(),
      sharedConnectionFor: () => ({ configured: true, credentialStatus: 'valid' }),
      patchProviderProfile: vi.fn(),
      fetchModelsDevCatalogFor: vi.fn(async () => ({ models: [] })),
      openModelImport: vi.fn(),
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
