import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelProviderPreset, modelProviderPresetProfile } from '@shared/model-provider-presets'
import type { ModelProviderProbeRequest } from '@shared/kun-gui-api'
import { providerProbePayloadSchema } from '../../../main/ipc/app-ipc-schemas/runtime'
import { discoverProviderModels } from './provider-model-discovery'
import { pendingPublicCatalog } from './provider-model-progressive-import'
import type { ProbeState } from './settings-section-providers-profile'

vi.mock('./settings-section-providers-shared-api', () => ({
  MAX_SHARED_MODEL_CONNECTION_MODELS: 300,
  shouldUseSharedModelConnectionProbe: () => false,
  requestSharedModelConnectionProbeDetails: vi.fn()
}))
vi.mock('./provider-mutation-flush', () => ({ flushProviderMutations: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

describe('quick-add provider discovery through the IPC schema', () => {
  it('imports Magpie models before a shared connection is available', async () => {
    const preset = getModelProviderPreset('magpie')
    if (!preset) throw new Error('Magpie preset is missing')
    const target = modelProviderPresetProfile(preset, 'magpie-kun')
    let states: Record<string, ProbeState> = {}
    // Validate the actual renderer payload just as the main IPC handler does.
    // A permissive bridge mock would hide a rejected endpoints field.
    const probeModelProvider = vi.fn(async (payload: ModelProviderProbeRequest) => {
      providerProbePayloadSchema.parse(payload)
      return { ok: true, latencyMs: 1, modelIds: ['auto/gpt-6.1-sol'] }
    })
    vi.stubGlobal('window', { kunGui: { probeModelProvider } })
    const importPickedModels = vi.fn(async () => 1)

    const result = await discoverProviderModels(target, {
      t: (key) => key,
      sharedConnectionFor: () => undefined,
      fetchModelsDevCatalogFor: async () => pendingPublicCatalog(),
      importPickedModels,
      setProbeStates: (next) => { states = typeof next === 'function' ? next(states) : next }
    })

    expect(states.magpie).toMatchObject({ status: 'ok', total: 1 })
    expect(probeModelProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'magpie', endpoints: target.endpoints
    }))
    expect(importPickedModels).toHaveBeenCalledWith(
      target, expect.objectContaining({ chat: ['auto/gpt-6.1-sol'] }), false, {}, {}
    )
    expect(result).toMatchObject({
      added: 1,
      firstChatModel: 'auto/gpt-6.1-sol',
      mergedProvider: { models: ['auto/gpt-6.1-sol'] }
    })
  })
})
