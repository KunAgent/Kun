import i18n from '../i18n'
import { isBuiltinWriteAgentPresetId, type WriteAgentPresetV1 } from '@shared/app-settings'

export type ResolvedWriteAgentPreset = {
  id: string
  name: string
  emoji: string
  persona: string
  builtin: boolean
}

/**
 * Fills localized defaults for built-in agent presets that the user has not
 * customized (empty name/persona), mirroring the quick-action resolution
 * convention. Reads the global i18n instance so it works from any component
 * regardless of its bound namespace.
 */
export function resolveWriteAgentPreset(preset: WriteAgentPresetV1): ResolvedWriteAgentPreset {
  const builtin = isBuiltinWriteAgentPresetId(preset.id)
  const name =
    preset.name.trim() ||
    (builtin ? i18n.t(`writeAgentPreset_${preset.id}_name`, { ns: 'common' }) : preset.id)
  const persona =
    preset.persona.trim() ||
    (builtin ? i18n.t(`writeAgentPreset_${preset.id}_persona`, { ns: 'common' }) : '')
  return {
    id: preset.id,
    name,
    emoji: preset.emoji.trim() || '🤖',
    persona,
    builtin
  }
}
