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
