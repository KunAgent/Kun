import { z } from 'zod'

export const MODEL_METADATA_FIELDS = ['inputModalities', 'outputModalities', 'supportsToolCalling', 'parallelTools',
  'streaming', 'reasoning', 'supportsReasoning', 'structuredOutput', 'contextWindowTokens', 'maxInputTokens', 'maxOutputTokens', 'messageParts',
  'serviceTiers', 'endpointFormat', 'pricing', 'conditionalCapabilities'] as const
export const ModelMetadataFactSchema = z.object({
  source: z.enum(['provider', 'adapter', 'catalog', 'user', 'legacy']),
  status: z.enum(['verified', 'declared', 'unknown']),
  observedAt: z.string().datetime().optional(),
  sourceId: z.string().max(512).optional(),
  fieldPath: z.string().max(256).optional(),
  match: z.enum(['exact', 'alias', 'family']).optional(),
  scope: z.string().max(256).optional(),
  stale: z.boolean().optional()
}).strict()
export const ModelMetadataEvidenceSchema = z.partialRecord(z.enum(MODEL_METADATA_FIELDS), ModelMetadataFactSchema).optional()
export type ModelMetadataField = typeof MODEL_METADATA_FIELDS[number]
export type ModelMetadataEvidence = Exclude<z.infer<typeof ModelMetadataEvidenceSchema>, undefined>
export function capabilityFieldKnown(capability: Record<string, unknown>, field: typeof MODEL_METADATA_FIELDS[number]): boolean {
  const evidence = capability.evidence as ModelMetadataEvidence | undefined
  return capability[field] !== undefined && (evidence ? evidence[field]?.status !== undefined && evidence[field]?.status !== 'unknown' : true)
}

/** Missing metadata is unknown. Operational defaults never become evidence of model capability. */
export function metadataEvidence(value: Record<string, unknown>, source: 'provider' | 'adapter' | 'catalog' | 'user' | 'legacy',
  observedAt?: string): ModelMetadataEvidence {
  return Object.fromEntries(MODEL_METADATA_FIELDS.map((field) => [field, {
    source, status: value[field] === undefined ? 'unknown' as const : 'declared' as const,
    ...(observedAt && value[field] !== undefined ? { observedAt } : {})
  }])) as ModelMetadataEvidence
}
