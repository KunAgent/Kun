import { useCallback, useEffect, type RefObject } from 'react'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  type RightPanelContributionId,
  type RightPanelMode
} from '../../extensions/contribution-ids'
import { useReviewStore } from '../../store/review-store'
import { takePlanBuildReview } from '../../store/plan-build-watch'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { selectWorkerRowsForParent } from '../../store/activity-selectors'
import { OPEN_WORKERS_PANEL_EVENT } from '../chat/FloatingComposerWorkersPill'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'

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
    closeRightPanelTab(id)
  }, [closeRightPanelTab, setSidePanelOpen])

  const toggleCodeRightWorkspace = useCallback((): void => {
    if (codeRightTabs.expanded) collapseRightPanel()
    else expandRightPanel()
  }, [codeRightTabs.expanded, collapseRightPanel, expandRightPanel])

  // The review tab only exists while the active thread binds a task
  // workspace (11 §3); the binding lookup itself runs in WorkbenchContent.
  const reviewEnabled = useReviewStore((s) =>
    Boolean(activeThreadId && s.bindings[activeThreadId]))
  // Workers panel (12 §6.1, p4 §3.7): stays available for the whole ADE
  // session — manager sessions open it by default before any worker rows
  // exist, and worker threads keep it while their siblings run.
  const activeThreadIsAde = useChatStore((s) =>
    Boolean(
      activeThreadId &&
      (s.adeThreads ?? []).some((thread) => thread.id === activeThreadId)
    ))
  const hasWorkerRows = useActivityStore((s) =>
    Boolean(activeThreadId && selectWorkerRowsForParent(s.rows, activeThreadId).length > 0))
  const workersEnabled = activeThreadIsAde || hasWorkerRows

  // External-harness plan builds (07 §10): when the build turn settles the
  // watcher flags the thread; once the review binding is live, open the tab
  // so the user chooses the integration mode. The flag survives navigation —
  // returning to the thread still surfaces the finished build.
  const pendingPlanBuildReview = useReviewStore((s) =>
    activeThreadId ? s.pendingPlanBuildReview[activeThreadId] : undefined)
  useEffect(() => {
    if (!activeThreadId || !pendingPlanBuildReview || !reviewEnabled) return
    takePlanBuildReview(activeThreadId)
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.review)
  }, [activeThreadId, pendingPlanBuildReview, reviewEnabled, openRightPanelTab])

  // The composer Workers pill asks the workbench to open the panel (12 §6.1).
  useEffect(() => {
    const open = (): void => openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.workers)
    window.addEventListener(OPEN_WORKERS_PANEL_EVENT, open)
    return () => window.removeEventListener(OPEN_WORKERS_PANEL_EVENT, open)
  }, [openRightPanelTab])

  useEffect(() => {
    const unavailable: RightPanelContributionId[] = []
    unavailable.push(BUILTIN_RIGHT_PANEL_IDS.agentPerspective)
    if (!activeGuiPlan) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.plan)
    if (!fileTreeWorkspaceRoot) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.files)
    if (!filePreviewTarget) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.file)
    if (!reviewEnabled) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.review)
    if (!workersEnabled) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.workers)
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
    reviewEnabled,
    workersEnabled
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
