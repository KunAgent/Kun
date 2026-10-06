import {
  MODEL_ROUTE_RULE_EFFORTS,
  type ModelRouteClassifierV1,
  type ModelRouteRuleEffort,
  type ModelRouteRuleV1
} from './app-settings-types'

/** Normalizers for route rules, pinned member effort and the intent classifier. */
export function normalizeRouteEffort(value: unknown): ModelRouteRuleEffort | undefined {
  return typeof value === 'string' && (MODEL_ROUTE_RULE_EFFORTS as readonly string[]).includes(value)
    ? value as ModelRouteRuleEffort : undefined
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, max)
  return text || undefined
}

export function normalizeRouteRules(input: unknown, targetIds: ReadonlySet<string>): ModelRouteRuleV1[] | undefined {
  if (!Array.isArray(input)) return undefined
  const seen = new Set<string>()
  const rules: ModelRouteRuleV1[] = []
  for (const [index, raw] of input.slice(0, 20).entries()) {
    if (!raw || typeof raw !== 'object') continue
    const rule = raw as Partial<ModelRouteRuleV1>
    const id = shortText(rule.id, 64) ?? `rule-${index + 1}`
    const use = shortText(rule.use, 64)
    if (seen.has(id) || !use || !targetIds.has(use)) continue
    seen.add(id)
    const when = (rule.when && typeof rule.when === 'object' ? rule.when : {}) as ModelRouteRuleV1['when']
    const agents = Array.isArray(when.agents)
      ? [...new Set(when.agents.map((agent) => shortText(agent, 64)?.toLowerCase()).filter((agent): agent is string => Boolean(agent)))].slice(0, 20)
      : undefined
    const efforts = Array.isArray(when.efforts)
      ? [...new Set(when.efforts.map(normalizeRouteEffort).filter((effort): effort is ModelRouteRuleEffort => Boolean(effort)))]
      : undefined
    const from = boundedInt(when.hours?.from, 0, 23)
    const to = boundedInt(when.hours?.to, 0, 24)
    const normalized: ModelRouteRuleV1['when'] = {
      ...(agents?.length ? { agents } : {}),
      ...(boundedInt(when.minTokens, 0, 10_000_000) !== undefined ? { minTokens: when.minTokens } : {}),
      ...(boundedInt(when.maxTokens, 0, 10_000_000) !== undefined ? { maxTokens: when.maxTokens } : {}),
      ...(typeof when.images === 'boolean' ? { images: when.images } : {}),
      ...(efforts?.length ? { efforts } : {}),
      ...(from !== undefined && to !== undefined && from !== to ? { hours: { from, to } } : {}),
      ...(shortText(when.contains, 200) ? { contains: shortText(when.contains, 200) } : {}),
      ...(shortText(when.intent, 40) ? { intent: shortText(when.intent, 40) } : {})
    }
    const effort = normalizeRouteEffort(rule.effort)
    rules.push({ id, enabled: rule.enabled !== false, use, ...(effort ? { effort } : {}), when: normalized })
  }
  return rules
}

export function normalizeRouteClassifier(input: unknown): ModelRouteClassifierV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Partial<ModelRouteClassifierV1>
  const providerId = shortText(raw.providerId, 128)
  const modelId = shortText(raw.modelId, 512)
  const intents = Array.isArray(raw.intents)
    ? [...new Set(raw.intents.map((intent) => shortText(intent, 40)).filter((intent): intent is string => Boolean(intent)))].slice(0, 12)
    : []
  return providerId && modelId && intents.length >= 2 ? { providerId, modelId, intents } : undefined
}
