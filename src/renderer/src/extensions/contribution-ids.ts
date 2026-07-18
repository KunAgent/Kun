import { ContributionIdSchema } from '@kun/extension-api'

export const BUILTIN_RIGHT_PANEL_IDS = {
  todo: 'builtin:right-panel-todo',
  plan: 'builtin:right-panel-plan',
  changes: 'builtin:right-panel-changes',
  browser: 'builtin:right-panel-browser',
  terminal: 'builtin:right-panel-terminal',
  files: 'builtin:right-panel-files',
  file: 'builtin:right-panel-file',
  sideConversations: 'builtin:right-panel-side-conversations',
  sddAi: 'builtin:right-panel-sdd-ai',
  canvas: 'builtin:right-panel-canvas',
  subagents: 'builtin:right-panel-subagents',
  mcpSkills: 'builtin:right-panel-mcp-skills'
} as const

export type BuiltinRightPanelId = (typeof BUILTIN_RIGHT_PANEL_IDS)[keyof typeof BUILTIN_RIGHT_PANEL_IDS]
export type ExtensionContributionId = `extension:${string}/${string}`
export type RightPanelContributionId = BuiltinRightPanelId | ExtensionContributionId
export type RightPanelMode = RightPanelContributionId | null

const BUILTIN_RIGHT_PANEL_ID_SET = new Set<string>(Object.values(BUILTIN_RIGHT_PANEL_IDS))

const LEGACY_RIGHT_PANEL_IDS: Readonly<Record<string, BuiltinRightPanelId>> = {
  todo: BUILTIN_RIGHT_PANEL_IDS.todo,
  plan: BUILTIN_RIGHT_PANEL_IDS.plan,
  changes: BUILTIN_RIGHT_PANEL_IDS.changes,
  browser: BUILTIN_RIGHT_PANEL_IDS.browser,
  terminal: BUILTIN_RIGHT_PANEL_IDS.terminal,
  files: BUILTIN_RIGHT_PANEL_IDS.files,
  file: BUILTIN_RIGHT_PANEL_IDS.file,
  'side-conversations': BUILTIN_RIGHT_PANEL_IDS.sideConversations,
  'sdd-ai': BUILTIN_RIGHT_PANEL_IDS.sddAi,
  canvas: BUILTIN_RIGHT_PANEL_IDS.canvas,
  subagents: BUILTIN_RIGHT_PANEL_IDS.subagents,
  'mcp-skills': BUILTIN_RIGHT_PANEL_IDS.mcpSkills
}

export function isExtensionContributionId(value: string): value is ExtensionContributionId {
  return value.startsWith('extension:') && ContributionIdSchema.safeParse(value).success
}

export function isRightPanelContributionId(value: unknown): value is RightPanelContributionId {
  return typeof value === 'string' &&
    (BUILTIN_RIGHT_PANEL_ID_SET.has(value) || isExtensionContributionId(value))
}

/**
 * Restores both the v1 fully-qualified layout value and the pre-extension
 * short panel mode. Unknown or removed contributions fail closed so stale
 * layout never prevents the workbench from opening.
 */
export function normalizeStoredRightPanelId(value: unknown): RightPanelMode {
  if (typeof value !== 'string') return null
  return LEGACY_RIGHT_PANEL_IDS[value] ?? (isRightPanelContributionId(value) ? value : null)
}

export function legacyRightPanelId(value: RightPanelMode): string | null {
  if (value === null || isExtensionContributionId(value)) return null
  const entry = Object.entries(LEGACY_RIGHT_PANEL_IDS).find(([, id]) => id === value)
  return entry?.[0] ?? null
}
