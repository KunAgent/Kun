/** Suggestion-card defaults; `autoStartSeconds` 0 keeps cards waiting for the user. */
export type AdeTaskSuggestionSettings = { autoStartSeconds: number; worktree: boolean; inheritContext: boolean }
export const DEFAULT_ADE_TASK_SUGGESTION_SETTINGS: AdeTaskSuggestionSettings = { autoStartSeconds: 0, worktree: true, inheritContext: false }

/** One globally scoped collaboration object. No credential or executable fields belong here. */
export type AdeCollaborationSettingsValue = {
  enabled: boolean
  managerModel?: { providerId: string; model: string }
  managerMayApprove: boolean
  allowUnattendedFullAccess: boolean
  limits: { softWorkers: number; hardWorkers: number }
  budget?: { softTokens?: number; hardTokens?: number }
  hibernation: { enabled: boolean; idleMinutes: number }
  stall: { structuredMinutes: number; terminalMinutes: number }
  /** Seconds a waiting dispatch card gives the user before starting on its own (0 = never). */
  dispatch: { autoStartSeconds: number; autoStartWhenConfirmationRequired: boolean }
  /** Suggestion cards: no-response start window (0 = never) and per-task defaults. */
  tasks: AdeTaskSuggestionSettings
  /** Rollback switches for harness-aware turn routing and deterministic handoff briefs. */
  harnessRouter: boolean
  deterministicHandoff: boolean
}

export type AdeCollaborationSettingsSnapshot = {
  value: AdeCollaborationSettingsValue
  /** Version of only this object; unrelated settings writes leave it unchanged. */
  revision: string
}

export type AdeCollaborationSettingsMutation = {
  expectedRevision: string
  value: AdeCollaborationSettingsValue
}

export type AdeCollaborationSettingsMutationResult =
  | ({ ok: true; generation: number } & AdeCollaborationSettingsSnapshot)
  | ({ ok: false; kind: 'conflict' } & AdeCollaborationSettingsSnapshot)

export type AdeCollaborationSettingsBridge = {
  getAdeCollaborationSettings: () => Promise<AdeCollaborationSettingsSnapshot>
  saveAdeCollaborationSettings: (request: AdeCollaborationSettingsMutation) => Promise<AdeCollaborationSettingsMutationResult>
}
