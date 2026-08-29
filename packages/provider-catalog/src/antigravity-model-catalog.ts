export type AntigravityReasoningEffort = 'low' | 'medium' | 'high'

export type AntigravityCatalogModel = {
  id: string
  supportedEfforts: AntigravityReasoningEffort[]
  defaultEffort: AntigravityReasoningEffort
}

export type AntigravityModelCatalog = {
  models: AntigravityCatalogModel[]
}

const MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/iu
const MODEL_ID_MAX_LENGTH = 128
const EFFORT_ORDER: readonly AntigravityReasoningEffort[] = ['low', 'medium', 'high']

/** Parses the bounded, human-readable output of `agy models`. */
export function parseAntigravityModelCatalog(stdout: string): AntigravityModelCatalog {
  const models = new Map<string, Set<AntigravityReasoningEffort>>()
  for (const line of stdout.split(/\r?\n/u)) {
    const [rawModel = ''] = line.trim().split(/\s+/u, 1)
    if (!rawModel || rawModel.length > MODEL_ID_MAX_LENGTH || !MODEL_ID_PATTERN.test(rawModel)) {
      continue
    }
    const effortMatch = rawModel.match(/-(low|medium|high)$/iu)
    const effort = effortMatch?.[1]?.toLowerCase() as AntigravityReasoningEffort | undefined
    const modelId = effort ? rawModel.slice(0, -(effort.length + 1)) : rawModel
    if (!MODEL_ID_PATTERN.test(modelId)) continue
    const efforts = models.get(modelId) ?? new Set<AntigravityReasoningEffort>()
    efforts.add(effort ?? 'medium')
    models.set(modelId, efforts)
  }
  return {
    models: [...models].map(([id, efforts]) => {
      const supportedEfforts = EFFORT_ORDER.filter((effort) => efforts.has(effort))
      return {
        id,
        supportedEfforts,
        defaultEffort: supportedEfforts.includes('medium')
          ? 'medium'
          : supportedEfforts.includes('high') ? 'high' : 'low'
      }
    })
  }
}
