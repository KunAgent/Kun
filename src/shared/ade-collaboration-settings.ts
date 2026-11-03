/** Suggestion-card defaults; `autoStartSeconds` 0 keeps cards waiting for the user. */
export type AdeTaskSuggestionSettings = { autoStartSeconds: number; worktree: boolean; inheritContext: boolean }
export const DEFAULT_ADE_TASK_SUGGESTION_SETTINGS: AdeTaskSuggestionSettings = { autoStartSeconds: 0, worktree: true, inheritContext: false }

/** Longest user dispatch preference (which Agent and model suit which work). Kun enforces the same cap. */
export const ADE_DISPATCH_PREFERENCE_MAX_CHARS = 2_000
export const ADE_DISPATCH_PREFERENCE_MAX_RULES = 8

export type AdeDispatchPreferenceRule = {
  id: string
  scenario: string
  agentId: string
  agentLabel?: string
  model?: string
  providerId?: string
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  note?: string
  enabled: boolean
}

type PreferenceInput = { preferences?: readonly AdeDispatchPreferenceRule[]; preferencePrompt?: string }

export function normalizeDispatchPreferences(value: unknown): AdeDispatchPreferenceRule[] {
  if (!Array.isArray(value)) return []
  const result: AdeDispatchPreferenceRule[] = []
  const ids = new Set<string>()
  const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const scenario = text(raw.scenario, 200)
    const agentId = text(raw.agentId, 64)
    const id = text(raw.id, 128) || `pref-${index}`
    if (!scenario || !agentId || ids.has(id)) continue
    ids.add(id)
    const rule: AdeDispatchPreferenceRule = { id, scenario, agentId, enabled: raw.enabled !== false }
    for (const [key, max] of [['agentLabel', 80], ['model', 512], ['providerId', 128], ['note', 300]] as const) {
      const value = text(raw[key], max)
      if (value) rule[key] = value
    }
    if (['native-login', 'provider', 'kun-gateway'].includes(raw.credentialMode)) rule.credentialMode = raw.credentialMode
    result.push(rule)
    if (result.length === ADE_DISPATCH_PREFERENCE_MAX_RULES) break
  }
  return result
}

/** Use truncate:false for validation; the runtime projection remains bounded defensively. */
export function composeDispatchPreferencePrompt(input?: PreferenceInput, options: { truncate?: boolean } = {}): string {
  const lines = (input?.preferences ?? []).filter((rule) => rule.enabled && rule.scenario.trim() && rule.agentId.trim()).map((rule) => {
    const line = (value: string): string => value.trim().replace(/[\r\n]+/g, ' ')
    const agent = rule.agentLabel ? `${line(rule.agentLabel)} (${line(rule.agentId)})` : line(rule.agentId)
    return `- ${line(rule.scenario)} → Agent ${agent}` +
      (rule.model ? `, model ${line(rule.model)}` : ', model: Agent default') +
      (rule.providerId ? `, provider ${line(rule.providerId)}` : '') +
      (rule.credentialMode ? `, credential mode ${rule.credentialMode}` : '') +
      (rule.note?.trim() ? ` (${line(rule.note)})` : '')
  })
  const notes = input?.preferencePrompt?.trim()
  if (notes) lines.push(notes)
  const full = lines.join('\n')
  if (options.truncate === false || full.length <= ADE_DISPATCH_PREFERENCE_MAX_CHARS) return full
  const prefix = full.slice(0, ADE_DISPATCH_PREFERENCE_MAX_CHARS)
  const boundary = prefix.lastIndexOf('\n')
  return boundary > 0 ? prefix.slice(0, boundary) : prefix
}

export function dispatchPreferencesValid(input: PreferenceInput): boolean {
  const rules = input.preferences ?? []
  return rules.length <= ADE_DISPATCH_PREFERENCE_MAX_RULES &&
    rules.every((rule) => rule.scenario.trim() && rule.agentId.trim()) &&
    composeDispatchPreferencePrompt(input, { truncate: false }).length <= ADE_DISPATCH_PREFERENCE_MAX_CHARS
}

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
  /**
   * Seconds a waiting dispatch card gives the user before starting on its own (0 = never),
   * and the user's own guidance the dispatching Agent follows when it picks an Agent and model.
   */
  dispatch: { autoStartSeconds: number; autoStartWhenConfirmationRequired: boolean; preferencePrompt: string; preferences: AdeDispatchPreferenceRule[] }
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
