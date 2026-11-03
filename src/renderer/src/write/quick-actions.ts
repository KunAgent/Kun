import { builtinWriteQuickActionMode, type WriteQuickActionMode, type WriteQuickActionV1 } from '@shared/app-settings'

export type ResolvedWriteQuickAction = {
  id: string
  label: string
  prompt: string
  mode: WriteQuickActionMode
}

type TranslateFn = (key: string) => string

const BUILTIN_KEYS: Record<string, { labelKey: string; promptKey: string }> = {
  polish: {
    labelKey: 'writeQuickActionPolish',
    promptKey: 'writeQuickActionPolishPrompt'
  },
  explain: {
    labelKey: 'writeQuickActionExplain',
    promptKey: 'writeQuickActionExplainPrompt'
  },
  reformat: {
    labelKey: 'writeQuickActionReformat',
    promptKey: 'writeQuickActionReformatPrompt'
  },
  // Keep legacy defaults available for saved actions with customized labels or prompts.
  distill: {
    labelKey: 'writeQuickActionDistill',
    promptKey: 'writeQuickActionDistillPrompt'
  },
  bolder: {
    labelKey: 'writeQuickActionBolder',
    promptKey: 'writeQuickActionBolderPrompt'
  },
  quieter: {
    labelKey: 'writeQuickActionQuieter',
    promptKey: 'writeQuickActionQuieterPrompt'
  },
  critique: {
    labelKey: 'writeQuickActionCritique',
    promptKey: 'writeQuickActionCritiquePrompt'
  }
}

export function builtinWriteQuickActionDefaults(
  id: string,
  t: TranslateFn
): { label: string; prompt: string } | null {
  const keys = BUILTIN_KEYS[id]
  if (!keys) return null
  return { label: t(keys.labelKey), prompt: t(keys.promptKey) }
}

/**
 * Resolve stored quick actions against the localized built-in defaults.
 * Entries that end up without a label or prompt are dropped (they cannot be
 * rendered or dispatched).
 */
export function resolveWriteQuickActions(
  actions: WriteQuickActionV1[],
  t: TranslateFn
): ResolvedWriteQuickAction[] {
  const resolved: ResolvedWriteQuickAction[] = []
  for (const action of actions) {
    const defaults = builtinWriteQuickActionDefaults(action.id, t)
    const label = action.label.trim() || defaults?.label || ''
    const prompt = action.prompt.trim() || defaults?.prompt || ''
    if (!label || !prompt) continue
    const mode = action.mode === 'edit' || action.mode === 'chat'
      ? action.mode
      : builtinWriteQuickActionMode(action.id)
    resolved.push({ id: action.id, label, prompt, mode })
  }
  return resolved
}
