import type { KunLabPptAgentSettingsV1, KunLabSettingsV1 } from './app-settings-types'

export function defaultKunLabSettings(): KunLabSettingsV1 {
  return {
    pptAgent: {
      enabled: true,
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
 * Stored PPT settings may predate `imageAssets` and still carry fields of the
 * retired PPT sub-agent (`imageFirst` and its model overrides); keep only the
 * two switches the slides skill uses.
 */
export function normalizeStoredPptAgentSettings(
  stored: Partial<KunLabPptAgentSettingsV1> | undefined,
  defaults: KunLabPptAgentSettingsV1
): KunLabPptAgentSettingsV1 {
  if (!stored) return defaults
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : defaults.enabled,
    imageAssets: stored.imageAssets !== false
  }
}
