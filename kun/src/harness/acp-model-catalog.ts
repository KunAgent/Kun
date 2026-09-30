import type { HarnessModelCatalog, HarnessModelInfo } from '../contracts/harness-models.js'
import type { AcpConfigOption } from '../runtime/acp/acp-schema.js'
import { acpConfigOptionValues } from '../runtime/acp/acp-schema.js'

/** Keep native labels, order and capabilities. Modern selectors are authoritative over legacy aliases. */
export function acpModelCatalog(input: {
  harnessId: string; configOptions?: AcpConfigOption[] | null; models?: unknown; defaultModel?: string
}): HarnessModelCatalog {
  const rows = new Map<string, HarnessModelInfo>()
  let selected: string | undefined
  for (const option of input.configOptions ?? []) {
    if (option.category !== 'model' || option.type !== 'select') continue
    selected = option.currentValue
    const visit = (entries: unknown[]) => {
      for (const raw of entries) {
        if (!raw || typeof raw !== 'object') continue
        const entry = raw as Record<string, unknown>
        if (Array.isArray(entry.options)) { visit(entry.options); continue }
        if (typeof entry.value !== 'string' || !entry.value.trim() || rows.has(entry.value)) continue
        const meta = entry._meta as Record<string, unknown> | undefined
        const images = meta?.['cognition.ai/supportsImages']
        rows.set(entry.value, { id: entry.value,
          ...(typeof entry.name === 'string' ? { displayName: entry.name } : {}),
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          ...(input.harnessId === 'devin' ? { category: entry.value.startsWith('fusion-') ? 'fusion' : 'model' } : {}),
          ...(typeof images === 'boolean' ? { inputModalities: images ? ['text', 'image'] : ['text'] } : {}) })
      }
    }
    visit(option.options)
  }
  if (rows.size === 0 && input.models && typeof input.models === 'object') {
    const legacy = input.models as { currentModelId?: string; availableModels?: { modelId: string; name?: string; description?: string }[] }
    selected = legacy.currentModelId
    for (const entry of Array.isArray(legacy.availableModels) ? legacy.availableModels : []) {
      if (entry && typeof entry.modelId === 'string' && entry.modelId.trim() && !rows.has(entry.modelId)) {
        rows.set(entry.modelId, { id: entry.modelId,
          ...(typeof entry.name === 'string' ? { displayName: entry.name } : {}),
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}) })
      }
    }
  }
  const current = selected ? rows.get(selected) : undefined
  if (current) {
    const thought = input.configOptions?.find((option) => option.category === 'thought_level' && option.type === 'select')
    current.reasoningEfforts = thought?.type === 'select' ? acpConfigOptionValues(thought) : []
    if (thought?.type === 'select') current.defaultReasoningEffort = thought.currentValue
  }
  const defaultRow = rows.get(input.defaultModel ?? selected ?? '')
  if (defaultRow) defaultRow.isDefault = true
  return { models: [...rows.keys()], modelInfo: [...rows.values()] }
}
