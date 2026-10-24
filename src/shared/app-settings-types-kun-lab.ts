// Lab (experimental feature) settings of the Kun runtime section.
import type { ScheduleReasoningEffort } from './app-settings-types-provider'

/**
 * PPT preferences retain the historical `lab.pptAgent` storage key so older
 * settings keep `imageAssets`. The former `enabled` switch is inert.
 */
export type KunLabPptAgentSettingsV1 = {
  /** Retired Lab switch, always normalized to true; PPT tools are built in. */
  enabled: boolean
  /** Let image slots be filled with generated supplementary assets when an image model is available. Default true. */
  imageAssets: boolean
}

/** Experimental Lab session-display optimization (charts, diagrams, structured visuals). */
export type KunLabConversationVisualizationSettingsV1 = {
  /** Master switch. Default false while the feature is experimental. */
  enabled: boolean
}

/** Experimental Lab feature settings for the project board sidebar entry. */
export type KunLabProjectBoardSettingsV1 = {
  /** Master switch. Default false while the feature is experimental. */
  enabled: boolean
}

export type KunLabAutoPlanBuildMode = 'direct' | 'scheduled'
export type KunLabAutoPlanBuildConfirmation = 'always' | 'defaults'

export type KunLabAutoPlanBuildScheduledDefaultsV1 = {
  /** Empty values inherit the active composer/runtime selection. */
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  /** Empty uses the host system time zone. Exact date/time is never persisted here. */
  timeZone: string
}

/** GUI-only Laboratory defaults for the Automatic (plan + build) composer mode. */
export type KunLabAutoPlanBuildSettingsV1 = {
  enabled: boolean
  confirmation: KunLabAutoPlanBuildConfirmation
  defaultBuildMode: KunLabAutoPlanBuildMode
  useWorktreeByDefault: boolean
  scheduledDefaults: KunLabAutoPlanBuildScheduledDefaultsV1
}

/** Experimental Lab feature settings written into Kun config `lab`. */
export type KunLabSettingsV1 = {
  pptAgent: KunLabPptAgentSettingsV1
  conversationVisualization: KunLabConversationVisualizationSettingsV1
  autoPlanBuild: KunLabAutoPlanBuildSettingsV1
  opencodeReferenceBranches: { enabled: boolean }
  claudeCodeReferenceBranches: { enabled: boolean }
  codexReferenceBranches: { enabled: boolean }
  projectBoard: KunLabProjectBoardSettingsV1
  /** Personal assistants (Cue, Grok Bot, Muse, dots) driven through Kun's assistant mailbox. */
  assistantMailbox: { enabled: boolean }
}

/** Partial settings patch for the Lab section and the PPT image asset preference. */
export type KunLabSettingsPatchV1 = {
  pptAgent?: Partial<KunLabPptAgentSettingsV1>
  conversationVisualization?: Partial<KunLabConversationVisualizationSettingsV1>
  autoPlanBuild?: Partial<Omit<KunLabAutoPlanBuildSettingsV1, 'scheduledDefaults'>> & {
    scheduledDefaults?: Partial<KunLabAutoPlanBuildScheduledDefaultsV1>
  }
  opencodeReferenceBranches?: { enabled?: boolean }
  claudeCodeReferenceBranches?: { enabled?: boolean }
  codexReferenceBranches?: { enabled?: boolean }
  projectBoard?: Partial<KunLabProjectBoardSettingsV1>
  assistantMailbox?: { enabled?: boolean }
}
