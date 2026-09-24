import type { ModelsDevCatalogModel } from '../shared/kun-gui-api'
import {
  boundedString,
  MAX_MODEL_COUNT,
  MAX_MODEL_ID_LENGTH,
  sanitizeProvider,
  type CatalogRoot
} from './models-dev-catalog-sanitize'

type CursorCatalogFamily = {
  providerKey: string
  pattern: RegExp
}

const CURSOR_CATALOG_FAMILIES: readonly CursorCatalogFamily[] = [
  { providerKey: 'openai', pattern: /^(?:gpt(?:-|$)|chatgpt(?:-|$)|codex(?:-|$)|o[1-9](?:-|$))/i },
  { providerKey: 'anthropic', pattern: /^claude(?:-|$)/i },
  { providerKey: 'google', pattern: /^gemini(?:-|$)/i },
  { providerKey: 'xai', pattern: /^grok(?:-|$)/i },
  { providerKey: 'moonshotai', pattern: /^(?:kimi|moonshot)(?:-|$)/i }
]

/**
 * Generic "completion-only" family rules for providers without a direct
 * catalog mapping (custom/relay endpoints). A model id is matched after
 * stripping any `vendor/` namespace prefix; matched models borrow metadata
 * from the family's catalog provider without adding new models.
 */
const GENERIC_CATALOG_FAMILIES: readonly CursorCatalogFamily[] = [
  ...CURSOR_CATALOG_FAMILIES,
  { providerKey: 'deepseek', pattern: /^deepseek(?:-|$)/i },
  { providerKey: 'zhipuai', pattern: /^glm(?:-|$)/i },
  { providerKey: 'alibaba', pattern: /^qwen(?:-|$)/i },
  { providerKey: 'minimax', pattern: /^minimax(?:-|$)/i },
  { providerKey: 'xiaomi', pattern: /^mimo(?:-|$)/i }
]

function stripVendorNamespace(modelId: string): string {
  const trimmed = modelId.trim()
  const slash = trimmed.indexOf('/')
  return slash > 0 && slash < trimmed.length - 1 ? trimmed.slice(slash + 1) : trimmed
}

function familyProviderModels(
  catalog: CatalogRoot,
  providers: Map<string, Map<string, ModelsDevCatalogModel>>,
  providerKey: string
): Map<string, ModelsDevCatalogModel> | null {
  let providerModels = providers.get(providerKey)
  if (providerModels) return providerModels
  const provider = sanitizeProvider(catalog[providerKey])
  if (!provider) return null
  providerModels = new Map(
    provider.models.map((model) => [model.id.trim().toLowerCase(), model] as const)
  )
  providers.set(providerKey, providerModels)
  return providerModels
}

function resolveCatalogModel(
  providerModels: Map<string, ModelsDevCatalogModel>,
  hint: { id: string; aliases?: readonly string[] },
  candidateIds: readonly string[]
): ModelsDevCatalogModel | null {
  const normalized = candidateIds
    .map((candidate) => boundedString(candidate, MAX_MODEL_ID_LENGTH)?.trim())
    .filter((candidate): candidate is string => Boolean(candidate))
  return (
    normalized
      .map((candidate) => providerModels.get(candidate.toLowerCase()))
      .find((candidate): candidate is ModelsDevCatalogModel => Boolean(candidate)) ?? null
  )
}

export function resolveCursorModelsDevCatalog(
  catalog: CatalogRoot,
  hints: readonly { id: string; aliases?: readonly string[] }[]
): ModelsDevCatalogModel[] {
  const providers = new Map<string, Map<string, ModelsDevCatalogModel>>()
  const resolved: ModelsDevCatalogModel[] = []
  const seen = new Set<string>()

  for (const hint of hints.slice(0, MAX_MODEL_COUNT)) {
    const id = boundedString(hint.id, MAX_MODEL_ID_LENGTH)?.trim()
    const key = id?.toLowerCase() ?? ''
    if (!id || !key || seen.has(key)) continue
    seen.add(key)

    const family = CURSOR_CATALOG_FAMILIES.find((candidate) => candidate.pattern.test(id))
      ?? GENERIC_CATALOG_FAMILIES.find((candidate) => candidate.pattern.test(stripVendorNamespace(id)))
    if (!family) continue
    const providerModels = familyProviderModels(catalog, providers, family.providerKey)
    if (!providerModels) continue

    const catalogModel = resolveCatalogModel(providerModels, hint, [id, ...(hint.aliases ?? [])])
    if (!catalogModel) continue
    resolved.push({
      ...catalogModel,
      id,
      providerKey: family.providerKey
    })
  }

  return resolved
}

/**
 * Completion-only metadata enrichment for unmapped providers: resolves each
 * hinted model id (after stripping `vendor/` prefixes) against its family's
 * catalog provider. Models that match nothing are returned bare so the
 * caller still sees the full hint list — only metadata is added.
 */
export function resolveFamilyModelsDevCatalog(
  catalog: CatalogRoot,
  hints: readonly { id: string; aliases?: readonly string[] }[]
): ModelsDevCatalogModel[] {
  const providers = new Map<string, Map<string, ModelsDevCatalogModel>>()
  const resolved: ModelsDevCatalogModel[] = []
  const seen = new Set<string>()
  for (const hint of hints.slice(0, MAX_MODEL_COUNT)) {
    const id = boundedString(hint.id, MAX_MODEL_ID_LENGTH)?.trim()
    const key = id?.toLowerCase() ?? ''
    if (!id || !key || seen.has(key)) continue
    seen.add(key)
    const stripped = stripVendorNamespace(id)
    const family = GENERIC_CATALOG_FAMILIES.find((candidate) =>
      candidate.pattern.test(id) || candidate.pattern.test(stripped))
    if (!family) {
      resolved.push({ id, providerKey: '', inputModalities: ['text'], outputModalities: ['text'] })
      continue
    }
    const providerModels = familyProviderModels(catalog, providers, family.providerKey)
    const catalogModel = providerModels
      ? resolveCatalogModel(providerModels, hint, [stripped, id, ...(hint.aliases ?? [])])
      : null
    if (!catalogModel) {
      resolved.push({ id, providerKey: family.providerKey, inputModalities: ['text'], outputModalities: ['text'] })
      continue
    }
    resolved.push({ ...catalogModel, id, providerKey: family.providerKey })
  }
  return resolved
}
