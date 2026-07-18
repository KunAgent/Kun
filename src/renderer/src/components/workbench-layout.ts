import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { AppRoute } from '../store/chat-store-types'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import { WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from '../lib/workspace-file-preview'
import { CODE_CANVAS_OPEN_REQUEST_EVENT } from '../lib/code-canvas-panel-event'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isRightPanelContributionId,
  normalizeStoredRightPanelId,
  type RightPanelMode
} from '../extensions/contribution-ids'
import {
  activateCodeRightTab,
  closeCodeRightTab,
  collapseCodeRightTabs,
  emptyCodeRightTabsState,
  expandCodeRightTabs,
  normalizeStoredCodeRightTabsRegistry,
  openCodeRightTab,
  type CodeRightTabsState,
  type StoredCodeRightTabsRegistry
} from './workbench/code-right-tabs-state'

const LEFT_PANEL_WIDTH_KEY = 'kun.layout.leftSidebarWidth'
const LEFT_PANEL_COLLAPSED_KEY = 'kun.layout.leftSidebarCollapsed'
const RIGHT_PANEL_WIDTH_KEY = 'kun.layout.rightInspectorWidth'
const RIGHT_PANEL_MODE_KEY = 'kun.layout.rightPanelMode'
export const CODE_RIGHT_TABS_KEY = 'kun.layout.codeRightTabs.v1'
export const CODE_RIGHT_WIDTHS_KEY = 'kun.layout.codeRightWidths.v1'
const TERMINAL_OPEN_KEY = 'kun.layout.terminalOpen'
const TERMINAL_HEIGHT_KEY = 'kun.layout.terminalHeight'
const LEFT_PANEL_DEFAULT = 304
const RIGHT_PANEL_DEFAULT = 360
export const CODE_PANEL_PREFERRED = 560
const LEFT_PANEL_MIN = 280
const LEFT_PANEL_MAX = 480
const RIGHT_PANEL_MIN = 280
const RIGHT_PANEL_MAX = 760
const SIDEBAR_HARD_MIN = 180
const MAIN_MIN_WIDTH = 560
const PANEL_RESIZE_HANDLE_WIDTH = 5
export const RAIL_WIDTH = 48
export const WORKBENCH_RESIZE_CLASS = 'ds-workbench-resizing'
const TERMINAL_HEIGHT_DEFAULT = 360
const TERMINAL_HEIGHT_MIN = 220
const TERMINAL_HEIGHT_MAX = 760

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

function readStoredWidth(key: string, fallback: number): number {
  const raw = readBrowserStorageItem(key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

function persistWidth(key: string, width: number): void {
  writeBrowserStorageItem(key, String(Math.round(width)))
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = readBrowserStorageItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

function persistBoolean(key: string, value: boolean): void {
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

function readStoredRightPanelMode(): RightPanelMode {
  const raw = readBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  return normalizeStoredRightPanelId(raw)
}

function persistRightPanelMode(mode: RightPanelMode): void {
  if (mode !== null && isRightPanelContributionId(mode)) {
    writeBrowserStorageItem(RIGHT_PANEL_MODE_KEY, mode)
  } else {
    removeBrowserStorageItem(RIGHT_PANEL_MODE_KEY)
  }
}

export function codeRightTabsWorkspaceScope(workspaceRoot: string): string {
  return workspaceRootScopeKey(workspaceRoot) || '__global__'
}

function readStoredCodeRightTabsRegistry(): StoredCodeRightTabsRegistry {
  const raw = readBrowserStorageItem(CODE_RIGHT_TABS_KEY)
  if (!raw) return normalizeStoredCodeRightTabsRegistry(null)
  try {
    return normalizeStoredCodeRightTabsRegistry(JSON.parse(raw))
  } catch {
    return normalizeStoredCodeRightTabsRegistry(null)
  }
}

function persistCodeRightTabsRegistry(registry: StoredCodeRightTabsRegistry): void {
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

function readStoredCodeRightWidthsRegistry(): StoredCodeRightWidthsRegistry {
  const raw = readBrowserStorageItem(CODE_RIGHT_WIDTHS_KEY)
  if (!raw) return normalizeStoredCodeRightWidthsRegistry(null)
  try {
    return normalizeStoredCodeRightWidthsRegistry(JSON.parse(raw))
  } catch {
    return normalizeStoredCodeRightWidthsRegistry(null)
  }
}

function persistCodeRightWidthsRegistry(registry: StoredCodeRightWidthsRegistry): void {
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

export function useWorkbenchLayout({
  activeThreadId,
  designAssistantOpen,
  designImplementOpen,
  latestAutoOpenDevPreviewUrl,
  latestDevPreviewUrl,
  route,
  workspaceRoot,
  writeAssistantOpen
}: {
  activeThreadId: string | null
  designAssistantOpen: boolean
  designImplementOpen: boolean
  latestAutoOpenDevPreviewUrl: string | null
  latestDevPreviewUrl: string | null
  route: AppRoute
  workspaceRoot: string
  writeAssistantOpen: boolean
}) {
  const initialScopeRef = useRef(codeRightTabsWorkspaceScope(workspaceRoot))
  const tabsRegistryRef = useRef(readStoredCodeRightTabsRegistry())
  const widthsRegistryRef = useRef(readStoredCodeRightWidthsRegistry())
  const legacyModeRef = useRef(readStoredRightPanelMode())
  const [codeRightTabs, setCodeRightTabs] = useState<CodeRightTabsState>(() => {
    const stored = tabsRegistryRef.current.workspaces[initialScopeRef.current]
    return initialCodeRightTabsForLaunch(stored, legacyModeRef.current)
  })
  const codeRightTabsRef = useRef(codeRightTabs)
  codeRightTabsRef.current = codeRightTabs
  const [transientRightPanelMode, setTransientRightPanelMode] = useState<RightPanelMode>(null)
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readStoredWidth(LEFT_PANEL_WIDTH_KEY, LEFT_PANEL_DEFAULT)
  )
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() =>
    readStoredBoolean(LEFT_PANEL_COLLAPSED_KEY, false)
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const scoped = widthsRegistryRef.current.workspaces[initialScopeRef.current]
    if (scoped) return scoped
    const legacy = readStoredWidth(RIGHT_PANEL_WIDTH_KEY, RIGHT_PANEL_DEFAULT)
    return codeRightTabs.expanded ? Math.max(legacy, CODE_PANEL_PREFERRED) : legacy
  })
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() =>
    readStoredWidth(TERMINAL_HEIGHT_KEY, TERMINAL_HEIGHT_DEFAULT)
  )
  const shellRef = useRef<HTMLDivElement | null>(null)
  const previewThreadId = useRef<string | null>(activeThreadId)
  const autoOpenedPreviewUrlRef = useRef<string | null>(null)
  const rightPanelMode = route === 'chat'
    ? transientRightPanelMode ?? (codeRightTabs.expanded ? codeRightTabs.activeId : null)
    : null
  const rightPanelVisible = route === 'write'
    ? writeAssistantOpen
    : route === 'design'
      ? designAssistantOpen || designImplementOpen
      : codeRightTabs.expanded || rightPanelMode !== null
  const widthConstraints = workbenchWidthConstraintsForRightPanel(route, rightPanelMode)
  const ensureInitialCodePanelWidth = useCallback((): void => {
    if (codeRightTabsRef.current.tabs.length === 0) {
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    }
  }, [])

  useEffect(() => {
    persistWidth(LEFT_PANEL_WIDTH_KEY, leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    persistBoolean(LEFT_PANEL_COLLAPSED_KEY, leftSidebarCollapsed)
  }, [leftSidebarCollapsed])

  useEffect(() => {
    persistWidth(RIGHT_PANEL_WIDTH_KEY, rightSidebarWidth)
    const scope = initialScopeRef.current
    widthsRegistryRef.current = {
      version: 1,
      workspaces: {
        ...widthsRegistryRef.current.workspaces,
        [scope]: rightSidebarWidth
      }
    }
    persistCodeRightWidthsRegistry(widthsRegistryRef.current)
  }, [rightSidebarWidth])

  useEffect(() => {
    const scope = initialScopeRef.current
    tabsRegistryRef.current = {
      version: 1,
      workspaces: {
        ...tabsRegistryRef.current.workspaces,
        [scope]: codeRightTabs
      }
    }
    persistCodeRightTabsRegistry(tabsRegistryRef.current)
    persistRightPanelMode(codeRightTabs.expanded ? codeRightTabs.activeId : null)
  }, [codeRightTabs])

  useEffect(() => {
    const nextScope = codeRightTabsWorkspaceScope(workspaceRoot)
    const previousScope = initialScopeRef.current
    if (nextScope === previousScope) return
    tabsRegistryRef.current = {
      version: 1,
      workspaces: {
        ...tabsRegistryRef.current.workspaces,
        [previousScope]: codeRightTabs
      }
    }
    initialScopeRef.current = nextScope
    setTransientRightPanelMode(null)
    const nextTabs = tabsRegistryRef.current.workspaces[nextScope] ?? emptyCodeRightTabsState()
    setCodeRightTabs(nextTabs)
    const nextWidth = widthsRegistryRef.current.workspaces[nextScope]
    if (nextWidth) setRightSidebarWidth(nextWidth)
    else if (nextTabs.expanded) {
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    }
  }, [codeRightTabs, workspaceRoot])

  useEffect(() => {
    removeBrowserStorageItem(TERMINAL_OPEN_KEY)
  }, [])

  useEffect(() => {
    persistWidth(TERMINAL_HEIGHT_KEY, terminalHeight)
  }, [terminalHeight])

  useEffect(() => {
    const onPreview = (event: Event): void => {
      const detail = (event as CustomEvent<WorkspaceFilePreviewDetail>).detail
      if (!detail?.path) return
      setFilePreviewTarget({
        ...detail,
        workspaceRoot: detail.workspaceRoot ?? workspaceRoot
      })
      ensureInitialCodePanelWidth()
      setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.file))
    }

    window.addEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(WORKSPACE_FILE_PREVIEW_EVENT, onPreview)
  }, [ensureInitialCodePanelWidth, workspaceRoot])

  useEffect(() => {
    const onCanvasOpenRequest = (): void => {
      ensureInitialCodePanelWidth()
      setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.canvas))
    }

    window.addEventListener(CODE_CANVAS_OPEN_REQUEST_EVENT, onCanvasOpenRequest)
    return () => window.removeEventListener(CODE_CANVAS_OPEN_REQUEST_EVENT, onCanvasOpenRequest)
  }, [ensureInitialCodePanelWidth])

  useEffect(() => {
    if (previewThreadId.current === activeThreadId) return
    previewThreadId.current = activeThreadId
    autoOpenedPreviewUrlRef.current = null
    setCodeRightTabs((current) => {
      let next = closeCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.browser)
      next = closeCodeRightTab(next, BUILTIN_RIGHT_PANEL_IDS.sideConversations)
      next = closeCodeRightTab(next, BUILTIN_RIGHT_PANEL_IDS.plan)
      return next
    })
  }, [activeThreadId])

  useEffect(() => {
    if (!latestAutoOpenDevPreviewUrl || route !== 'chat') return
    if (autoOpenedPreviewUrlRef.current === latestAutoOpenDevPreviewUrl) return
    autoOpenedPreviewUrlRef.current = latestAutoOpenDevPreviewUrl
    ensureInitialCodePanelWidth()
    setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.browser))
  }, [ensureInitialCodePanelWidth, latestAutoOpenDevPreviewUrl, route])

  useLayoutEffect(() => {
    const sync = (): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const next = fitWorkbenchWidths(
        containerWidth,
        leftSidebarWidth,
        rightSidebarWidth,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible
        },
        widthConstraints
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [
    leftSidebarCollapsed,
    leftSidebarWidth,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    route,
    widthConstraints
  ])

  const openRightPanelTab = useCallback((id: Exclude<RightPanelMode, null>): void => {
    setTransientRightPanelMode(null)
    ensureInitialCodePanelWidth()
    setCodeRightTabs((current) => openCodeRightTab(current, id))
  }, [ensureInitialCodePanelWidth])

  const activateRightPanelTab = useCallback((id: Exclude<RightPanelMode, null>): void => {
    setTransientRightPanelMode(null)
    setCodeRightTabs((current) => activateCodeRightTab(current, id))
  }, [])

  const closeRightPanelTab = useCallback((id: Exclude<RightPanelMode, null>): void => {
    setCodeRightTabs((current) => closeCodeRightTab(current, id))
  }, [])

  const collapseRightPanel = useCallback((): void => {
    if (transientRightPanelMode) {
      setTransientRightPanelMode(null)
      return
    }
    setCodeRightTabs((current) => collapseCodeRightTabs(current))
  }, [transientRightPanelMode])

  const expandRightPanel = useCallback((): void => {
    ensureInitialCodePanelWidth()
    setCodeRightTabs((current) => expandCodeRightTabs(current))
  }, [ensureInitialCodePanelWidth])

  const setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>> = useCallback((value) => {
    const currentMode = transientRightPanelMode ?? (codeRightTabs.expanded ? codeRightTabs.activeId : null)
    const nextMode = typeof value === 'function' ? value(currentMode) : value
    if (nextMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) {
      setTransientRightPanelMode(nextMode)
      return
    }
    if (nextMode === null) {
      if (transientRightPanelMode) setTransientRightPanelMode(null)
      else setCodeRightTabs((current) => collapseCodeRightTabs(current))
      return
    }
    openRightPanelTab(nextMode)
  }, [codeRightTabs.activeId, codeRightTabs.expanded, openRightPanelTab, transientRightPanelMode])

  const toggleRightPanelMode = (nextMode: Exclude<RightPanelMode, null>): void => {
    openRightPanelTab(nextMode)
  }

  const toggleLeftSidebar = (): void => {
    setLeftSidebarCollapsed((current) => !current)
  }

  const openDevPreview = (): void => {
    if (latestDevPreviewUrl) {
      autoOpenedPreviewUrlRef.current = latestDevPreviewUrl
    }
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.browser)
  }

  const beginLeftResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leftSidebarCollapsed || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const releasePointer = captureResizePointer(event.currentTarget, event.pointerId)
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.classList.add(WORKBENCH_RESIZE_CLASS)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft + delta,
        startRight,
        {
          leftPanelVisible: true,
          rightPanelVisible
        },
        widthConstraints
      )
      setLeftSidebarWidth(next.left)
      if (next.right !== rightSidebarWidth) setRightSidebarWidth(next.right)
    }

    const onEnd = (): void => {
      releasePointer()
      document.body.classList.remove(WORKBENCH_RESIZE_CLASS)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const beginRightResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !rightPanelVisible) return
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftSidebarWidth
    const startRight = rightSidebarWidth
    const releasePointer = captureResizePointer(event.currentTarget, event.pointerId)
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.classList.add(WORKBENCH_RESIZE_CLASS)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = shellRef.current?.clientWidth ?? window.innerWidth
      const delta = moveEvent.clientX - startX
      const next = fitWorkbenchWidths(
        containerWidth,
        startLeft,
        startRight - delta,
        {
          leftPanelVisible: !leftSidebarCollapsed,
          rightPanelVisible: true
        },
        widthConstraints
      )
      if (next.left !== leftSidebarWidth) setLeftSidebarWidth(next.left)
      setRightSidebarWidth(next.right)
    }

    const onEnd = (): void => {
      releasePointer()
      document.body.classList.remove(WORKBENCH_RESIZE_CLASS)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const beginTerminalResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !terminalOpen) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = terminalHeight
    const releasePointer = captureResizePointer(event.currentTarget, event.pointerId)
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.classList.add(WORKBENCH_RESIZE_CLASS)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerHeight = shellRef.current?.clientHeight ?? window.innerHeight
      const delta = startY - moveEvent.clientY
      const maxHeight = Math.max(
        TERMINAL_HEIGHT_MIN,
        Math.min(TERMINAL_HEIGHT_MAX, containerHeight - 260)
      )
      setTerminalHeight(Math.min(
        Math.max(startHeight + delta, TERMINAL_HEIGHT_MIN),
        maxHeight
      ))
    }

    const onEnd = (): void => {
      releasePointer()
      document.body.classList.remove(WORKBENCH_RESIZE_CLASS)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const toggleTerminal = (): void => {
    setTerminalOpen((current) => !current)
  }

  return {
    beginLeftResize,
    beginRightResize,
    beginTerminalResize,
    codeRightTabs,
    activateRightPanelTab,
    closeRightPanelTab,
    collapseRightPanel,
    expandRightPanel,
    filePreviewTarget,
    leftSidebarCollapsed,
    leftSidebarWidth,
    openDevPreview,
    openRightPanelTab,
    rightPanelMode,
    rightPanelVisible,
    rightSidebarWidth,
    setFilePreviewTarget,
    setRightPanelMode,
    setRightSidebarWidth,
    shellRef,
    terminalHeight,
    terminalOpen,
    toggleLeftSidebar,
    toggleRightPanelMode,
    toggleTerminal
  }
}
