import {
  BUILTIN_RIGHT_PANEL_IDS,
  isRightPanelContributionId,
  normalizeStoredRightPanelId,
  type RightPanelContributionId,
  type RightPanelMode
} from '../../extensions/contribution-ids'

export const CODE_RIGHT_TABS_STATE_VERSION = 1 as const

export type CodeRightTabsState = {
  version: typeof CODE_RIGHT_TABS_STATE_VERSION
  tabs: RightPanelContributionId[]
  activeId: RightPanelContributionId | null
  expanded: boolean
}

function isCodeRightTabContributionId(value: unknown): value is RightPanelContributionId {
  return isRightPanelContributionId(value) &&
    value !== BUILTIN_RIGHT_PANEL_IDS.sddAi &&
    value !== BUILTIN_RIGHT_PANEL_IDS.terminal
}

export type StoredCodeRightTabsRegistry = {
  version: typeof CODE_RIGHT_TABS_STATE_VERSION
  workspaces: Record<string, CodeRightTabsState>
}

export function emptyCodeRightTabsState(): CodeRightTabsState {
  return {
    version: CODE_RIGHT_TABS_STATE_VERSION,
    tabs: [],
    activeId: null,
    expanded: false
  }
}

function uniqueValidTabs(value: unknown): RightPanelContributionId[] {
  if (!Array.isArray(value)) return []
  const tabs: RightPanelContributionId[] = []
  for (const candidate of value) {
    if (!isCodeRightTabContributionId(candidate) || tabs.includes(candidate)) continue
    tabs.push(candidate)
  }
  return tabs
}

export function normalizeCodeRightTabsState(
  value: unknown,
  legacyMode: RightPanelMode = null
): CodeRightTabsState {
  if (!value || typeof value !== 'object') {
    return migrateLegacyRightPanelMode(legacyMode)
  }
  const source = value as Partial<CodeRightTabsState>
  if (source.version !== CODE_RIGHT_TABS_STATE_VERSION) {
    return migrateLegacyRightPanelMode(legacyMode)
  }
  const tabs = uniqueValidTabs(source.tabs)
  const activeId = isCodeRightTabContributionId(source.activeId) && tabs.includes(source.activeId)
    ? source.activeId
    : tabs[0] ?? null
  return {
    version: CODE_RIGHT_TABS_STATE_VERSION,
    tabs,
    activeId,
    expanded: source.expanded === true
  }
}

export function migrateLegacyRightPanelMode(mode: unknown): CodeRightTabsState {
  const normalized = normalizeStoredRightPanelId(mode)
  if (!isCodeRightTabContributionId(normalized)) return emptyCodeRightTabsState()
  return {
    version: CODE_RIGHT_TABS_STATE_VERSION,
    tabs: [normalized],
    activeId: normalized,
    expanded: true
  }
}

export function openCodeRightTab(
  state: CodeRightTabsState,
  id: RightPanelContributionId
): CodeRightTabsState {
  if (!isCodeRightTabContributionId(id)) return state
  return {
    version: CODE_RIGHT_TABS_STATE_VERSION,
    tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id],
    activeId: id,
    expanded: true
  }
}

export function activateCodeRightTab(
  state: CodeRightTabsState,
  id: RightPanelContributionId
): CodeRightTabsState {
  return state.tabs.includes(id) ? openCodeRightTab(state, id) : state
}

export function closeCodeRightTab(
  state: CodeRightTabsState,
  id: RightPanelContributionId
): CodeRightTabsState {
  const closingIndex = state.tabs.indexOf(id)
  if (closingIndex < 0) return state
  const tabs = state.tabs.filter((tab) => tab !== id)
  if (tabs.length === 0) return emptyCodeRightTabsState()
  const activeId = state.activeId === id
    ? tabs[closingIndex] ?? tabs[closingIndex - 1] ?? tabs[0]
    : state.activeId && tabs.includes(state.activeId)
      ? state.activeId
      : tabs[0]
  return {
    version: CODE_RIGHT_TABS_STATE_VERSION,
    tabs,
    activeId,
    expanded: state.expanded
  }
}

export function collapseCodeRightTabs(state: CodeRightTabsState): CodeRightTabsState {
  if (!state.expanded) return state
  return { ...state, expanded: false }
}

export function expandCodeRightTabs(state: CodeRightTabsState): CodeRightTabsState {
  if (state.expanded) return state
  return { ...state, expanded: true, activeId: state.activeId ?? state.tabs[0] ?? null }
}

export function retainCodeRightTabs(
  state: CodeRightTabsState,
  allowed: ReadonlySet<RightPanelContributionId>
): CodeRightTabsState {
  let next = state
  for (const id of state.tabs) {
    if (!allowed.has(id)) next = closeCodeRightTab(next, id)
  }
  return next
}

export function normalizeStoredCodeRightTabsRegistry(value: unknown): StoredCodeRightTabsRegistry {
  if (!value || typeof value !== 'object') {
    return { version: CODE_RIGHT_TABS_STATE_VERSION, workspaces: {} }
  }
  const source = value as Partial<StoredCodeRightTabsRegistry>
  if (source.version !== CODE_RIGHT_TABS_STATE_VERSION || !source.workspaces || typeof source.workspaces !== 'object') {
    return { version: CODE_RIGHT_TABS_STATE_VERSION, workspaces: {} }
  }
  const workspaces: Record<string, CodeRightTabsState> = {}
  for (const [scope, state] of Object.entries(source.workspaces)) {
    if (!scope) continue
    workspaces[scope] = normalizeCodeRightTabsState(state)
  }
  return { version: CODE_RIGHT_TABS_STATE_VERSION, workspaces }
}
