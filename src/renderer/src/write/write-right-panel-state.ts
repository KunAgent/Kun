/**
 * Work-mode right workspace state: which rail tool is active and whether its
 * panel is expanded. The rail itself stays visible while the panel is
 * collapsed, mirroring the Code right rail.
 */
export const WRITE_RIGHT_PANEL_IDS = [
  'assistant',
  'outline',
  'review',
  'references',
  'history',
  'subagents',
  'mcpSkills',
  'usage'
] as const

export type WriteRightPanelId = (typeof WRITE_RIGHT_PANEL_IDS)[number]

export type WriteRightPanelState = {
  expanded: boolean
  activeId: WriteRightPanelId
}

export const WRITE_RIGHT_PANEL_KEY = 'kun.write.right-panel.v1'
export const WRITE_RIGHT_PANEL_WIDTH_KEY = 'kun.layout.writeRightPanelWidth'
export const WRITE_RIGHT_PANEL_DEFAULT_WIDTH = 384

export const DEFAULT_WRITE_RIGHT_PANEL_STATE: WriteRightPanelState = {
  expanded: true,
  activeId: 'assistant'
}

const ID_SET = new Set<string>(WRITE_RIGHT_PANEL_IDS)

export function isWriteRightPanelId(value: unknown): value is WriteRightPanelId {
  return typeof value === 'string' && ID_SET.has(value)
}

export function normalizeWriteRightPanelState(raw: unknown): WriteRightPanelState | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.expanded !== 'boolean' || !isWriteRightPanelId(record.activeId)) return null
  return { expanded: record.expanded, activeId: record.activeId }
}

/**
 * Reads the persisted state. Without a stored v1 record the legacy
 * `assistant-open` flag decides whether the assistant starts expanded; the
 * legacy default (no record) was open.
 */
export function parseStoredWriteRightPanelState(
  stored: string | null,
  legacyAssistantOpen: string | null
): WriteRightPanelState {
  if (stored) {
    try {
      const parsed = normalizeWriteRightPanelState(JSON.parse(stored))
      if (parsed) return parsed
    } catch {
      // Fall through to the legacy flag.
    }
  }
  return { expanded: legacyAssistantOpen !== '0', activeId: 'assistant' }
}

export function serializeWriteRightPanelState(state: WriteRightPanelState): string {
  return JSON.stringify({ expanded: state.expanded, activeId: state.activeId })
}

export function openWriteRightPanelState(
  _state: WriteRightPanelState,
  id: WriteRightPanelId
): WriteRightPanelState {
  return { expanded: true, activeId: id }
}

/** Rail click: the visible tool collapses the panel, any other tool opens. */
export function toggleWriteRightPanelState(
  state: WriteRightPanelState,
  id: WriteRightPanelId
): WriteRightPanelState {
  if (state.expanded && state.activeId === id) return { ...state, expanded: false }
  return { expanded: true, activeId: id }
}

export function collapseWriteRightPanelState(state: WriteRightPanelState): WriteRightPanelState {
  return state.expanded ? { ...state, expanded: false } : state
}

/** Legacy `assistantOpen` projection kept for existing store consumers. */
export function writeAssistantOpenFor(state: WriteRightPanelState): boolean {
  return state.expanded && state.activeId === 'assistant'
}
