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
 * Stored PPT preferences may still carry settings of the retired PPT
 * sub-agent and the former Lab master switch. Only `imageAssets` remains active.
 */
export function normalizeStoredPptAgentSettings(
  stored: Partial<KunLabPptAgentSettingsV1> | undefined,
  defaults: KunLabPptAgentSettingsV1
): KunLabPptAgentSettingsV1 {
  if (!stored) return defaults
  return {
    enabled: true,
    imageAssets: stored.imageAssets !== false
  }
}
