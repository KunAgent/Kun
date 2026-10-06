import type { HarnessModelCatalog, HarnessModelInfo } from '../contracts/harness-models.js'
import type { AcpConfigOption } from '../runtime/acp/acp-schema.js'
import { acpConfigOptionValues } from '../runtime/acp/acp-schema.js'

/** Legacy `<model>/<variant>` suffixes that are reasoning levels, in Kun's vocabulary. */
const LEGACY_VARIANT_EFFORTS: Readonly<Record<string, string>> = {
  none: 'off', minimal: 'off', low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max'
}
const KUN_EFFORT_ORDER = ['off', 'low', 'medium', 'high', 'max']

/**
 * OpenCode advertises every reasoning variant as its own legacy model
 * (`openai/gpt-5.2`, `openai/gpt-5.2/high`, ...). Fold them into the base model
 * so the picker lists models once and the reasoning control selects the
 * variant (acpLegacyVariantModel applies it per turn).
 */
function foldLegacyVariants(rows: Map<string, HarnessModelInfo>, selected: string | undefined): string | undefined {
  for (const [id] of [...rows]) {
    const slash = id.lastIndexOf('/')
    if (slash <= 0) continue
    const base = rows.get(id.slice(0, slash))
    const effort = LEGACY_VARIANT_EFFORTS[id.slice(slash + 1).toLowerCase()]
    if (!base || !effort) continue
    rows.delete(id)
    base.reasoningEfforts = [...new Set([...(base.reasoningEfforts ?? []), effort])]
      .sort((a, b) => KUN_EFFORT_ORDER.indexOf(a) - KUN_EFFORT_ORDER.indexOf(b))
    if (selected === id) {
      base.defaultReasoningEffort = effort
      selected = base.id
    }
  }
  return selected
}

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
    selected = foldLegacyVariants(rows, selected)
    // Without a thought_level option a legacy model's reasoning is chosen only
    // through its variants, so a model without variants has no levels at all.
    if (!input.configOptions?.some((option) => option.category === 'thought_level' && option.type === 'select')) {
      for (const row of rows.values()) row.reasoningEfforts ??= []
    }
  }
  const current = selected ? rows.get(selected) : undefined
  if (current) {
    const thought = input.configOptions?.find((option) => option.category === 'thought_level' && option.type === 'select')
    if (thought?.type === 'select') {
      current.reasoningEfforts = acpConfigOptionValues(thought)
      current.defaultReasoningEffort = thought.currentValue
    } else if (input.harnessId === 'devin') {
      // Devin's picker treats a known-empty list as "details loaded, no levels".
      current.reasoningEfforts = []
    }
  }
  const defaultRow = rows.get(input.defaultModel ?? selected ?? '')
  if (defaultRow) defaultRow.isDefault = true
  return { models: [...rows.keys()], modelInfo: [...rows.values()] }
}
