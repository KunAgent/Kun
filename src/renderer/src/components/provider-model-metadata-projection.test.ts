import { describe, expect, it } from 'vitest'
import { defaultModelProviderProfile } from '@shared/app-settings-provider-profiles'
import { modelProviderModelProfile } from '@shared/app-settings-provider-core'
import { metadataEvidence } from '../../../../kun/src/contracts/model-metadata-evidence.js'
import { resolveModelMetadata, setModelMetadataOverride, withModelObservation } from '../../../../kun/src/services/model-metadata-resolver.js'
import { sharedModelProfiles } from './settings-section-providers-shared-reconcile'
import { catalogCapabilities, sameCatalogCapabilities } from './settings-section-providers-shared-payloads'
import type { SharedModelConnection } from './settings-section-providers-shared-api'

function snapshot() {
  const blank = { id: 'fixture', inputModalities: ['text'] as ('text' | 'image')[],
    outputModalities: ['text'] as ('text' | 'image')[], messageParts: ['text'] as ('text' | 'image_url')[],
    supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') }
  const configured = setModelMetadataOverride(blank, 'contextWindowTokens', 1_000_000)
  const effective = resolveModelMetadata(withModelObservation(configured, {
    id: 'connection-provider', source: 'provider', scope: 'account-fixture', match: 'exact',
    observedAt: '2026-10-08T00:00:00.000Z', values: { contextWindowTokens: 128_000,
      maxInputTokens: 96_000, maxOutputTokens: 4096, supportsReasoning: false, serviceTiers: [] }
  }))
  return { connection: { id: 'example', name: 'Example', kind: 'http', authType: 'none', accountId: 'account-fixture',
    baseUrl: 'https://example.test/v1', endpointFormat: 'chat_completions', useProxy: false, configured: true,
    models: ['fixture'], modelCapabilities: { fixture: effective } } satisfies SharedModelConnection,
    configured }
}

describe('metadata projection across Registry and settings', () => {
  it('retains user originals, automatic evidence and new fields without turning observations into overrides', () => {
    const { connection } = snapshot()
    const profiles = sharedModelProfiles(connection, undefined)
    expect(profiles.fixture.contextWindowTokens).toBe(1_000_000)
    expect(profiles.fixture.maxInputTokens).toBe(96_000)
    expect(profiles.fixture.serviceTiers).toEqual([])
    expect(profiles.fixture.supportsReasoning).toBe(false)
    expect(profiles.fixture.metadata?.overrides).toEqual({ contextWindowTokens: 1_000_000 })
    expect(profiles.fixture.metadata?.observations[0].scope).toBe('account-fixture')
    const provider = { ...defaultModelProviderProfile('', 'https://example.test/v1'), id: 'example', models: ['fixture'], modelProfiles: profiles }
    expect(modelProviderModelProfile(provider, 'fixture')).toMatchObject({ contextWindowTokens: 128_000, maxInputTokens: 96_000 })
  })
  it('does not patch preferences merely because snapshots contain effective limits or newer observations', () => {
    const { connection } = snapshot()
    const profiles = sharedModelProfiles(connection, undefined)
    expect(sameCatalogCapabilities(connection.modelCapabilities, catalogCapabilities(['fixture'], profiles))).toBe(true)
    const changedFacts = resolveModelMetadata(withModelObservation(connection.modelCapabilities.fixture, {
      id: 'connection-provider', source: 'provider', values: { contextWindowTokens: 256_000, maxInputTokens: 192_000 },
      scope: 'account-fixture', observedAt: '2026-10-09T00:00:00.000Z', match: 'exact'
    }))
    expect(sameCatalogCapabilities({ fixture: changedFacts }, catalogCapabilities(['fixture'], profiles))).toBe(true)
    const edited = setModelMetadataOverride(profiles.fixture, 'maxOutputTokens', 1024)
    expect(sameCatalogCapabilities(connection.modelCapabilities, catalogCapabilities(['fixture'], { fixture: edited }))).toBe(false)
  })
})
