import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { NormalizedThread, RuntimeConnectionStatus } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import type { ChatState } from '../../store/chat-store-types'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import { markSddAssistantThread } from '../../sdd/sdd-thread-registry'
import {
  designDocRefForThreadId,
  readDesignThreadRegistry,
  type DesignThreadRegistry
} from '../../design/design-thread-registry'
import { isDesignWorkbenchThread } from '../../design/design-task-classification'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { normalizeWorkspaceRoot, workspaceRootScopeKey } from '../../lib/workspace-path'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  workbenchTaskIntentScope,
  writeWorkbenchTaskIntent,
  DEFAULT_WORKBENCH_DESIGN_PROFILE
} from './workbench-task-intent'

export type WorkbenchSidebarView = 'chat' | 'write' | 'claw' | 'board' | 'schedule' | 'workflow' | 'subagents'

export type UseWorkbenchNavigationControllerParams = {
  activeSddDraft: boolean
  activeThreadId: string | null
  pluginHostRoute: ChatState['pluginHostRoute']
  rightPanelMode: RightPanelMode
  route: ChatState['route']
  runtimeConnection: RuntimeConnectionStatus
  sddDraftContent: string
  threads: NormalizedThread[]
  useWorktreePool: boolean
  workspaceRoot: string
  worktreeBranch: string
  archiveThread?: ChatState['archiveThread']
  clearFilePreviewTargets: () => void
  createConversation: ChatState['createConversation']
  createThread: ChatState['createThread']
  createWriteThread: ChatState['createWriteThread']
  dismissActiveSddDraft: (options?: { closeAssistant?: boolean }) => void
  ensureWriteThreadForWorkspace: ChatState['ensureWriteThreadForWorkspace']
  findSddDraftForSidebarThread: (
    threadId: string,
    thread: NormalizedThread | null
  ) => Promise<SddDraft | null>
  openClaw: ChatState['openClaw']
  openBoard: ChatState['openBoard']
  openCode: ChatState['openCode']
  openPlugins: ChatState['openPlugins']
  openSchedule: ChatState['openSchedule']
  openWorkflow: ChatState['openWorkflow']
  openWrite: ChatState['openWrite']
  selectThread: ChatState['selectThread']
  setConnectPhoneSidebarOpen: Dispatch<SetStateAction<boolean>>
  setDesignAssistantOpen: (open: boolean) => void
  setFilePreviewTarget: (target: WorkspaceFileTarget | null) => void
  setInput: (value: string) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setRoute: ChatState['setRoute']
  setUseWorktreePool: Dispatch<SetStateAction<boolean>>
  setWriteAssistantOpen: (open: boolean) => void
}

export type WorkbenchNavigationController = {
  closeRightPanel: () => void
  exploreSddRequirementInDesign: () => void
  openCodeMode: () => void
  openPluginsView: () => void
  openBoardView: () => void
  openExtensionsView: () => void
  openScheduleView: () => void
  openThread: (id: string) => void
  openWorkflowView: () => void
  openWriteMode: () => void
  pickWriteAssistantWorkspace: () => Promise<void>
  sidebarView: WorkbenchSidebarView
  startNewChat: () => void
  startNewChatInWorkspace: (
    workspaceRoot: string,
    options?: { forceNew?: boolean }
  ) => Promise<string | null>
  startNewConversation: () => void
  startNewWriteAssistantConversation: () => void
  toggleConnectPhone: () => void
}

export function isWorkbenchDesignThread(
  threadId: string,
  thread: NormalizedThread | null,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): boolean {
  return isDesignWorkbenchThread(threadId, thread, registry)
}

type WorkbenchDesignDocumentRef = {
  workspaceRoot: string
  docId: string
  boardArtifactId?: string
}

export function designDocumentRefForWorkbenchThread(
  threadId: string,
  thread: NormalizedThread | null,
  registry: DesignThreadRegistry = readDesignThreadRegistry()
): WorkbenchDesignDocumentRef | null {
  // Registry-owned threads belong to the legacy standalone Design workflow.
  // Keep their existing document binding authoritative and never rewrite it
  // from newer optional runtime metadata.
  const legacyRef = designDocRefForThreadId(threadId, registry)
  if (legacyRef) return legacyRef
  if (!thread?.designProfile) return null

  const workspaceRoot = normalizeWorkspaceRoot(thread.workspace)
  const docId = thread.designProfile.documentTarget.documentId.trim()
  const boardArtifactId = thread.designProfile.documentTarget.boardArtifactId.trim()
  return workspaceRoot && docId && boardArtifactId
    ? { workspaceRoot, docId, boardArtifactId }
    : null
}

export function useWorkbenchNavigationController({
  activeSddDraft,
  activeThreadId,
  pluginHostRoute,
  rightPanelMode,
  route,
  runtimeConnection,
  sddDraftContent,
  threads,
  useWorktreePool,
  workspaceRoot,
  worktreeBranch,
  clearFilePreviewTargets,
  createConversation,
  createThread,
  createWriteThread,
  dismissActiveSddDraft,
  ensureWriteThreadForWorkspace,
  findSddDraftForSidebarThread,
  openClaw,
  openBoard,
  openCode,
  openPlugins,
  openSchedule,
  openWorkflow,
  openWrite,
  selectThread,
  setConnectPhoneSidebarOpen,
  setDesignAssistantOpen,
  setFilePreviewTarget,
  setInput,
  setRightPanelMode,
  setRoute,
  setUseWorktreePool,
  setWriteAssistantOpen
}: UseWorkbenchNavigationControllerParams): WorkbenchNavigationController {
  const connectPhoneReturnRouteRef = useRef<ChatState['route']>('chat')
  const navigationRequestRef = useRef(0)
  const beginNavigation = useCallback((): number => ++navigationRequestRef.current, [])
  const navigationIsCurrent = useCallback(
    (requestId: number): boolean => navigationRequestRef.current === requestId,
    []
  )

  useEffect(() => {
    if (route !== 'claw') {
      connectPhoneReturnRouteRef.current = route === 'design' ? 'chat' : route
    }
  }, [route])

  const sidebarView: WorkbenchSidebarView = useMemo(() => {
    if (route === 'claw' || (route === 'plugins' && pluginHostRoute === 'claw')) return 'claw'
    if (route === 'schedule') return 'schedule'
    if (route === 'board') return 'board'
    if (route === 'workflow') return 'workflow'
    if (route === 'write') return 'write'
    return 'chat'
  }, [pluginHostRoute, route])

  const openThread = useCallback((id: string): void => {
    const requestId = beginNavigation()
    const isCurrentRequest = (): boolean => navigationIsCurrent(requestId)
    setConnectPhoneSidebarOpen(false)
    void (async () => {
      const thread = threads.find((item) => item.id === id) ?? null
      const designRegistry = readDesignThreadRegistry()
      if (isWorkbenchDesignThread(id, thread, designRegistry)) {
        const cachedDesignRef = (): WorkbenchDesignDocumentRef | null => {
          const cachedSurface = useCodeCanvasDesignSurface.getState().surface
          return cachedSurface?.threadId === id
            ? {
                workspaceRoot: cachedSurface.workspaceRoot,
                docId: cachedSurface.documentId
              }
            : null
        }
        let designRef: WorkbenchDesignDocumentRef | null =
          designDocumentRefForWorkbenchThread(id, thread, designRegistry) ??
          cachedDesignRef()

        if (useSddDraftStore.getState().activeDraft) {
          dismissActiveSddDraft({ closeAssistant: true })
        }
        setRoute('chat')
        if (designRef) {
          useCodeCanvasDesignSurface.getState().showDesignDocument(
            id,
            designRef.workspaceRoot,
            designRef.docId
          )
        }
        // Even an unlocked Design task without a committed profile belongs to
        // the Code workbench. Open the whiteboard now; its provisional binding
        // can arrive on the first accepted turn without changing routes.
        requestCodeCanvasPanelOpen()
        await selectThread(id, { selectionGuard: isCurrentRequest })
        if (!isCurrentRequest()) return
        if (!designRef) {
          const hydratedThread = useChatStore.getState().threads.find((item) => item.id === id) ?? null
          designRef = designDocumentRefForWorkbenchThread(id, hydratedThread, designRegistry) ??
            cachedDesignRef()
          if (designRef) {
            useCodeCanvasDesignSurface.getState().showDesignDocument(
              id,
              designRef.workspaceRoot,
              designRef.docId
            )
          }
        }
        if (!designRef) {
          const hydratedThread = useChatStore.getState().threads.find((item) => item.id === id) ?? thread
          const fallbackWorkspace = normalizeWorkspaceRoot(hydratedThread?.workspace)
          if (fallbackWorkspace) {
            const designStore = useDesignWorkspaceStore.getState()
            designStore.setWorkspaceRoot(fallbackWorkspace)
            await useDesignWorkspaceStore.getState().rehydrateArtifacts().catch(() => undefined)
            if (!isCurrentRequest()) return
            const restoredState = useDesignWorkspaceStore.getState()
            const restoredRef = designDocumentRefForWorkbenchThread(
              id,
              hydratedThread,
              readDesignThreadRegistry()
            )
            const restoredDocumentId = restoredRef?.docId ?? restoredState.activeDocumentId
            if (restoredDocumentId) {
              designRef = {
                workspaceRoot: restoredRef?.workspaceRoot ?? fallbackWorkspace,
                docId: restoredDocumentId,
                ...(restoredRef?.boardArtifactId
                  ? { boardArtifactId: restoredRef.boardArtifactId }
                  : {})
              }
              useCodeCanvasDesignSurface.getState().showDesignDocument(
                id,
                designRef.workspaceRoot,
                designRef.docId
              )
            }
          }
        }
        if (!designRef) return

        const designStore = useDesignWorkspaceStore.getState()
        designStore.setWorkspaceRoot(designRef.workspaceRoot)
        if (!useDesignWorkspaceStore.getState().documents.some(
          (document) => document.id === designRef.docId
        )) {
          await useDesignWorkspaceStore.getState().rehydrateArtifacts().catch(() => undefined)
        }
        if (!isCurrentRequest()) return
        const restoredDesignStore = useDesignWorkspaceStore.getState()
        if (restoredDesignStore.documents.some((document) => document.id === designRef.docId)) {
          restoredDesignStore.switchActiveDocument(designRef.docId)
          const activeDesignStore = useDesignWorkspaceStore.getState()
          if (
            designRef.boardArtifactId &&
            activeDesignStore.artifacts.some((artifact) => artifact.id === designRef.boardArtifactId)
          ) {
            activeDesignStore.setActiveArtifact(designRef.boardArtifactId)
          }
        }
        return
      }
      const sddDraft = await findSddDraftForSidebarThread(id, thread)
      if (!isCurrentRequest()) return
      if (sddDraft) {
        // 点击“需求 AI”会话只打开该会话本身:登记草稿归属后精确选择点击的线程,
        // 不调用 openSddRequirementDraftFromHistory(),因此不会自动展开草稿编辑器。
        // 若当前正显示其他草稿,先保存并关闭草稿视图与需求 AI 右栏。
        markSddAssistantThread(sddDraft, id)
        if (useSddDraftStore.getState().activeDraft) dismissActiveSddDraft({ closeAssistant: true })
        setRoute('chat')
        await selectThread(id, { selectionGuard: isCurrentRequest })
        if (!isCurrentRequest()) return
        void useChatStore.getState().refreshThreads()
        return
      }
      if (useSddDraftStore.getState().activeDraft) dismissActiveSddDraft({ closeAssistant: true })
      setRoute('chat')
      await selectThread(id, { selectionGuard: isCurrentRequest })
    })()
  }, [
    beginNavigation,
    dismissActiveSddDraft,
    findSddDraftForSidebarThread,
    navigationIsCurrent,
    selectThread,
    setConnectPhoneSidebarOpen,
    setRoute,
    threads
  ])

  const startNewChat = useCallback((): void => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({
      useWorktreePool,
      worktreeBranch,
      agentSurface: 'code',
      activationGuard: () => navigationIsCurrent(requestId)
    })
    if (useWorktreePool) setUseWorktreePool(false)
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewChatInWorkspace = useCallback(async (
    targetWorkspaceRoot: string,
    options?: { forceNew?: boolean }
  ): Promise<string | null> => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    const threadId = await createThread({
      workspaceRoot: targetWorkspaceRoot,
      forceNew: options?.forceNew,
      agentSurface: 'code',
      useWorktreePool,
      worktreeBranch,
      activationGuard: () => navigationIsCurrent(requestId)
    })
    if (useWorktreePool) setUseWorktreePool(false)
    return threadId
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewConversation = useCallback((): void => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createConversation({ activationGuard: () => navigationIsCurrent(requestId) })
  }, [
    activeSddDraft,
    beginNavigation,
    createConversation,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute
  ])

  const openCodeMode = useCallback((): void => {
    const requestId = beginNavigation()
    setConnectPhoneSidebarOpen(false)
    void openCode({ activationGuard: () => navigationIsCurrent(requestId) })
  }, [beginNavigation, navigationIsCurrent, openCode, setConnectPhoneSidebarOpen])

  const openWriteMode = useCallback((): void => {
    const requestId = beginNavigation()
    setConnectPhoneSidebarOpen(false)
    void openWrite({ activationGuard: () => navigationIsCurrent(requestId) })
  }, [beginNavigation, navigationIsCurrent, openWrite, setConnectPhoneSidebarOpen])

  const exploreSddRequirementInDesign = useCallback((): void => {
    const requestId = beginNavigation()
    const requirement = sddDraftContent.trim()
    dismissActiveSddDraft({ closeAssistant: true })
    setRoute('chat')
    void createThread({
      workspaceRoot,
      forceNew: true,
      agentSurface: 'code',
      activationGuard: () => navigationIsCurrent(requestId)
    }).then((threadId) => {
      if (!threadId || !navigationIsCurrent(requestId)) return
      writeWorkbenchTaskIntent(workbenchTaskIntentScope(threadId, workspaceRoot), {
        surface: 'design',
        profile: DEFAULT_WORKBENCH_DESIGN_PROFILE
      })
      setInput(requirement)
    })
  }, [
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    sddDraftContent,
    setInput,
    setRoute,
    workspaceRoot
  ])

  const openPluginsView = useCallback((): void => {
    beginNavigation()
    setConnectPhoneSidebarOpen(false)
    openPlugins(sidebarView === 'claw' ? 'claw' : 'chat')
  }, [beginNavigation, openPlugins, setConnectPhoneSidebarOpen, sidebarView])

  const openExtensionsView = useCallback((): void => {
    beginNavigation()
    setConnectPhoneSidebarOpen(false)
    setRoute('extensions')
  }, [beginNavigation, setConnectPhoneSidebarOpen, setRoute])

  const openScheduleView = useCallback((): void => {
    beginNavigation()
    setConnectPhoneSidebarOpen(false)
    openSchedule()
  }, [beginNavigation, openSchedule, setConnectPhoneSidebarOpen])

  const openBoardView = useCallback((): void => {
    beginNavigation()
    setConnectPhoneSidebarOpen(false)
    openBoard(workspaceRoot)
  }, [beginNavigation, openBoard, setConnectPhoneSidebarOpen, workspaceRoot])

  const openWorkflowView = useCallback((): void => {
    beginNavigation()
    setConnectPhoneSidebarOpen(false)
    openWorkflow()
  }, [beginNavigation, openWorkflow, setConnectPhoneSidebarOpen])

  const toggleConnectPhone = useCallback((): void => {
    const requestId = beginNavigation()
    // 打开 Connect Phone 不清空需求草稿:草稿内容与保存状态留在本地 store,
    // 返回原工作台后继续可见。
    if (route === 'claw') {
      setConnectPhoneSidebarOpen(false)
      const returnRoute =
        connectPhoneReturnRouteRef.current === 'claw' ? 'chat' : connectPhoneReturnRouteRef.current
      if (returnRoute === 'chat') {
        // 利用 lastCodeThreadId 恢复离开前的 Code 会话(含需求 AI 会话)。
        void openCode({ activationGuard: () => navigationIsCurrent(requestId) })
        return
      }
      if (returnRoute === 'write') {
        void openWrite({ activationGuard: () => navigationIsCurrent(requestId) })
        return
      }
      setRoute(returnRoute)
      return
    }
    connectPhoneReturnRouteRef.current = route === 'design' ? 'chat' : route
    openClaw()
    setConnectPhoneSidebarOpen(true)
  }, [
    beginNavigation,
    navigationIsCurrent,
    openClaw,
    openCode,
    openWrite,
    route,
    setConnectPhoneSidebarOpen,
    setRoute
  ])

  const closeRightPanel = useCallback((): void => {
    if (route === 'write') {
      setWriteAssistantOpen(false)
      return
    }
    if (route === 'design') {
      const designState = useDesignWorkspaceStore.getState()
      if (designState.implementOpen) {
        designState.closeImplementPanel()
        setDesignAssistantOpen(true)
      } else {
        setDesignAssistantOpen(false)
      }
      return
    }
    if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.file) clearFilePreviewTargets()
    setRightPanelMode(null)
    setFilePreviewTarget(null)
  }, [
    clearFilePreviewTargets,
    rightPanelMode,
    route,
    setDesignAssistantOpen,
    setFilePreviewTarget,
    setRightPanelMode,
    setWriteAssistantOpen
  ])

  const startNewWriteAssistantConversation = useCallback((): void => {
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    const activeBoardId = writeState.activeWhiteboardId
    const activeBoard = activeBoardId ? writeState.whiteboards[activeBoardId] ?? null : null
    setInput('')
    writeState.clearQuotedSelections()
    // PPT review boards are canonically tied to the task that created their
    // workflow. A generic New conversation must not replace that parent
    // identity (or create an unrelated Write task with no board to own it).
    if (activeBoard?.workflowId) return
    const writeWorkspaceScope = workspaceRootScopeKey(writeWorkspaceRoot)
    void createWriteThread(
      writeWorkspaceRoot,
      writeState.activeFilePath ?? undefined,
      activeBoard
        ? { title: activeBoard.title, titleAuto: false }
        : undefined
    ).then((threadId) => {
      if (!activeBoardId || !threadId) return
      const latest = useWriteWorkspaceStore.getState()
      const latestBoard = latest.whiteboards[activeBoardId]
      if (
        latest.activeWhiteboardId !== activeBoardId ||
        workspaceRootScopeKey(latest.workspaceRoot) !== writeWorkspaceScope ||
        !latestBoard ||
        workspaceRootScopeKey(latestBoard.workspaceRoot) !== writeWorkspaceScope ||
        latestBoard.workflowId
      ) return
      void latest.bindWhiteboardThread(activeBoardId, threadId)
    })
  }, [createWriteThread, setInput, workspaceRoot])

  const pickWriteAssistantWorkspace = useCallback(async (): Promise<void> => {
    try {
      const writeState = useWriteWorkspaceStore.getState()
      writeState.setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        writeState.workspaceRoot || writeState.defaultWorkspaceRoot || workspaceRoot || undefined
      )
      if (!picked.canceled && picked.path) {
        await useWriteWorkspaceStore.getState().addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      useWriteWorkspaceStore.getState().setFileError(formatWorkspacePickerError(error))
    }
  }, [ensureWriteThreadForWorkspace, runtimeConnection, workspaceRoot])

  return {
    closeRightPanel,
    exploreSddRequirementInDesign,
    openCodeMode,
    openPluginsView,
    openBoardView,
    openExtensionsView,
    openScheduleView,
    openThread,
    openWorkflowView,
    openWriteMode,
    pickWriteAssistantWorkspace,
    sidebarView,
    startNewChat,
    startNewChatInWorkspace,
    startNewConversation,
    startNewWriteAssistantConversation,
    toggleConnectPhone
  }
}
