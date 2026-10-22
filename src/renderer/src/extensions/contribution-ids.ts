import { ContributionIdSchema } from '@kun/extension-api'

export const BUILTIN_RIGHT_PANEL_IDS = {
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
  mcpSkills: 'builtin:right-panel-mcp-skills',
  providerQuotas: 'builtin:right-panel-provider-quotas',
  agentPerspective: 'builtin:right-panel-agent-perspective',
  graph: 'builtin:right-panel-graph',
  remote: 'builtin:right-panel-remote',
  review: 'builtin:right-panel-review',
  workers: 'builtin:right-panel-workers',
  conversationInfo: 'builtin:right-panel-conversation-info',
  wardrobe: 'builtin:right-panel-wardrobe',
  appSurface: 'builtin:right-panel-app-surface'
} as const

export type BuiltinRightPanelId = (typeof BUILTIN_RIGHT_PANEL_IDS)[keyof typeof BUILTIN_RIGHT_PANEL_IDS]
export type ExtensionContributionId = `extension:${string}/${string}`
/** One right-panel tab per opened ADE worker (or child agent) conversation. */
export const WORKER_SESSION_TAB_PREFIX = 'builtin:right-panel-worker:'
export type WorkerSessionTabId = `${typeof WORKER_SESSION_TAB_PREFIX}${string}`
export type RightPanelContributionId = BuiltinRightPanelId | ExtensionContributionId | WorkerSessionTabId
export type RightPanelMode = RightPanelContributionId | null

const BUILTIN_RIGHT_PANEL_ID_SET = new Set<string>(Object.values(BUILTIN_RIGHT_PANEL_IDS))

const LEGACY_RIGHT_PANEL_IDS: Readonly<Record<string, BuiltinRightPanelId>> = {
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
  'mcp-skills': BUILTIN_RIGHT_PANEL_IDS.mcpSkills,
  'provider-quotas': BUILTIN_RIGHT_PANEL_IDS.providerQuotas,
  wardrobe: BUILTIN_RIGHT_PANEL_IDS.wardrobe,
  'agent-perspective': BUILTIN_RIGHT_PANEL_IDS.agentPerspective,
  graph: BUILTIN_RIGHT_PANEL_IDS.graph,
  remote: BUILTIN_RIGHT_PANEL_IDS.remote
}

export function isExtensionContributionId(value: string): value is ExtensionContributionId {
  return value.startsWith('extension:') && ContributionIdSchema.safeParse(value).success
}

const WORKER_SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/

export function workerSessionTabId(workerId: string): WorkerSessionTabId {
  return `${WORKER_SESSION_TAB_PREFIX}${workerId}`
}

export function isWorkerSessionTabId(value: string): value is WorkerSessionTabId {
  return value.startsWith(WORKER_SESSION_TAB_PREFIX) &&
    WORKER_SESSION_ID.test(value.slice(WORKER_SESSION_TAB_PREFIX.length))
}

export function workerIdFromSessionTab(value: string): string | null {
  return isWorkerSessionTabId(value) ? value.slice(WORKER_SESSION_TAB_PREFIX.length) : null
}

export function isRightPanelContributionId(value: unknown): value is RightPanelContributionId {
  return typeof value === 'string' &&
    (BUILTIN_RIGHT_PANEL_ID_SET.has(value) || isExtensionContributionId(value) || isWorkerSessionTabId(value))
}

/**
 * Restores both the v1 fully-qualified layout value and the pre-extension
 * short panel mode. Unknown or removed contributions fail closed so stale
 * layout never prevents the workbench from opening.
 */
export function normalizeStoredRightPanelId(value: unknown): RightPanelMode {
  if (typeof value !== 'string') return null
  if (value === 'agent-perspective' || value === BUILTIN_RIGHT_PANEL_IDS.agentPerspective) return null
  return LEGACY_RIGHT_PANEL_IDS[value] ?? (isRightPanelContributionId(value) ? value : null)
}

export function legacyRightPanelId(value: RightPanelMode): string | null {
  if (value === null || isExtensionContributionId(value) || isWorkerSessionTabId(value)) return null
  const entry = Object.entries(LEGACY_RIGHT_PANEL_IDS).find(([, id]) => id === value)
  return entry?.[0] ?? null
}
