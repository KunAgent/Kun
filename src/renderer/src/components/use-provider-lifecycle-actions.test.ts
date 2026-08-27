import { describe, expect, it } from 'vitest'
import {
  modelProviderPresetProfile,
  getModelProviderPreset
} from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import { catalogResultForProviderImport } from './use-provider-lifecycle-actions'

const catalog: ModelsDevCatalogResult = {
  status: 'ok',
  providerKey: 'opencode',
  providerName: 'OpenCode Zen',
  matchMode: 'catalog',
  stale: false,
  models: [
    {
      id: 'free-model',
      inputModalities: ['text'],
      outputModalities: ['text'],
      free: true
    },
    {
      id: 'paid-model',
      inputModalities: ['text'],
      outputModalities: ['text']
    }
  ]
}

describe('catalogResultForProviderImport', () => {
  it('keeps only zero-cost OpenCode Zen models for OpenCore Free', () => {
    const provider = modelProviderPresetProfile(getModelProviderPreset('opencode-free')!)

    expect(catalogResultForProviderImport(provider, catalog)).toMatchObject({
      status: 'ok',
      models: [{ id: 'free-model', free: true }]
    })
  })

  it('does not filter other providers', () => {
    const provider = modelProviderPresetProfile(getModelProviderPreset('opencode-go')!)

    expect(catalogResultForProviderImport(provider, catalog)).toMatchObject({
      status: 'ok',
      models: [{ id: 'free-model' }, { id: 'paid-model' }]
    })
  })
})
