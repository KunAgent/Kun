import {
  ModelCapabilityFactsSchema, ModelMetadataStateSchema, ModelMetadataObservationSchema,
  MAX_MODEL_CONTEXT_WINDOW_TOKENS, MAX_MODEL_OUTPUT_TOKENS,
  type ModelCapabilityFacts, type ModelMetadataState, type ModelMetadataObservation,
  type ModelMetadataResolution
} from '../contracts/capabilities-core.js'
import { MODEL_METADATA_FIELDS, type ModelMetadataEvidence, type ModelMetadataField } from '../contracts/model-metadata-evidence.js'

export type MetadataProfile = ModelCapabilityFacts & {
  evidence?: ModelMetadataEvidence
  metadata?: ModelMetadataState
  metadataResolution?: ModelMetadataResolution
}
const LIMITS = new Set<ModelMetadataField>(['contextWindowTokens', 'maxInputTokens', 'maxOutputTokens'])
const PRIORITY = { provider: 0, adapter: 1, catalog: 2 }
const owns = (value: object, field: string) => Object.prototype.hasOwnProperty.call(value, field)
const knownObservationField = (row: ModelMetadataObservation, field: ModelMetadataField) => owns(row.values, field) &&
  (row.source !== 'catalog' || (row.evidence?.[field]?.match ?? row.match ?? 'exact') === 'exact') &&
  (!row.evidence || row.evidence[field]?.status === 'declared' || row.evidence[field]?.status === 'verified')
const facts = (value: object): ModelCapabilityFacts => {
  const out: Record<string, unknown> = {}
  for (const field of MODEL_METADATA_FIELDS) {
    const parsed = ModelCapabilityFactsSchema.shape[field].safeParse((value as Record<string, unknown>)[field])
    if (!parsed.success || parsed.data === undefined) continue
    const maximum = field === 'maxOutputTokens' ? MAX_MODEL_OUTPUT_TOKENS
      : field === 'contextWindowTokens' || field === 'maxInputTokens' ? MAX_MODEL_CONTEXT_WINDOW_TOKENS : undefined
    if (maximum !== undefined && typeof parsed.data === 'number' && parsed.data > maximum) continue
    out[field] = parsed.data
  }
  return out as ModelCapabilityFacts
}

/** Capture original persisted facts before operational defaults are applied. */
export function migrateModelMetadata<T extends object>(profile: T): T & { metadata: ModelMetadataState } {
  const input = profile as MetadataProfile
  const state = input.metadata
  const candidate = state && typeof state === 'object' && state.overrides && typeof state.overrides === 'object' && Array.isArray(state.observations)
    ? { ...state, overrides: facts(state.overrides), observations: state.observations.map((row) =>
        row && typeof row === 'object' && row.values && typeof row.values === 'object'
          ? { ...row, values: facts(row.values) } : row) } : state
  const parsed = ModelMetadataStateSchema.safeParse(candidate)
  if (parsed.success) return { ...profile, metadata: parsed.data }
  const overrides: Record<string, unknown> = {}, overrideEvidence: ModelMetadataEvidence = {}
  const observations = new Map<string, ModelMetadataObservation>()
  for (const [name, value] of Object.entries(facts(profile))) {
    const field = name as ModelMetadataField, evidence = input.evidence?.[field]
    if (evidence?.status === 'unknown') continue
    if (!evidence || evidence.source === 'user' || evidence.source === 'legacy') {
      overrides[field] = value
      overrideEvidence[field] = evidence ?? { source: 'legacy', status: 'declared' }
    } else {
      const id = evidence.sourceId ?? `legacy-${evidence.source}`
      const observation = observations.get(id) ?? { id, source: evidence.source,
        values: {}, evidence: {}, match: evidence.match ?? 'exact',
        ...(evidence.scope ? { scope: evidence.scope } : {}), ...(evidence.observedAt ? { observedAt: evidence.observedAt } : {}),
        ...(evidence.stale !== undefined ? { stale: evidence.stale } : {}) }
      Object.assign(observation.values, { [field]: value })
      observation.evidence![field] = evidence
      observations.set(id, observation)
    }
  }
  return { ...profile, metadata: { schemaVersion: 1, overrides: overrides as ModelCapabilityFacts,
    overrideEvidence, observations: [...observations.values()] } }
}

/** Resolve observations without changing the user's stored preference. */
export function resolveModelMetadata<T extends object>(profile: T): T & MetadataProfile {
  const migrated = migrateModelMetadata(profile), state = migrated.metadata
  const ranked = state.observations.filter((row) => row.source !== 'catalog' || (row.match ?? 'exact') === 'exact')
    .sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] ||
      (b.observedAt ?? '').localeCompare(a.observedAt ?? '') || a.id.localeCompare(b.id))
  const values: Record<string, unknown> = {}, evidence: ModelMetadataEvidence = {}, resolution: ModelMetadataResolution = {}
  for (const field of MODEL_METADATA_FIELDS) {
    const observation = ranked.find((row) => knownObservationField(row, field) &&
      (field !== 'endpointFormat' || row.source !== 'catalog'))
    const automaticValue = observation?.values[field], configuredValue = state.overrides[field]
    const hasOverride = owns(state.overrides, field)
    let effectiveValue: unknown = hasOverride ? configuredValue : automaticValue
    let reason: ModelMetadataResolution[string]['reason']
    const automaticEvidence = observation ? { source: observation.source, status: 'declared' as const, sourceId: observation.id,
      ...(observation.observedAt ? { observedAt: observation.observedAt } : {}), match: observation.match ?? 'exact',
      ...(observation.scope ? { scope: observation.scope } : {}),
      ...observation.evidence?.[field], ...(observation.stale !== undefined ? { stale: observation.stale } : {}) } : undefined
    let chosenEvidence = hasOverride ? state.overrideEvidence?.[field] ?? { source: 'user' as const, status: 'declared' as const }
      : automaticEvidence
    // Numeric preferences never enlarge a declared capability. A catalog only
    // fills missing facts; a current account's declaration wins over it.
    if (hasOverride && LIMITS.has(field) && typeof automaticValue === 'number' && typeof configuredValue === 'number') {
      effectiveValue = Math.min(configuredValue, automaticValue)
      reason = configuredValue <= automaticValue ? 'user-limit' : 'provider-limit'
      if (configuredValue > automaticValue) chosenEvidence = automaticEvidence
    }
    if (hasOverride && observation?.source === 'provider') {
      if (automaticValue === false && configuredValue === true) { effectiveValue = false; reason = 'unsupported' }
      if (Array.isArray(automaticValue) && Array.isArray(configuredValue)) {
        effectiveValue = configuredValue.filter((item) => (automaticValue as unknown[]).includes(item))
        if (JSON.stringify(effectiveValue) !== JSON.stringify(configuredValue)) reason = 'unsupported'
      }
      if (field === 'reasoning' && automaticValue && configuredValue) {
        const upstream = automaticValue as NonNullable<ModelCapabilityFacts['reasoning']>
        const user = configuredValue as NonNullable<ModelCapabilityFacts['reasoning']>
        const supportedEfforts = user.supportedEfforts.filter((effort) => upstream.supportedEfforts.includes(effort))
        effectiveValue = supportedEfforts.length ? { ...upstream, requestProtocol: user.requestProtocol,
          supportedEfforts, defaultEffort: supportedEfforts.includes(user.defaultEffort) ? user.defaultEffort
            : supportedEfforts.includes(upstream.defaultEffort) ? upstream.defaultEffort : supportedEfforts[0] }
          : upstream
        if (supportedEfforts.length !== user.supportedEfforts.length) reason = 'unsupported'
      }
    }
    if (reason === 'unsupported') chosenEvidence = automaticEvidence
    if (effectiveValue !== undefined) {
      values[field] = effectiveValue
      if (chosenEvidence) evidence[field] = chosenEvidence
      resolution[field] = { ...(automaticValue !== undefined ? { automaticValue } : {}),
        ...(hasOverride ? { configuredValue } : {}), effectiveValue, source: chosenEvidence?.source,
        ...(reason ? { reason } : {}) }
    } else {
      evidence[field] = { source: 'adapter', status: 'unknown' }
      if (state.observations.some((row) => owns(row.values, field))) resolution[field] = { reason: 'suggestion-only' }
    }
  }
  const selectedReasoning = values.reasoning as ModelCapabilityFacts['reasoning']
  if (selectedReasoning && !owns(state.overrides, 'reasoning')) {
    const selectedObservation = ranked.find((row) => knownObservationField(row, 'reasoning'))
    const transport = ranked.find((row) => row.source !== 'catalog' && knownObservationField(row, 'reasoning') &&
      row.values.reasoning?.requestProtocol !== undefined && row.values.reasoning.requestProtocol !== 'none')?.values.reasoning
    if (selectedObservation?.source === 'catalog' || selectedReasoning.requestProtocol === 'none') {
      values.reasoning = { ...selectedReasoning, requestProtocol: transport?.requestProtocol ?? 'none' }
      if (resolution.reasoning) resolution.reasoning.effectiveValue = values.reasoning
    }
  }
  if (values.supportsReasoning === false) {
    delete values.reasoning
    evidence.reasoning = { ...evidence.supportsReasoning! }
    if (state.overrides.reasoning) resolution.reasoning = { configuredValue: state.overrides.reasoning, reason: 'unsupported' }
  }
  if (typeof values.maxInputTokens === 'number' && typeof values.contextWindowTokens === 'number') {
    values.maxInputTokens = Math.min(values.maxInputTokens, values.contextWindowTokens)
    if (resolution.maxInputTokens) resolution.maxInputTokens.effectiveValue = values.maxInputTokens
  }
  const base = { ...profile } as Record<string, unknown>
  for (const field of MODEL_METADATA_FIELDS) delete base[field]
  return { ...base, inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true,
    ...values, evidence, metadata: state, metadataResolution: resolution } as T & MetadataProfile
}

/** Persistence projection: flat legacy fields retain original user values. */
function configuredProjection<T extends object>(profile: T, metadata: ModelMetadataState): T & MetadataProfile {
  const resolved = resolveModelMetadata({ ...profile, metadata })
  const configured = { ...resolved, ...metadata.overrides,
    evidence: { ...resolved.evidence, ...metadata.overrideEvidence } }
  delete configured.metadataResolution
  return configured
}

export function withModelObservation<T extends object>(profile: T, observation: ModelMetadataObservation): T & MetadataProfile {
  const state = migrateModelMetadata(profile).metadata
  const safe = ModelMetadataObservationSchema.parse({ ...observation, values: facts(observation.values) })
  const observations = [...state.observations.filter((row) => row.id !== safe.id), safe].slice(-32)
  return configuredProjection(profile, { ...state, observations })
}

export function setModelMetadataOverride<T extends object>(profile: T, field: ModelMetadataField, value: unknown): T & MetadataProfile {
  const parsed = ModelCapabilityFactsSchema.shape[field].parse(value)
  if (parsed === undefined) return clearModelMetadataOverride(profile, field)
  if (!owns(facts({ [field]: parsed }), field)) throw new RangeError(`Invalid ${field} model capability`)
  const state = migrateModelMetadata(profile).metadata
  return configuredProjection(profile, { ...state, overrides: { ...state.overrides, [field]: parsed },
    ...(state.clearedOverrides ? { clearedOverrides: state.clearedOverrides.filter((value) => value !== field) } : {}),
    overrideEvidence: { ...state.overrideEvidence, [field]: { source: 'user', status: 'declared', observedAt: new Date().toISOString() } } })
}

export function clearModelMetadataOverride<T extends object>(profile: T, field: ModelMetadataField): T & MetadataProfile {
  const state = migrateModelMetadata(profile).metadata
  const overrides = { ...state.overrides }, overrideEvidence = { ...state.overrideEvidence }
  delete overrides[field]; delete overrideEvidence[field]
  return configuredProjection(profile, { ...state, overrides, overrideEvidence,
    clearedOverrides: [...new Set([...(state.clearedOverrides ?? []), field])] })
}

export function adoptModelMetadataSuggestion<T extends object>(profile: T, observationId: string,
  fields: readonly ModelMetadataField[] = MODEL_METADATA_FIELDS): T & MetadataProfile {
  let result: T & MetadataProfile = migrateModelMetadata(profile) as T & MetadataProfile
  const suggestion = result.metadata!.observations.find((row) => row.id === observationId)
  if (!suggestion) return result
  for (const field of fields) {
    if (!owns(suggestion.values, field)) continue
    result = setModelMetadataOverride(result, field, suggestion.values[field])
    result.metadata!.overrideEvidence![field] = { ...result.metadata!.overrideEvidence![field]!, sourceId: suggestion.id,
      match: suggestion.match, ...(suggestion.observedAt ? { observedAt: suggestion.observedAt } : {}) }
  }
  return result
}

/** Convert a Runtime effective view back to the compatible preference projection. */
export function configuredModelMetadata<T extends object>(profile: T): T & MetadataProfile {
  return configuredProjection(profile, migrateModelMetadata(profile).metadata)
}

/** Compare user intent independently from replaceable discovery observations. */
export function modelMetadataPreferences(profile: object): object {
  const state = migrateModelMetadata(profile).metadata
  const record = profile as Record<string, unknown>
  return { id: record.id, wireModelId: record.wireModelId,
    overrides: state.overrides, overrideEvidence: state.overrideEvidence,
    clearedOverrides: [...state.clearedOverrides ?? []].sort() }
}
