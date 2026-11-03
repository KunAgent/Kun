import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useAppSurfaceStore } from '../../app-surfaces/app-surface-store'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isWorkerSessionTabId,
  workerSessionTabId,
  type RightPanelContributionId,
  type RightPanelMode
} from '../../extensions/contribution-ids'
import { useReviewStore } from '../../store/review-store'
import { takePlanBuildReview } from '../../store/plan-build-watch'
import { OPEN_WORKERS_PANEL_EVENT } from '../chat/FloatingComposerWorkersPill'
import { OPEN_WORKER_SESSION_EVENT } from '../workers/worker-view-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { useMessageQuoteStore } from '../../store/message-quote-store'

type Params = {
  input: string
  inputRef: RefObject<string>
  prevThreadId: RefObject<string | null>
  activeThreadId: string | null
  activeThreadDesignDocumentId?: string
  activeGuiPlan: unknown
  rightPanelMode: RightPanelMode
  sidePanel: { open: boolean }
  currentSideConversations: Array<{ threadId: string }>
  designWorkspaceRoot: string
  workspaceRoot: string
  fileTreeWorkspaceRoot: string
  filePreviewTarget: unknown
  codeRightTabs: { expanded: boolean; tabs: RightPanelContributionId[] }
  openSideConversationDraft: () => void
  selectSideConversation: (threadId: string) => void
  setSidePanelOpen: (open: boolean) => void
  openFileTreeSidePanel: () => void
  openDesignFileTreeSidePanel: () => void
  openRightPanelTab: (id: RightPanelContributionId) => void
  closeRightPanelTab: (id: RightPanelContributionId) => void
  toggleTerminal: () => void
  collapseRightPanel: () => void
  expandRightPanel: () => void
}

export type CodeRightToolClick = 'open' | 'collapse' | 'toggle-terminal'

/**
 * Decides what a side-rail button click does. Clicking the button of the
 * tool that is already visible collapses the right panel instead of
 * re-opening the same tab, so the rail acts as a toggle.
 */
export function resolveCodeRightToolClick(
  id: RightPanelContributionId,
  rightPanelMode: RightPanelMode
): CodeRightToolClick {
  if (id === BUILTIN_RIGHT_PANEL_IDS.terminal) return 'toggle-terminal'
  return rightPanelMode === id ? 'collapse' : 'open'
}

export function useWorkbenchRightTools({
  input,
  inputRef,
  prevThreadId,
  activeThreadId,
  activeThreadDesignDocumentId,
  activeGuiPlan,
  rightPanelMode,
  sidePanel,
  currentSideConversations,
  designWorkspaceRoot,
  workspaceRoot,
  fileTreeWorkspaceRoot,
  filePreviewTarget,
  codeRightTabs,
  openSideConversationDraft,
  selectSideConversation,
  setSidePanelOpen,
  openFileTreeSidePanel,
  openDesignFileTreeSidePanel,
  openRightPanelTab,
  closeRightPanelTab,
  toggleTerminal,
  collapseRightPanel,
  expandRightPanel
}: Params) {
  useEffect(() => {
    inputRef.current = input
  }, [input, inputRef])

  useEffect(() => {
    const previousThreadId = prevThreadId.current
    prevThreadId.current = activeThreadId
    if (previousThreadId !== null && previousThreadId !== activeThreadId && sidePanel.open) {
      setSidePanelOpen(false)
    }
  }, [activeThreadId, prevThreadId, setSidePanelOpen, sidePanel.open])

  // "Start side conversation" on a selection opens the draft tab; the quote
  // itself already waits in the side draft composer.
  const sideDraftRevealRequest = useMessageQuoteStore((state) => state.sideDraftRevealRequest)
  const handledSideDraftRevealSeq = useRef(sideDraftRevealRequest?.seq ?? 0)
  useEffect(() => {
    if (!sideDraftRevealRequest || sideDraftRevealRequest.seq === handledSideDraftRevealSeq.current) return
    handledSideDraftRevealSeq.current = sideDraftRevealRequest.seq
    if (sideDraftRevealRequest.parentThreadId !== activeThreadId) return
    openSideConversationDraft()
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.sideConversations)
  }, [activeThreadId, openRightPanelTab, openSideConversationDraft, sideDraftRevealRequest])

  // Interactive app pages (Gen UI expand, MCP App surfaces) open as the App tab.
  const appPanelKey = useAppSurfaceStore((state) => state.panel?.key ?? null)
  const previousAppPanelKey = useRef<string | null>(appPanelKey)
  useEffect(() => {
    const previous = previousAppPanelKey.current
    previousAppPanelKey.current = appPanelKey
    if (appPanelKey && appPanelKey !== previous) openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.appSurface)
    if (!appPanelKey && previous) closeRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.appSurface)
  }, [appPanelKey, closeRightPanelTab, openRightPanelTab])
  useEffect(() => {
    const panel = useAppSurfaceStore.getState().panel
    if (panel && panel.threadId !== activeThreadId) useAppSurfaceStore.getState().closePanel()
  }, [activeThreadId])

  const openSideChat = useCallback((): void => {
    const latestSide = currentSideConversations.at(-1)
    if (latestSide) selectSideConversation(latestSide.threadId)
    else openSideConversationDraft()
  }, [currentSideConversations, openSideConversationDraft, selectSideConversation])

  const openWorkspaceFileTreeTab = useCallback((): void => {
    openFileTreeSidePanel()
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.files)
  }, [openFileTreeSidePanel, openRightPanelTab])

  const openDesignFileTreeTab = useCallback((): void => {
    openDesignFileTreeSidePanel()
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.files)
  }, [openDesignFileTreeSidePanel, openRightPanelTab])

  const openDesignDocumentInWhiteboard = useCallback((documentId: string): void => {
    const root = normalizeWorkspaceRoot(designWorkspaceRoot || workspaceRoot)
    if (!activeThreadId || !root) return
    const canonicalDocumentId = activeThreadDesignDocumentId?.trim()
    useCodeCanvasDesignSurface.getState().showDesignDocument(activeThreadId, root, documentId, {
      readOnly: !canonicalDocumentId || canonicalDocumentId !== documentId,
      ...(canonicalDocumentId ? { canonicalDocumentId } : {})
    })
    requestCodeCanvasPanelOpen()
  }, [activeThreadDesignDocumentId, activeThreadId, designWorkspaceRoot, workspaceRoot])

  const openCodeRightTool = useCallback((id: RightPanelContributionId): void => {
    const action = resolveCodeRightToolClick(id, rightPanelMode)
    if (action === 'toggle-terminal') {
      toggleTerminal()
      return
    }
    if (action === 'collapse') {
      if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) setSidePanelOpen(false)
      collapseRightPanel()
      return
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) openSideChat()
    if (id === BUILTIN_RIGHT_PANEL_IDS.files) openFileTreeSidePanel()
    openRightPanelTab(id)
  }, [
    collapseRightPanel,
    openFileTreeSidePanel,
    openRightPanelTab,
    openSideChat,
    rightPanelMode,
    setSidePanelOpen,
    toggleTerminal
  ])

  const closeCodeRightTool = useCallback((id: RightPanelContributionId): void => {
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) setSidePanelOpen(false)
    if (id === BUILTIN_RIGHT_PANEL_IDS.appSurface) useAppSurfaceStore.getState().closePanel()
    closeRightPanelTab(id)
  }, [closeRightPanelTab, setSidePanelOpen])

  const toggleCodeRightWorkspace = useCallback((): void => {
    if (codeRightTabs.expanded) collapseRightPanel()
    else expandRightPanel()
  }, [codeRightTabs.expanded, collapseRightPanel, expandRightPanel])

  // The review tab only exists while the active thread binds a task
  // workspace; the binding lookup itself runs in WorkbenchContent.
  const reviewEnabled = useReviewStore((s) =>
    Boolean(activeThreadId && s.bindings[activeThreadId]))

  // A finished build never replaces the user's current tool panel. Clear
  // its pending flag when the user explicitly visits the combined changes tab.
  const pendingPlanBuildReview = useReviewStore((s) =>
    activeThreadId ? s.pendingPlanBuildReview[activeThreadId] : undefined)
  useEffect(() => {
    if (activeThreadId && pendingPlanBuildReview && codeRightTabs.expanded &&
        rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.changes) takePlanBuildReview(activeThreadId)
  }, [activeThreadId, pendingPlanBuildReview, codeRightTabs.expanded, rightPanelMode])

  // The composer Workers pill asks the workbench to open the panel.
  useEffect(() => {
    const open = (): void => openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.workers)
    window.addEventListener(OPEN_WORKERS_PANEL_EVENT, open)
    return () => window.removeEventListener(OPEN_WORKERS_PANEL_EVENT, open)
  }, [openRightPanelTab])

  // Layout tabs are workspace-scoped, but worker conversations are manager-scoped.
  // Switching managers closes their tabs; missing activity alone never does.
  const workerTabsManager = useRef(activeThreadId)
  useEffect(() => {
    if (workerTabsManager.current === activeThreadId) return
    workerTabsManager.current = activeThreadId
    for (const id of codeRightTabs.tabs) {
      if (isWorkerSessionTabId(id)) closeRightPanelTab(id)
    }
  }, [activeThreadId, codeRightTabs.tabs, closeRightPanelTab])

  // Keep the requested tab visible while its panel resolves membership from
  // the manager's persisted team and live activity, including historical workers.
  useEffect(() => {
    const open = (event: Event): void => {
      const workerId = (event as CustomEvent<{ workerId?: unknown }>).detail?.workerId
      if (typeof workerId !== 'string' || !workerId) return
      if (!activeThreadId) return
      openRightPanelTab(workerSessionTabId(workerId))
    }
    window.addEventListener(OPEN_WORKER_SESSION_EVENT, open)
    return () => window.removeEventListener(OPEN_WORKER_SESSION_EVENT, open)
  }, [activeThreadId, openRightPanelTab])

  useEffect(() => {
    const unavailable: RightPanelContributionId[] = []
    unavailable.push(BUILTIN_RIGHT_PANEL_IDS.agentPerspective)
    if (!activeGuiPlan) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.plan)
    if (!fileTreeWorkspaceRoot) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.files)
    if (!filePreviewTarget) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.file)
    if (!reviewEnabled) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.review)
    if (!activeThreadId) {
      unavailable.push(BUILTIN_RIGHT_PANEL_IDS.sideConversations)
    }
    for (const id of unavailable) {
      if (codeRightTabs.tabs.includes(id)) closeRightPanelTab(id)
    }
  }, [
    activeGuiPlan,
    activeThreadId,
    closeRightPanelTab,
    codeRightTabs.tabs,
    filePreviewTarget,
    fileTreeWorkspaceRoot,
    reviewEnabled
  ])

  return {
    closeCodeRightTool,
    openCodeRightTool,
    openDesignDocumentInWhiteboard,
    openDesignFileTreeTab,
    openSideChat,
    openWorkspaceFileTreeTab,
    toggleCodeRightWorkspace
  }
}
