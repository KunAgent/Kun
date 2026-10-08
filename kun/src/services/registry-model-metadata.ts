import { providerPresetScopeMatches, resolveProviderCatalogSource } from '@kun/provider-catalog'
import { enforceProviderModelSafety } from './model-capability-limits.js'
import { join } from 'node:path'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { metadataEvidence, MODEL_METADATA_FIELDS } from '../contracts/model-metadata-evidence.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { catalogBinding } from './provider-catalog-operations.js'
import { readModelCatalog } from './model-catalog-store.js'
import { migrateModelMetadata, resolveModelMetadata, withModelObservation } from './model-metadata-resolver.js'
import { RegistryDocumentSchema, emptyDocument, type ModelConnectionRegistry, type RegistryDocument, type StoredProfile } from './model-connection-registry-core.js'

/** Idempotent Manager transaction. Preserve the original version before upgrading facts. */
export async function migrateRegistryModelMetadata(registry: ModelConnectionRegistry): Promise<void> {
  const current = await registry['file'].read(emptyDocument)
  if (current.modelMetadataVersion === 1) return
  const backup = new AtomicJsonFile(join(registry['options'].dataDir, 'model-metadata-v1-backup.json'), RegistryDocumentSchema.parse, false)
  await backup.update(() => current, (previous) => previous)
  await registry['file'].update(emptyDocument, (document) => {
    if (document.modelMetadataVersion === 1) return document
    return { ...document, modelMetadataVersion: 1, profiles: Object.fromEntries(Object.entries(document.profiles).map(([id, profile]) => [id, {
      ...profile, ...(profile.modelCapabilities ? { modelCapabilities: Object.fromEntries(Object.entries(profile.modelCapabilities)
        .map(([model, capability]) => [model, migrateModelMetadata(capability)])) } : {})
    }])) }
  })
}

/** Account observations are derived data; never copy them back into Registry preferences. */
export async function resolveRegistryProfileMetadata(registry: ModelConnectionRegistry, profile: StoredProfile, allowCatalog = true): Promise<StoredProfile> {
  let catalog: Awaited<ReturnType<typeof readModelCatalog>> = null
  let identity: string | undefined
  try {
    if (!allowCatalog) throw new Error('Pending credential change')
    const previous = await readModelCatalog(registry['options'].dataDir, profile.id)
    if (!previous) throw new Error('No account observations yet')
    const bound = await catalogBinding(registry, profile.id)
    identity = bound.identity
    catalog = await readModelCatalog(registry['options'].dataDir, profile.id, identity)
    if (catalog?.identityChanged) catalog = null
  } catch { /* Missing credentials preserve preferences, not account validation. */ }
  const modelCapabilities: Record<string, ModelCapabilityMetadata> = {}
  const modelIds = new Set([...profile.models, ...Object.keys(profile.modelCapabilities ?? {})])
  for (const model of modelIds) {
    const stored = profile.modelCapabilities?.[model] ?? profile.modelCapabilities?.[model.toLowerCase()]
    const derived = registry['options'].modelCapabilities?.(model, profile)
    const live = catalog?.modelProfiles?.[model] ?? catalog?.modelProfiles?.[model.toLowerCase()]
    const publicProfile = catalog?.catalogProfiles?.[model] ?? catalog?.catalogProfiles?.[model.toLowerCase()]
    const knownDerived = derived && MODEL_METADATA_FIELDS.some((field) => derived[field] !== undefined &&
      (!derived.evidence || (derived.evidence[field]?.status && derived.evidence[field]?.status !== 'unknown')))
    if (!stored && !knownDerived && !live && !publicProfile) continue
    let value = migrateModelMetadata(stored ?? {
      id: model, inputModalities: ['text'] as const, outputModalities: ['text'] as const,
      messageParts: ['text'] as const, supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter')
    })
    const hasPreset = Boolean(resolveProviderCatalogSource(profile)) || (profile.presetSource ?? profile.id) === 'deepseek'
    const presetScopeMatches = !hasPreset || providerPresetScopeMatches(profile)
    // A previous runtime projection must not retain facts from another identity.
    value.metadata.observations = value.metadata.observations.map((row) =>
      // Old GUI imports did not bind directory facts to a connection. Preserve
      // them as suggestions; only the identity-bound cache may activate them.
      row.source === 'catalog' && !row.scope ? { ...row, match: 'family' as const } : row
    ).filter((row) => {
      // Runtime projections may round-trip through old GUI writers. Rebuild
      // account sources from the current cache, including successful empties.
      if (row.source === 'provider' || row.id === 'public-catalog' || row.id === 'runtime-adapter') return false
      if (!presetScopeMatches && row.source === 'adapter' && ['preset', 'legacy-adapter'].includes(row.id)) return false
      if (catalog?.catalogProfiles !== undefined && row.source === 'catalog' && (row.match ?? 'exact') === 'exact') return false
      return !row.scope || row.scope === identity
    })
    if (derived) {
      const fallbackState = migrateModelMetadata(derived).metadata
      const cleared = new Set(value.metadata.clearedOverrides ?? [])
      for (const field of Object.keys(fallbackState.overrides) as Array<keyof typeof fallbackState.overrides>) {
        if (cleared.has(field)) { delete fallbackState.overrides[field]; delete fallbackState.overrideEvidence?.[field] }
      }
      value.metadata.overrides = { ...fallbackState.overrides, ...value.metadata.overrides }
      value.metadata.overrideEvidence = { ...fallbackState.overrideEvidence, ...value.metadata.overrideEvidence }
    }
    if (derived) {
      const automatic = { ...derived }
      for (const field of MODEL_METADATA_FIELDS) {
        if (derived.evidence?.[field]?.source === 'user' || derived.evidence?.[field]?.source === 'legacy') delete automatic[field]
      }
      value = withModelObservation(value, { id: 'runtime-adapter', source: 'adapter', values: automatic,
        evidence: derived.evidence ?? metadataEvidence(derived, 'adapter'), match: 'exact' }) as typeof value
    }
    if (live && catalog?.source === 'provider') value = withModelObservation(value, {
      id: 'connection-provider', source: 'provider', values: live, evidence: live.evidence,
      observedAt: catalog.fetchedAt, match: 'exact', scope: identity, stale: catalog.stale
    }) as typeof value
    if (publicProfile) value = withModelObservation(value, {
      id: 'public-catalog', source: 'catalog', values: publicProfile, evidence: publicProfile.evidence,
      observedAt: catalog?.publicCatalogFetchedAt, match: 'exact', scope: identity, stale: catalog?.publicCatalogStale
    }) as typeof value
    modelCapabilities[model] = enforceProviderModelSafety({ ...resolveModelMetadata(value), id: model,
      ...(live?.responsesMode ? { responsesMode: live.responsesMode } : {}) } as ModelCapabilityMetadata, profile)!
  }
  return { ...profile, ...(Object.keys(modelCapabilities).length ? { modelCapabilities } : {}) }
}

export async function resolveRegistryDocumentMetadata(registry: ModelConnectionRegistry, document: RegistryDocument): Promise<RegistryDocument> {
  const profiles: RegistryDocument['profiles'] = {}
  const entries = Object.entries(document.profiles)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
    while (cursor < entries.length) {
      const [id, profile] = entries[cursor++]!
      profiles[id] = await resolveRegistryProfileMetadata(registry, profile, !document.credentialTransactions[id])
    }
  }))
  return { ...document, profiles }
}
