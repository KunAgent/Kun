import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { AppRoute } from '../store/chat-store-types'
import type { DevPreviewAutoOpenSignal } from '../lib/dev-preview-detection'
import { removeBrowserStorageItem } from '../lib/browser-storage'
import {
  readThreadRightPanelExpansionRegistry,
  rememberThreadRightPanelExpansion,
  saveThreadRightPanelExpansionRegistry
} from '../lib/thread-right-panel-expansion'
import { WORKSPACE_FILE_PREVIEW_EVENT, type WorkspaceFilePreviewDetail } from '../lib/workspace-file-preview'
import {
  CODE_CANVAS_OPEN_REQUEST_EVENT,
  CODE_CANVAS_FOCUS_REQUEST_EVENT,
  canvasOpenRequestDetail
} from '../lib/code-canvas-panel-event'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  type RightPanelMode
} from '../extensions/contribution-ids'
import {
  activateCodeRightTab,
  closeCodeRightTab,
  collapseCodeRightTabs,
  emptyCodeRightTabsState,
  expandCodeRightTabs,
  openCodeRightTab,
  type CodeRightTabsState,
  type StoredCodeRightTabsRegistry
} from './workbench/code-right-tabs-state'
import {
  advancePreviewAutoOpenTracker,
  applyThreadRightPanelExpansion,
  createPreviewAutoOpenTracker,
  transitionCodeRightTabsForThread
} from './workbench/thread-right-panel-state'

export {
  CODE_PANEL_PREFERRED,
  CODE_RIGHT_TABS_KEY,
  CODE_RIGHT_WIDTHS_KEY,
  GRAPH_PANEL_PREFERRED,
  PLAN_BOARD_PREFERRED,
  PANEL_RESIZE_HANDLE_WIDTH,
  RAIL_WIDTH,
  WORKBENCH_RESIZE_CLASS,
  captureResizePointer,
  codeRightTabsWorkspaceScope,
  fitWorkbenchWidths,
  initialCodeRightTabsForLaunch,
  normalizeStoredCodeRightWidthsRegistry,
  transientRightPanelModeForWorkspaceChange,
  workbenchWidthConstraintsForRightPanel,
  type StoredCodeRightWidthsRegistry,
  type WorkbenchWidthConstraints
} from './workbench-layout-storage'
import {
  CODE_PANEL_PREFERRED,
  GRAPH_PANEL_PREFERRED,
  LEFT_PANEL_COLLAPSED_KEY,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_WIDTH_KEY,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_WIDTH_KEY,
  TERMINAL_HEIGHT_DEFAULT,
  TERMINAL_HEIGHT_KEY,
  TERMINAL_HEIGHT_MAX,
  TERMINAL_HEIGHT_MIN,
  TERMINAL_OPEN_KEY,
  WORKBENCH_RESIZE_CLASS,
  captureResizePointer,
  codeRightTabsWorkspaceScope,
  fitWorkbenchWidths,
  initialCodeRightTabsForLaunch,
  persistBoolean,
  persistCodeRightTabsRegistry,
  persistCodeRightWidthsRegistry,
  persistRightPanelMode,
  persistWidth,
  readStoredBoolean,
  readStoredCodeRightTabsRegistry,
  readStoredCodeRightWidthsRegistry,
  readStoredRightPanelMode,
  readStoredWidth,
  transientRightPanelModeForWorkspaceChange,
  workbenchWidthConstraintsForRightPanel
} from './workbench-layout-storage'

export function useWorkbenchLayout({
  activeThreadId,
  designAssistantOpen,
  designImplementOpen,
  latestAutoOpenDevPreviewSignal,
  route,
  threadLoadingId,
  workspaceRoot,
  writeAssistantOpen
}: {
  activeThreadId: string | null
  designAssistantOpen: boolean
  designImplementOpen: boolean
  latestAutoOpenDevPreviewSignal: DevPreviewAutoOpenSignal | null
  route: AppRoute
  threadLoadingId: string | null
  workspaceRoot: string
  writeAssistantOpen: boolean
}) {
  const initialScopeRef = useRef(codeRightTabsWorkspaceScope(workspaceRoot))
  const tabsRegistryRef = useRef(readStoredCodeRightTabsRegistry())
  const widthsRegistryRef = useRef(readStoredCodeRightWidthsRegistry())
  const threadExpansionRegistryRef = useRef(readThreadRightPanelExpansionRegistry())
  const legacyModeRef = useRef(readStoredRightPanelMode())
  const [codeRightTabs, setCodeRightTabs] = useState<CodeRightTabsState>(() => {
    const stored = tabsRegistryRef.current.workspaces[initialScopeRef.current]
    return applyThreadRightPanelExpansion(
      initialCodeRightTabsForLaunch(stored, legacyModeRef.current),
      activeThreadId,
      threadExpansionRegistryRef.current
    )
  })
  const codeRightTabsRef = useRef(codeRightTabs)
  codeRightTabsRef.current = codeRightTabs
  const codeRightTabsOwnerThreadIdRef = useRef(activeThreadId)
  const [transientRightPanelMode, setTransientRightPanelMode] = useState<RightPanelMode>(null)
  // Transient presentation state: the focused whiteboard expands the SAME
  // canvas panel over the stage instead of widening the right rail. Never
  // persisted; a restart returns to the ordinary workbench layout.
  const [canvasFocusMode, setCanvasFocusMode] = useState(false)
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
  const layoutThreadIdRef = useRef<string | null>(activeThreadId)
  const previewAutoOpenTrackerRef = useRef(createPreviewAutoOpenTracker({
    threadId: activeThreadId,
    threadLoadingId,
    signal: latestAutoOpenDevPreviewSignal
  }))
  const rightPanelMode = route === 'chat'
    ? transientRightPanelMode ?? (codeRightTabs.expanded ? codeRightTabs.activeId : null)
    : null
  const rightPanelVisible = route === 'write'
    ? writeAssistantOpen
    : route === 'design'
      ? designAssistantOpen || designImplementOpen
      : codeRightTabs.expanded || rightPanelMode !== null
  const widthConstraints = workbenchWidthConstraintsForRightPanel(route, rightPanelMode)
  useEffect(() => {
    if (rightPanelMode !== BUILTIN_RIGHT_PANEL_IDS.graph) return
    setRightSidebarWidth((width) => Math.max(width, GRAPH_PANEL_PREFERRED))
  }, [rightPanelMode])
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
    const ownerThreadId = codeRightTabsOwnerThreadIdRef.current
    if (ownerThreadId) {
      threadExpansionRegistryRef.current = rememberThreadRightPanelExpansion(
        ownerThreadId,
        codeRightTabs.expanded,
        threadExpansionRegistryRef.current
      )
      saveThreadRightPanelExpansionRegistry(threadExpansionRegistryRef.current)
    }
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
    setTransientRightPanelMode(transientRightPanelModeForWorkspaceChange)
    const nextTabs = applyThreadRightPanelExpansion(
      tabsRegistryRef.current.workspaces[nextScope] ?? emptyCodeRightTabsState(),
      activeThreadId,
      threadExpansionRegistryRef.current
    )
    setCodeRightTabs(nextTabs)
    const nextWidth = widthsRegistryRef.current.workspaces[nextScope]
    if (nextWidth) setRightSidebarWidth(nextWidth)
    else if (nextTabs.expanded) {
      setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    }
  }, [activeThreadId, codeRightTabs, workspaceRoot])

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
    const onCanvasOpenRequest = (event: Event): void => {
      if (canvasOpenRequestDetail(event)?.target === 'write') return
      ensureInitialCodePanelWidth()
      setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.canvas))
    }

    window.addEventListener(CODE_CANVAS_OPEN_REQUEST_EVENT, onCanvasOpenRequest)
    return () => window.removeEventListener(CODE_CANVAS_OPEN_REQUEST_EVENT, onCanvasOpenRequest)
  }, [ensureInitialCodePanelWidth])

  useEffect(() => {
    const onCanvasFocusRequest = (): void => {
      // Presentation-only: activate the canvas tab and switch the stage into
      // the focused whiteboard presentation. The bound document, board, and
      // canvas state stay untouched, and the persisted right-rail width is
      // preserved for the moment focus exits.
      ensureInitialCodePanelWidth()
      setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.canvas))
      setCanvasFocusMode(true)
    }
    window.addEventListener(CODE_CANVAS_FOCUS_REQUEST_EVENT, onCanvasFocusRequest)
    return () => window.removeEventListener(CODE_CANVAS_FOCUS_REQUEST_EVENT, onCanvasFocusRequest)
  }, [ensureInitialCodePanelWidth])

  useEffect(() => {
    if (layoutThreadIdRef.current === activeThreadId) return
    layoutThreadIdRef.current = activeThreadId
    codeRightTabsOwnerThreadIdRef.current = activeThreadId
    setCanvasFocusMode(false)
    setCodeRightTabs((current) => transitionCodeRightTabsForThread(
      current,
      activeThreadId,
      threadExpansionRegistryRef.current
    ))
  }, [activeThreadId])

  useEffect(() => {
    const transition = advancePreviewAutoOpenTracker(previewAutoOpenTrackerRef.current, {
      threadId: activeThreadId,
      threadLoadingId,
      signal: latestAutoOpenDevPreviewSignal
    })
    previewAutoOpenTrackerRef.current = transition.tracker
    if (!transition.shouldOpen || route !== 'chat') return
    ensureInitialCodePanelWidth()
    setCodeRightTabs((current) => openCodeRightTab(current, BUILTIN_RIGHT_PANEL_IDS.browser))
  }, [
    activeThreadId,
    ensureInitialCodePanelWidth,
    latestAutoOpenDevPreviewSignal,
    route,
    threadLoadingId
  ])

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
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.browser)
  }

  const exitCanvasFocusMode = useCallback((): void => {
    setCanvasFocusMode(false)
  }, [])

  // Focused presentation only makes sense while the canvas tab exists on the
  // chat route. Closing the tab or switching routes exits focus so the stage
  // can never pin a stale whiteboard over the UI.
  const canvasTabStillOpen = codeRightTabs.tabs.includes(BUILTIN_RIGHT_PANEL_IDS.canvas)
  useEffect(() => {
    if (!canvasFocusMode) return
    if (route !== 'chat' || !canvasTabStillOpen) setCanvasFocusMode(false)
  }, [canvasFocusMode, canvasTabStillOpen, route])

  const focusWorkspaceScopeRef = useRef(codeRightTabsWorkspaceScope(workspaceRoot))
  useEffect(() => {
    const nextScope = codeRightTabsWorkspaceScope(workspaceRoot)
    if (nextScope === focusWorkspaceScopeRef.current) return
    focusWorkspaceScopeRef.current = nextScope
    setCanvasFocusMode(false)
  }, [workspaceRoot])

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
    canvasFocusMode,
    codeRightTabs,
    activateRightPanelTab,
    closeRightPanelTab,
    collapseRightPanel,
    expandRightPanel,
    exitCanvasFocusMode,
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
