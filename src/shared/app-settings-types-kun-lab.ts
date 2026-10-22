// Lab (experimental feature) settings of the Kun runtime section.
import type { ModelReasoningEffort, ScheduleReasoningEffort } from './app-settings-types-provider'

/** Experimental Lab feature settings for the first-class `ppt_agent` tool. */
export type KunLabPptAgentSettingsV1 = {
  /** Master switch for the ppt_agent tool. Default true. */
  enabled: boolean
  /** Optional child model override. Empty = follow the main session model. */
  model: string
  /** Provider id paired with model. Empty = follow the main session provider. */
  providerId: string
  /** Optional reasoning depth for ppt_agent child requests. Empty = follow the main session. */
  reasoningEffort?: ModelReasoningEffort
  /** Codex fast mode (serviceTier = priority). Only effective for Codex models that advertise priority. */
  fast: boolean
  /** Let the PPT agent fill image slots with generated supplementary assets when an image model is available. Default true. */
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
  /** Agent-generated interactive widgets in desktop conversations. */
  genUi: { enabled: boolean }
  /** Interactive pages of MCP tools that declare a `ui://` resource. */
  mcpApps: { enabled: boolean }
  /** Personal assistants (Cue, Grok Bot, Muse, dots) driven through Kun's assistant mailbox. */
  assistantMailbox: { enabled: boolean }
}

/** Partial settings patch for the Lab section. Nested fields merge with current values. */
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
  genUi?: { enabled?: boolean }
  mcpApps?: { enabled?: boolean }
  assistantMailbox?: { enabled?: boolean }
}
