import type { KunLabPptAgentSettingsV1, KunLabSettingsV1 } from './app-settings-types'

export function defaultKunLabSettings(): KunLabSettingsV1 {
  return {
    pptAgent: {
      enabled: true,
      model: '',
      providerId: '',
      fast: false,
      imageAssets: true
    },
    conversationVisualization: {
      enabled: false
    },
    autoPlanBuild: {
      enabled: false,
      confirmation: 'always',
      defaultBuildMode: 'direct',
      useWorktreeByDefault: true,
      scheduledDefaults: {
        providerId: '',
        model: '',
        reasoningEffort: 'auto',
        timeZone: ''
      }
    },
    opencodeReferenceBranches: { enabled: false },
    claudeCodeReferenceBranches: { enabled: false },
    codexReferenceBranches: { enabled: false },
    projectBoard: {
      enabled: false
    },
    genUi: { enabled: false },
    mcpApps: { enabled: false },
    assistantMailbox: { enabled: false }
  }
}

/**
 * Stored PPT agent settings may predate `imageAssets` and still carry the
 * retired `imageFirst` preview switch; keep the user's other fields and drop it.
 */
export function normalizeStoredPptAgentSettings(
  stored: KunLabPptAgentSettingsV1 | undefined,
  defaults: KunLabPptAgentSettingsV1
): KunLabPptAgentSettingsV1 {
  if (!stored) return defaults
  const { imageFirst: _retired, ...rest } = stored as KunLabPptAgentSettingsV1 & { imageFirst?: unknown }
  return { ...rest, imageAssets: rest.imageAssets !== false }
}
