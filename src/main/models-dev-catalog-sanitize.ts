import {
  MAX_MODEL_CONTEXT_WINDOW_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS
} from '../shared/app-settings'
import type {
  ModelsDevCatalogMetadataIssue,
  ModelsDevCatalogModel,
  ModelsDevCatalogModality,
  ModelsDevCatalogPricing,
  ModelsDevCatalogSource
} from '../shared/kun-gui-api'

/**
 * Defensive parsing for the models.dev / kun-agent catalog payloads. The
 * remote schema is not guaranteed; every field is bounded before it reaches
 * the renderer or settings.
 */
export type CatalogRoot = Record<string, unknown>

export const MAX_PROVIDER_COUNT = 1_000
export const MAX_MODEL_COUNT = 5_000
export const MAX_MODEL_ID_LENGTH = 512
const MAX_MODEL_NAME_LENGTH = 256
const MAX_MODEL_DESCRIPTION_LENGTH = 2_000

const ALLOWED_MODALITIES = new Set<ModelsDevCatalogModality>([
  'text',
  'audio',
  'image',
  'video',
  'pdf'
])

export function catalogSourceLabel(source: ModelsDevCatalogSource): string {
  return source === 'models.dev' ? 'models.dev' : 'kun-agent.com'
}

export function normalizeCatalogKeys(
  catalog: CatalogRoot,
  aliases: Readonly<Record<string, string>>
): CatalogRoot {
  if (Object.keys(aliases).length === 0) return catalog
  const normalized: CatalogRoot = {}
  for (const [key, provider] of Object.entries(catalog)) {
    const target = aliases[key]?.trim()
    normalized[target && target !== key ? target : key] = provider
  }
  return normalized
}

export function parseCatalog(body: string, source: ModelsDevCatalogSource): CatalogRoot {
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch {
    throw new Error(`${catalogSourceLabel(source)} returned invalid JSON.`)
  }
  if (!isRecord(parsed)) throw new Error(`${catalogSourceLabel(source)} returned an invalid catalog.`)
  const entries = Object.entries(parsed)
  if (entries.length > MAX_PROVIDER_COUNT) {
    throw new Error(
      `${catalogSourceLabel(source)} catalog exceeded the ${MAX_PROVIDER_COUNT} provider limit.`
    )
  }
  return Object.fromEntries(entries)
}

export function sanitizeProvider(
  value: unknown
): { name: string; models: ModelsDevCatalogModel[] } | null {
  if (!isRecord(value) || !isRecord(value.models)) return null
  const rawModels = Object.entries(value.models)
  if (rawModels.length > MAX_MODEL_COUNT) return null
  const models: ModelsDevCatalogModel[] = []
  const seen = new Set<string>()
  for (const [fallbackId, rawModel] of rawModels) {
    const model = sanitizeModel(fallbackId, rawModel)
    if (!model) continue
    const key = model.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    models.push(model)
  }
  return {
    name:
      boundedString(value.name, MAX_MODEL_NAME_LENGTH) ??
      boundedString(value.id, MAX_MODEL_NAME_LENGTH) ??
      '',
    models
  }
}

function sanitizeModel(fallbackId: string, value: unknown): ModelsDevCatalogModel | null {
  if (!isRecord(value)) return null
  const id = (boundedString(value.id, MAX_MODEL_ID_LENGTH)
    ?? boundedString(fallbackId, MAX_MODEL_ID_LENGTH))?.trim()
  if (!id) return null
  const name = boundedString(value.name, MAX_MODEL_NAME_LENGTH)
  const description = boundedString(value.description, MAX_MODEL_DESCRIPTION_LENGTH)
  const modalities = isRecord(value.modalities) ? value.modalities : {}
  const limit = isRecord(value.limit) ? value.limit : {}
  const cost = isRecord(value.cost) ? value.cost : {}
  const free = cost.input === 0 && cost.output === 0
  const pricing = sanitizeCatalogPricing(cost)
  const reasoning = typeof value.reasoning === 'boolean' ? value.reasoning : undefined
  const toolCalling = typeof value.tool_call === 'boolean' ? value.tool_call : undefined
  const metadataIssues: ModelsDevCatalogMetadataIssue[] = []
  const contextWindowTokens = boundedCatalogLimit(
    limit.context,
    'contextWindowTokens',
    MAX_MODEL_CONTEXT_WINDOW_TOKENS,
    metadataIssues
  )
  const maxOutputTokens = boundedCatalogLimit(
    limit.output,
    'maxOutputTokens',
    MAX_MODEL_OUTPUT_TOKENS,
    metadataIssues
  )
  return {
    id,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    inputModalities: sanitizeModalities(modalities.input),
    outputModalities: sanitizeModalities(modalities.output),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(toolCalling !== undefined ? { toolCalling } : {}),
    ...(free ? { free } : {}),
    ...(pricing ? { pricing } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(metadataIssues.length ? { metadataIssues } : {})
  }
}

/**
 * Parses models.dev cost fields (USD per million tokens). Pricing requires a
 * finite non-negative input and output price; cache prices stay optional.
 */
function sanitizeCatalogPricing(
  cost: Record<string, unknown>
): ModelsDevCatalogPricing | undefined {
  const input = nonNegativeFiniteCost(cost.input)
  const output = nonNegativeFiniteCost(cost.output)
  if (input == null || output == null) return undefined
  const cacheRead = nonNegativeFiniteCost(cost.cache_read)
  const cacheWrite = nonNegativeFiniteCost(cost.cache_write)
  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    ...(cacheRead != null ? { cacheReadUsdPerMillion: cacheRead } : {}),
    ...(cacheWrite != null ? { cacheWriteUsdPerMillion: cacheWrite } : {})
  }
}

function nonNegativeFiniteCost(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function sanitizeModalities(value: unknown): ModelsDevCatalogModality[] {
  if (!Array.isArray(value)) return []
  const out: ModelsDevCatalogModality[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const modality = item.trim().toLowerCase() as ModelsDevCatalogModality
    if (ALLOWED_MODALITIES.has(modality) && !out.includes(modality)) out.push(modality)
  }
  return out
}

function boundedCatalogLimit(
  value: unknown,
  field: ModelsDevCatalogMetadataIssue['field'],
  maxAllowed: number,
  issues: ModelsDevCatalogMetadataIssue[]
): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  if (value > 0 && value <= maxAllowed) return value
  issues.push({ field, code: 'out_of_range', rawValue: value, maxAllowed })
  return undefined
}

export function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
