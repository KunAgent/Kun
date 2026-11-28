import { configuredModelMetadata, migrateModelMetadata, type MetadataProfile } from '../services/model-metadata-resolver.js'
import { MODEL_METADATA_FIELDS } from '../contracts/model-metadata-evidence.js'

const key = (id: string) => id.trim().toLowerCase()
const nonMetadataSettings = ['wireModelId', 'responsesMode', 'softRatio', 'hardRatio', 'softThreshold', 'hardThreshold']

/** Selection owns generated metadata, not the user's provider-wide or CLI preferences. */
export function selectGuiModelProfiles<T>(
  profiles: Record<string, T>, models: readonly string[]
): Record<string, T> {
  const active = new Set(models.map(key))
  return Object.fromEntries(Object.entries(profiles).filter(([id, profile]) => {
    if (id === '*' || active.has(key(id)) || !profile || typeof profile !== 'object') return true
    const state = migrateModelMetadata(profile).metadata
    // Unattributed legacy fields are migrated as overrides. In particular, never
    // infer that a hand-authored CLI profile is disposable from its name or shape.
    return Object.keys(state.overrides).length > 0 || Boolean(state.clearedOverrides?.length) ||
      state.observations.length === 0 || nonMetadataSettings.some(field => Object.hasOwn(profile, field)) ||
      Object.keys((profile as { contextCompaction?: object }).contextCompaction ?? {}).length > 0
  }))
}

/** Explicit field-level preferences outrank regenerated facts; a GUI clear also wins. */
export function mergeGuiProfilePreferences<T extends MetadataProfile>(existing: unknown, next: T): T {
  if (!existing || typeof existing !== 'object' || !('metadata' in existing)) return next
  const previous = migrateModelMetadata(existing).metadata
  const state = migrateModelMetadata(next).metadata
  const keep = MODEL_METADATA_FIELDS.filter(field => Object.hasOwn(previous.overrides, field) &&
    previous.overrideEvidence?.[field]?.source === 'user' && state.overrideEvidence?.[field]?.source !== 'user' &&
    !state.clearedOverrides?.includes(field))
  if (keep.length === 0) return next
  return configuredModelMetadata({ ...next, metadata: { ...state,
    overrides: { ...state.overrides, ...Object.fromEntries(keep.map(field => [field, previous.overrides[field]])) },
    overrideEvidence: { ...state.overrideEvidence, ...Object.fromEntries(keep.map(field => [field, previous.overrideEvidence?.[field]])) }
  } })
}
