import type { AppRoute } from '../store/chat-store-types'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isRightPanelContributionId,
  normalizeStoredRightPanelId,
  type RightPanelMode
} from '../extensions/contribution-ids'
import {
  collapseCodeRightTabs,
  emptyCodeRightTabsState,
  normalizeStoredCodeRightTabsRegistry,
  openCodeRightTab,
  type CodeRightTabsState,
  type StoredCodeRightTabsRegistry
} from './workbench/code-right-tabs-state'

export const LEFT_PANEL_WIDTH_KEY = 'kun.layout.leftSidebarWidth'
export const LEFT_PANEL_COLLAPSED_KEY = 'kun.layout.leftSidebarCollapsed'
export const RIGHT_PANEL_WIDTH_KEY = 'kun.layout.rightInspectorWidth'
const RIGHT_PANEL_MODE_KEY = 'kun.layout.rightPanelMode'
export const CODE_RIGHT_TABS_KEY = 'kun.layout.codeRightTabs.v1'
export const CODE_RIGHT_WIDTHS_KEY = 'kun.layout.codeRightWidths.v1'
export const TERMINAL_OPEN_KEY = 'kun.layout.terminalOpen'
export const TERMINAL_HEIGHT_KEY = 'kun.layout.terminalHeight'
export const LEFT_PANEL_DEFAULT = 304
export const RIGHT_PANEL_DEFAULT = 360
export const CODE_PANEL_PREFERRED = 560
export const PLAN_BOARD_PREFERRED = 720
export const GRAPH_PANEL_PREFERRED = 720
const LEFT_PANEL_MIN = 280
const LEFT_PANEL_MAX = 480
const RIGHT_PANEL_MIN = 280
const RIGHT_PANEL_MAX = 760
const SIDEBAR_HARD_MIN = 180
const MAIN_MIN_WIDTH = 560
export const PANEL_RESIZE_HANDLE_WIDTH = 9
export const RAIL_WIDTH = 48
export const WORKBENCH_RESIZE_CLASS = 'ds-workbench-resizing'
export const TERMINAL_HEIGHT_DEFAULT = 360
export const TERMINAL_HEIGHT_MIN = 220
export const TERMINAL_HEIGHT_MAX = 760

export type WorkbenchWidthConstraints = {
  mainMinWidth: number
  rightPanelMax: number
  fixedChromeWidth?: number
}

const DEFAULT_WIDTH_CONSTRAINTS: WorkbenchWidthConstraints = {
  mainMinWidth: MAIN_MIN_WIDTH,
  rightPanelMax: RIGHT_PANEL_MAX
}

const CODE_TABS_WIDTH_CONSTRAINTS: WorkbenchWidthConstraints = {
  mainMinWidth: MAIN_MIN_WIDTH,
  rightPanelMax: Number.POSITIVE_INFINITY,
  fixedChromeWidth: RAIL_WIDTH
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function readStoredWidth(key: string, fallback: number): number {
  const raw = readBrowserStorageItem(key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

export function persistWidth(key: string, width: number): void {
  writeBrowserStorageItem(key, String(Math.round(width)))
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = readBrowserStorageItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

export function persistBoolean(key: string, value: boolean): void {
  writeBrowserStorageItem(key, value ? '1' : '0')
}

type ResizePointerCaptureTarget = Pick<
  HTMLDivElement,
  'hasPointerCapture' | 'releasePointerCapture' | 'setPointerCapture'
>

export function captureResizePointer(
  target: ResizePointerCaptureTarget,
  pointerId: number
): () => void {
  target.setPointerCapture(pointerId)
  return () => {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  }
}

export function readStoredRightPanelMode(): RightPanelMode {
  const raw = readBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  return normalizeStoredRightPanelId(raw)
}

export function persistRightPanelMode(mode: RightPanelMode): void {
  if (mode !== null && isRightPanelContributionId(mode)) {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, mode)
  } else {
    removeBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  }
}

export function codeRightTabsWorkspaceScope(workspaceRoot: string): string {
  return workspaceRootScopeKey(workspaceRoot) || '__global__'
}

export function readStoredCodeRightTabsRegistry(): StoredCodeRightTabsRegistry {
  const raw = readBrowserStorageItem(CODE_RIGHT_TABS_KEY)
  if (!raw) return normalizeStoredCodeRightTabsRegistry(null)
  try {
    return normalizeStoredCodeRightTabsRegistry(JSON.parse(raw))
  } catch {
    return normalizeStoredCodeRightTabsRegistry(null)
  }
}

export function persistCodeRightTabsRegistry(registry: StoredCodeRightTabsRegistry): void {
  writeBrowserStorageItem(CODE_RIGHT_TABS_KEY, JSON.stringify(registry))
}

export type StoredCodeRightWidthsRegistry = {
  version: 1
  workspaces: Record<string, number>
}

export function normalizeStoredCodeRightWidthsRegistry(value: unknown): StoredCodeRightWidthsRegistry {
  if (!value || typeof value !== 'object') return { version: 1, workspaces: {} }
  const source = value as Partial<StoredCodeRightWidthsRegistry>
  if (source.version !== 1 || !source.workspaces || typeof source.workspaces !== 'object') {
    return { version: 1, workspaces: {} }
  }
  const workspaces: Record<string, number> = {}
  for (const [scope, width] of Object.entries(source.workspaces)) {
    if (!scope || !Number.isFinite(width)) continue
    workspaces[scope] = Math.max(RIGHT_PANEL_MIN, Math.round(width))
  }
  return { version: 1, workspaces }
}

export function readStoredCodeRightWidthsRegistry(): StoredCodeRightWidthsRegistry {
  const raw = readBrowserStorageItem(CODE_RIGHT_WIDTHS_KEY)
  if (!raw) return normalizeStoredCodeRightWidthsRegistry(null)
  try {
    return normalizeStoredCodeRightWidthsRegistry(JSON.parse(raw))
  } catch {
    return normalizeStoredCodeRightWidthsRegistry(null)
  }
}

export function persistCodeRightWidthsRegistry(registry: StoredCodeRightWidthsRegistry): void {
  writeBrowserStorageItem(CODE_RIGHT_WIDTHS_KEY, JSON.stringify(registry))
}

/**
 * Keep a workspace's previous right-panel tabs available, without letting a
 * restored panel take over the conversation when the application launches.
 */
export function initialCodeRightTabsForLaunch(
  stored: CodeRightTabsState | undefined,
  legacyMode: RightPanelMode
): CodeRightTabsState {
  if (stored) return collapseCodeRightTabs(stored)
  const legacy = legacyMode === BUILTIN_RIGHT_PANEL_IDS.sddAi ? null : legacyMode
  const migrated = legacy
    ? openCodeRightTab(emptyCodeRightTabsState(), legacy)
    : emptyCodeRightTabsState()
  return collapseCodeRightTabs(migrated)
}

export function transientRightPanelModeForWorkspaceChange(
  mode: RightPanelMode
): RightPanelMode {
  return mode === BUILTIN_RIGHT_PANEL_IDS.sddAi ? mode : null
}

export function workbenchWidthConstraintsForRightPanel(
  route: AppRoute,
  _rightPanelMode: RightPanelMode
): WorkbenchWidthConstraints {
  if (route === 'chat') return CODE_TABS_WIDTH_CONSTRAINTS
  return DEFAULT_WIDTH_CONSTRAINTS
}

export function fitWorkbenchWidths(
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  panels: { leftPanelVisible: boolean; rightPanelVisible: boolean },
  constraints: WorkbenchWidthConstraints = DEFAULT_WIDTH_CONSTRAINTS
): { left: number; right: number } {
  const mainMinWidth = constraints.mainMinWidth
  const rightPanelMax = constraints.rightPanelMax
  const fixedChromeWidth = constraints.fixedChromeWidth ?? 0
  const handleWidth =
    (panels.leftPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
    (panels.rightPanelVisible ? PANEL_RESIZE_HANDLE_WIDTH : 0)
  const usableWidth = Math.max(0, containerWidth - handleWidth - fixedChromeWidth)

  if (!panels.leftPanelVisible) {
    if (!panels.rightPanelVisible) {
      return {
        left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
        right: clampWidth(rightWidth, RIGHT_PANEL_MIN, rightPanelMax)
      }
    }
    const safeContainer = Math.max(usableWidth, mainMinWidth + SIDEBAR_HARD_MIN)
    const rightFloor =
      safeContainer - mainMinWidth >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN
    const rightCeil = Math.min(
      rightPanelMax,
      Math.max(rightFloor, safeContainer - mainMinWidth)
    )
    return {
      left: clampWidth(leftWidth, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
      right: clampWidth(rightWidth, rightFloor, rightCeil)
    }
  }

  const safeContainer = Math.max(
    usableWidth,
    mainMinWidth + SIDEBAR_HARD_MIN + (panels.rightPanelVisible ? SIDEBAR_HARD_MIN : 0)
  )
  if (!panels.rightPanelVisible) {
    const leftFloor =
      safeContainer - mainMinWidth >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
    const leftCeil = Math.min(
      LEFT_PANEL_MAX,
      Math.max(leftFloor, safeContainer - mainMinWidth)
    )
    return {
      left: clampWidth(leftWidth, leftFloor, leftCeil),
      right: clampWidth(rightWidth, RIGHT_PANEL_MIN, rightPanelMax)
    }
  }

  const availableSides = Math.max(
    SIDEBAR_HARD_MIN * 2,
    safeContainer - mainMinWidth
  )
  const leftFloor =
    availableSides - SIDEBAR_HARD_MIN >= LEFT_PANEL_MIN ? LEFT_PANEL_MIN : SIDEBAR_HARD_MIN
  const rightFloor =
    availableSides - SIDEBAR_HARD_MIN >= RIGHT_PANEL_MIN ? RIGHT_PANEL_MIN : SIDEBAR_HARD_MIN

  let nextLeft = clampWidth(leftWidth, leftFloor, LEFT_PANEL_MAX)
  let nextRight = clampWidth(rightWidth, rightFloor, rightPanelMax)

  if (nextLeft + nextRight > availableSides) {
    const overflow = nextLeft + nextRight - availableSides
    const rightShrink = Math.min(overflow, nextRight - rightFloor)
    nextRight -= rightShrink
    const remaining = overflow - rightShrink
    if (remaining > 0) {
      nextLeft = Math.max(leftFloor, nextLeft - remaining)
    }
  }

  const maxLeft = Math.min(LEFT_PANEL_MAX, availableSides - rightFloor)
  nextLeft = clampWidth(nextLeft, leftFloor, Math.max(leftFloor, maxLeft))
  const maxRight = Math.min(rightPanelMax, availableSides - nextLeft)
  nextRight = clampWidth(nextRight, rightFloor, Math.max(rightFloor, maxRight))

  return { left: nextLeft, right: nextRight }
}
