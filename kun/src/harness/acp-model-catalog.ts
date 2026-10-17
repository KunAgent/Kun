import { providerModule } from './providers/registry.js'
import type { HarnessModelCatalog, HarnessModelInfo } from '../contracts/harness-models.js'
import type { AcpConfigOption, AcpSessionModes } from '../runtime/acp/acp-schema.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import { nativeAgentsFromAcpModes } from '../contracts/harness-native-agents.js'
import { acpSessionModeSelector } from '../runtime/acp/acp-session-modes.js'
import { acpConfigOptionValues } from '../runtime/acp/acp-schema.js'
import { acpSessionSettings } from '../runtime/acp/acp-session-settings.js'

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

/** Display label of an ACP select option group: its name, else its id. */
function groupLabel(entry: Record<string, unknown>): string | undefined {
  for (const candidate of [entry.name, entry.group]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

/** Keep native labels, order and capabilities. Modern selectors are authoritative over legacy aliases. */
export function acpModelCatalog(input: {
  harnessId: string; configOptions?: AcpConfigOption[] | null; models?: unknown; defaultModel?: string
}): HarnessModelCatalog {
  const rows = new Map<string, HarnessModelInfo>()
  const acp = providerModule(input.harnessId)?.acp
  const modelCategory = acp?.modelCategory
  let selected: string | undefined
  for (const option of input.configOptions ?? []) {
    if (option.category !== 'model' || option.type !== 'select') continue
    selected = option.currentValue
    const visit = (entries: unknown[], group?: string) => {
      for (const raw of entries) {
        if (!raw || typeof raw !== 'object') continue
        const entry = raw as Record<string, unknown>
        if (Array.isArray(entry.options)) { visit(entry.options, groupLabel(entry) ?? group); continue }
        if (typeof entry.value !== 'string' || !entry.value.trim() || rows.has(entry.value)) continue
        const meta = entry._meta as Record<string, unknown> | undefined
        const images = meta?.['cognition.ai/supportsImages']
        rows.set(entry.value, { id: entry.value,
          ...(group ? { group } : {}),
          ...(typeof entry.name === 'string' ? { displayName: entry.name } : {}),
          ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
          ...(modelCategory ? { category: modelCategory(entry.value) } : {}),
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
    } else if (acp?.emptyEffortsWithoutThoughtLevel) {
      current.reasoningEfforts = []
    }
  }
  const defaultRow = rows.get(input.defaultModel ?? selected ?? '')
  if (defaultRow) defaultRow.isDefault = true
  return { models: [...rows.keys()], modelInfo: [...rows.values()] }
}

/** Attach the native Agents an engine publishes as session modes (OpenCode). */
export function attachNativeAgents(
  definition: Pick<HarnessDefinition, 'nativeAgents'>,
  catalog: HarnessModelCatalog,
  session: { modes?: AcpSessionModes | null; configOptions?: readonly AcpConfigOption[] | null }
): HarnessModelCatalog {
  const modeSelector = acpSessionModeSelector(session)
  const agents = definition.nativeAgents === 'session-modes' ? nativeAgentsFromAcpModes(modeSelector) : []
  if (agents.length) {
    catalog.agents = agents
    const current = modeSelector?.currentModeId.trim()
    if (current && agents.some((agent) => agent.id === current)) catalog.defaultAgentId = current
  }
  return catalog
}

/** Catalog of a freshly opened session: models, reasoning levels, native Agents and other settings. */
export function acpSessionCatalog(
  definition: Pick<HarnessDefinition, 'id' | 'nativeAgents' | 'acpPermission'>,
  session: { configOptions?: AcpConfigOption[] | null; models?: unknown; modes?: AcpSessionModes | null }
): HarnessModelCatalog {
  const catalog = attachNativeAgents(definition, acpModelCatalog({ harnessId: definition.id, ...session }), session)
  const settings = acpSessionSettings(session.configOptions, definition.acpPermission?.configOptionId)
  return settings.length ? { ...catalog, settings } : catalog
}
