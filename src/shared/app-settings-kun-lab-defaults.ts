import type { KunLabSettingsV1 } from './app-settings-types'

export function defaultKunLabSettings(): KunLabSettingsV1 {
  return {
    pptAgent: {
      enabled: true,
      model: '',
      providerId: '',
      fast: false,
      imageFirst: true
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
    }
  }
}
