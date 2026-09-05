import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import { useWorkbenchComposerCapabilities } from './workbench/useWorkbenchComposerCapabilities'
import { useWorkbenchFileTreeController } from './workbench/useWorkbenchFileTreeController'
import { useWorkbenchSddThreadController } from './workbench/useWorkbenchSddThreadController'
import { useWorkbenchSddTurnController } from './workbench/useWorkbenchSddTurnController'
import { useWorkbenchComposerSubmitController } from './workbench/useWorkbenchComposerSubmitController'
import { useWorkbenchNavigationController } from './workbench/useWorkbenchNavigationController'
import { useWorkbenchDesignRuntime } from './workbench/useWorkbenchDesignRuntime'
import { useWorkbenchExecutionSettings } from './workbench/useWorkbenchExecutionSettings'
import {
  openWorkbenchCommandPalette,
  WorkbenchCommandPaletteRuntime
} from './workbench/WorkbenchCommandPaletteRuntime'
import { useWorkbenchChatStoreState } from './workbench/useWorkbenchChatStoreState'
import { useWorkbenchDerivedState } from './workbench/useWorkbenchDerivedState'
import { useWorkbenchWriteAssistantRuntime } from './workbench/useWorkbenchWriteAssistantRuntime'
import { useWorkbenchUiRuntime } from './workbench/useWorkbenchUiRuntime'
import { useWorkbenchAttachmentRuntime } from './workbench/useWorkbenchAttachmentRuntime'
import { useWorkbenchDesignAgentRuntime } from './workbench/useWorkbenchDesignAgentRuntime'
import { useDesignDrawingTitleBackfill } from './design/useDesignDrawingTitleBackfill'
import { useWorkbenchDesignHistoryController } from './workbench/useWorkbenchDesignHistoryController'
import { useWorkbenchExtensionContext } from './workbench/useWorkbenchExtensionContext'
import { useWorkbenchExtensionSurfaces } from './workbench/useWorkbenchExtensionSurfaces'
import { useWorkbenchRightTools } from './workbench/useWorkbenchRightTools'
import { useWorkbenchGraphChildRuntime } from './workbench/useWorkbenchGraphChildRuntime'
import { useWorkbenchDevPreviewContexts } from './workbench/useWorkbenchDevPreviewContexts'
import { useWorkbenchShellRuntime } from './workbench/useWorkbenchShellRuntime'
import { useWorkbenchTaskRuntime } from './workbench/useWorkbenchTaskRuntime'
import { WorkbenchContent } from './workbench/WorkbenchContent'
import { isWriteThreadId } from '../write/write-thread-registry'
import { useSddDraftStore } from '../sdd/sdd-draft-store'
import { sddDraftRefForThreadId } from '../sdd/sdd-chat-transcript'
import { resolveLinkedSddDraft } from '../sdd/sdd-linked-draft'
import { releaseSddAssistantThread } from '../sdd/sdd-thread-registry'
import { useWorkbenchLayout } from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { useGuiPlanStore } from '../plan/plan-store'
import { useAutoPlanBuildController } from '../plan/use-auto-plan-build-controller'
import { useProjectBoardEnabled } from '../project-board/use-project-board-enabled'
import { normalizeWorkspaceRoot, workspaceRootScopeKey } from '../lib/workspace-path'
import { relativeWorkspacePath } from '../lib/composer-file-references'
import { useDesignWorkspaceStore } from '../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../design/code-canvas-design-surface'
import { useWorkbenchPptWhiteboardRouter } from './workbench/useWorkbenchPptWhiteboardRouter'
import { designDocumentComposerFileReferences } from '../design/design-document-file-reference'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  type RightPanelContributionId
} from '../extensions/contribution-ids'
import {
  isExtensionContributionSnapshotReady,
  refreshExtensionContributionSnapshot,
  useCommittedExtensionContributionLoadContext,
  useExtensionRightRailViewEntries,
  useExtensionContributionLoadState,
  useWorkbenchContributions,
  workbenchContextForRoute
} from '../extensions/use-contributions'
import {
  sameExtensionContributionLoadContext,
  type ExtensionContributionLoadContext
} from '../extensions/contribution-load-coordinator'
import {
  extensionWorkbenchClient,
  ExtensionWorkbenchClientError
} from '../extensions/extension-workbench-client'
import { resolveActiveExtensionWorkspaceRoot } from '../extensions/active-extension-workspace'
import {
  canOpenHostContextMenuForTarget,
  DeclarativeContextMenuOverlay,
  ExtensionViewOutlet
} from '../extensions/ControlledContributionSurfaces'
import {
  isExtensionWorkbenchView,
  readStoredExtensionSurfaceId,
  resolveCommandOpenView,
  type ExtensionWorkbenchView,
  writeStoredExtensionSurfaceId
} from '../extensions/ExtensionWorkbenchSurfaces'
import {
  workbenchContributionRegistry,
  type ExtensionRightRailViewEntry
} from '../extensions/contribution-registry'
import { graphNodeLiveness } from '../graph/graph-liveness'
import { openGraphChildThread } from '../graph/graph-child-navigation'
import { formatSubagentElapsed } from './subagents/SubagentLiveness'
import { MAX_COMPOSER_CONTEXT_ATTACHMENTS } from '@kun/extension-api'
import type { DevPreviewContextDraft } from './DevBrowserPanel'
import { createDevPreviewComposerContextAttachment } from '../lib/dev-preview-composer-context'
import { useWorkbenchFocusedCanvasController } from './workbench/useWorkbenchFocusedCanvasController'
import { useWorkbenchGraphRuntimeState } from './workbench/useWorkbenchGraphRuntimeState'

export function Workbench(): ReactElement {
  const { t, i18n } = useTranslation('common')
  const {
    threads, threadSearch, showArchivedThreads, activeThreadId, threadLoadingId, activeThreadRelation,
    activeThreadParentId, selectThread, createThread, createConversation, blocks,
    liveReasoning, liveAssistant, error, runtimeErrorDetail, runtimeStatus, busy,
    currentTurnOrchestration,
    route, pluginHostRoute, workspaceRoot, conversationWorkspaceRoot, runtimeConnection,
    codeWorkspaceRoots, selectWorkspaceRoot,
    setRoute, openCode, openWrite, openDesign, ensureWriteThreadForWorkspace,
    ensureDesignThreadForWorkspace, createWriteThread, clearDesignHistory, openSettings,
    openPlugins, openClaw, openBoard, openSchedule, openWorkflow, chooseWorkspace, clawChannels,
    activeClawChannelId, selectClawChannel, resetClawChannelSession, setClawChannelModel,
    appendLocalClawTurn, setError, sendMessage, reviewActiveThread, queuedMessages,
    extensionComposerContexts, attachExtensionComposerContext,
    attachComposerContext, removeComposerContext, clearComposerContexts,
    removeQueuedMessage, guideQueuedMessage, interrupt, probeRuntime, composerModel, composerProviderId,
    composerPickList, composerModelGroups, composerReasoningEffort, composerFastMode, disabledSkillIds,
    composerPersonaId, composerPersonaEnabled, codeAgentPresets, setComposerPersonaId,
    composerMode, composerOrchestration, graphEnabled, setComposerMode,
    setComposerOrchestration, setComposerModel, setComposerReasoningEffort, setComposerFastMode,
    setThreadSearch, renameThread, pinThread, archiveThread, deleteThread,
    clearActiveThreadSelection, spawnSideConversation, openSideConversationDraft, selectSideConversation, setSidePanelOpen,
    sideConversations, sidePanel
  } = useWorkbenchChatStoreState()
  const {
    graphChildReturnTarget, graphRuns, graphChildRuns, graphChildNow
  } = useWorkbenchGraphRuntimeState(activeThreadId)
  const guiPlanSaveStatus = useGuiPlanStore((state) => state.saveStatus)
  useWorkbenchPptWhiteboardRouter({ activeThreadId, blocks, route, threads, workspaceRoot })
  const {
    activeComposerContextEvents,
    extensionComposerContextChips,
    extensionContributionLoadContext,
    extensionContributionLoadContextRef,
    extensionWorkspaceRoot,
    selectedPreviewElementCount
  } = useWorkbenchExtensionContext({
    activeThreadId,
    threads,
    workspaceRoot,
    route,
    language: i18n.language,
    extensionComposerContexts,
    attachExtensionComposerContext
  })
  const [input, setInput] = useState('')
  const [useWorktreePool, setUseWorktreePool] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [connectPhoneSidebarOpen, setConnectPhoneSidebarOpen] = useState(false)
  const [connectPhoneInitialTarget, setConnectPhoneInitialTarget] = useState<'feishu' | 'lark' | 'weixin' | 'telegram'>('feishu')
  const taskActiveSkillWorkspace = threads.find(
    (thread) => thread.id === activeThreadId
  )?.workspace || workspaceRoot || ''
  const {
    runtimeInfo,
    runtimeSkills,
    taskSurface,
    taskSurfaceLocked,
    taskSurfaceTransitioning,
    designTaskProfile,
    designProfileLocked,
    threadHasDesignDocument,
    lockedDesignProfile,
    onTaskSurfaceChange,
    onDesignTaskProfileChange,
    ensureDesignThread,
    rollbackProvisionalThread
  } = useWorkbenchTaskRuntime({
    activeThreadId, threads, workspaceRoot, activeSkillWorkspace: taskActiveSkillWorkspace,
    createThread, deleteThread, setComposerMode, setComposerOrchestration,
    composerMode, composerOrchestration,
    runtimeConnection, composerInput: input
  })
  const designDocuments = useDesignWorkspaceStore((s) => s.documents)
  const { focusModeEnabled, runtimeLogPath, toggleTheme, uiModeCameosEnabled, updateFocusMode } =
    useWorkbenchUiRuntime()
  const {
    composerExecutionSettings,
    composerExecutionApplying,
    updateComposerExecutionSettings
  } = useWorkbenchExecutionSettings({
    setError,
    onSettingsUpdated: () => void probeRuntime('background')
  })
  const busyRef = useRef(busy)
  const routeRef = useRef(route)
  const runtimeConnectionRef = useRef(runtimeConnection)
  const {
    resolvedWriteAssistantProviderId, setWriteAssistantModel, setWriteAssistantOpen,
    writeAssistantModel, writeAssistantOpen, writeAssistantPickList
  } = useWorkbenchWriteAssistantRuntime({
    composerPickList,
    composerModelGroups
  })
  const {
    designWorkspaceRoot, designAssistantOpen, setDesignAssistantOpen, designImplementOpen,
    designImplementTitle, designActiveDocumentId, designAssistantModel, setDesignAssistantModel,
    designComposerReasoningEffort, setDesignComposerReasoningEffort,
    designDrawingTitle, designDrawingCreationSubmitting,
    canvasDocument, canvasDocumentKey, canvasSelectedIds, designAssistantPickList,
    resolvedDesignAssistantProviderId, selectCanvasShape, designContextChips,
    designContextSuppressedIds, designHtmlElementContext, removeDesignContextChip,
    handleDesignHtmlElementAsContext
  } = useWorkbenchDesignRuntime({
    route,
    designTaskActive: taskSurface === 'design',
    composerPickList,
    composerModelGroups,
    setInput
  })
  useDesignDrawingTitleBackfill({
    enabled: route === 'design',
    workspaceRoot: designWorkspaceRoot,
    documents: designDocuments,
    threads,
    runtimeConnection
  })
  const { clearActiveDrawingHistory, deleteDrawing } = useWorkbenchDesignHistoryController()
  const designDocumentFileMentionCandidates = useMemo(() => {
    const root = normalizeWorkspaceRoot(designWorkspaceRoot || workspaceRoot)
    return root ? designDocumentComposerFileReferences(designDocuments, root) : []
  }, [designDocuments, designWorkspaceRoot, workspaceRoot])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const { enabled: projectBoardEnabled, loaded: projectBoardSettingsLoaded } = useProjectBoardEnabled()
  useEffect(() => {
    routeRef.current = route
    if (projectBoardSettingsLoaded && !projectBoardEnabled && route === 'board') setRoute('chat')
    runtimeConnectionRef.current = runtimeConnection
  }, [projectBoardEnabled, projectBoardSettingsLoaded, route, runtimeConnection, setRoute])

  const stageInsetClass = 'ds-stage-inset'
  const prevThreadId = useRef<string | null>(null)
  const inputRef = useRef('')
  const {
    activeClawChannel, activeCodeCanvasWorkspace, activeSkillWorkspace, codeThreads,
    currentSideConversations, currentSideRunningCount, devPreviewBlocks,
    latestAutoOpenDevPreviewSignal, latestDevPreviewUrl,
    timelineBlocks, timelineLiveAssistant, timelineLiveReasoning
  } = useWorkbenchDerivedState({
    activeClawChannelId,
    activeThreadId,
    blocks,
    clawChannels,
    liveAssistant,
    liveReasoning,
    sideConversations,
    threads,
    workspaceRoot
  })
  const {
    activateRightPanelTab, beginLeftResize, beginRightResize, beginTerminalResize,
    closeRightPanelTab, codeRightTabs, collapseRightPanel, expandRightPanel,
    filePreviewTarget,
    leftSidebarCollapsed, leftSidebarWidth, openDevPreview, rightPanelMode, rightPanelVisible,
    openRightPanelTab, rightSidebarWidth, setFilePreviewTarget, setRightPanelMode,
    setRightSidebarWidth, shellRef, terminalHeight, terminalOpen, toggleLeftSidebar, toggleTerminal,
    canvasFocusMode: layoutCanvasFocusMode,
    exitCanvasFocusMode: exitLayoutCanvasFocus,
  } = useWorkbenchLayout({
    activeThreadId,
    designAssistantOpen,
    designImplementOpen,
    latestAutoOpenDevPreviewSignal,
    route,
    threadLoadingId,
    workspaceRoot: extensionWorkspaceRoot,
    writeAssistantOpen
  })
  const {
    activeExtensionAuxiliaryPanel, activeExtensionCenterView, activeExtensionLeftSidebar,
    activeExtensionRightPanel, activeExtensionSurface, contributionContext,
    extensionAttachmentContextMenus, extensionCommands, extensionComposerActions,
    extensionContributionSnapshotReady, extensionHostContextMenus, extensionLeftSidebarItems,
    extensionMessageActions, extensionMessageContextMenus, extensionResultPreviews,
    messageContributionsForSurface,
    extensionRightPanelItems, extensionRightRailItems, extensionTopBarActions,
    extensionSurfaceItems,
    openExtensionSurface, openManagedExtensionView, selectRightRailExtension,
    selectExtensionSurface,
    workspaceContextMenu, setWorkspaceContextMenu
  } = useWorkbenchExtensionSurfaces({
    t,
    language: i18n.language,
    route,
    taskSurface,
    extensionWorkspaceRoot,
    extensionContributionLoadContext,
    extensionContributionLoadContextRef,
    leftSidebarCollapsed,
    rightPanelMode,
    codeRightTabs,
    setRoute,
    setError,
    setRightPanelMode,
    toggleLeftSidebar,
    openRightPanelTab,
    closeRightPanelTab
  })
  const {
    composerFileReferences, fileTreeSidePanelOpen, fileTreeSidePanelView,
    generatedDocumentCollection, openFilePreviewTargets,
    pinnedFilePreviewTargetKeys, preserveFilePreviewTargets, fileTreeWorkspaceRoot,
    clearComposerFileReferences, addComposerFileReference, pickComposerFileReferences, restoreComposerFileReferences,
    removeComposerFileReference, openWorkspaceFilePreviewTarget, openGeneratedDocumentPreview,
    openGeneratedDocuments, previewWorkspaceFileFromSidebar,
    closeWorkspaceFilePreviewTarget, togglePinnedFilePreviewTarget, closeOtherFilePreviewTargets,
    togglePreserveFilePreviewTargets, addWorkspaceReferenceFromSidebar,
    toggleFileTreeSidePanel, openFileTreeSidePanel, openDesignFileTreeSidePanel, setFileTreeSidePanelView,
    clearFilePreviewTargets
  } = useWorkbenchFileTreeController({
    route,
    threads,
    activeThreadId,
    workspaceRoot,
    activeSkillWorkspace,
    rightPanelMode,
    filePreviewTarget,
    setFilePreviewTarget,
    setRightPanelMode,
    closeRightPanelTab
  })
  const {
    activeSddDraft, sddDraftContent, sddDraftOperationStatus, dismissActiveSddDraft,
    ensureSddAssistantThreadForDraft, findSddDraftForSidebarThread, openSddAssistantPanel,
    openSddRequirementDraftFromHistory, quoteToSddAssistant, renameSddAssistantThreadToDraft,
    startNewSddAssistantConversation: startNewSddThreadConversation, startNewSddRequirement,
    toggleSddAssistantPanel
  } = useWorkbenchSddThreadController({
    activeThreadId,
    codeThreads,
    conversationWorkspaceRoot,
    input,
    rightPanelMode,
    runtimeConnection,
    workspaceRoot,
    selectThread,
    setComposerMode,
    setError,
    setInput,
    setRightPanelMode,
    setRightSidebarWidth,
    setRoute
  })
  const {
    activeGuiPlan, buildGuiPlan, handleGuiPlanCommand, openGuiPlanPanel,
    replanChangedRequirements, sendPlanTurn, verifyGuiPlan
  } = useWorkbenchPlanController({
    blocks,
    busy,
    mode: composerMode,
    route,
    sendMessage,
    setError,
    setComposerMode,
    setRightPanelMode,
    setRightSidebarWidth,
    t,
    workspaceRoot,
    onPlanBuildStarted: async (plan) => {
      const threadId = plan.threadId?.trim() || useChatStore.getState().activeThreadId
      const draft = useSddDraftStore.getState().activeDraft
      dismissActiveSddDraft({ closeAssistant: true })
      if (!threadId) return
      if (draft) await renameSddAssistantThreadToDraft(threadId, draft)
      if (!releaseSddAssistantThread(threadId)) return
      await useChatStore.getState().refreshThreads()
    }
  })
  const linkedSddDraft = useMemo(() => resolveLinkedSddDraft({
    plan: activeGuiPlan,
    threadDraftRef: activeThreadId ? sddDraftRefForThreadId(activeThreadId) : null
  }), [activeGuiPlan, activeThreadId])
  const openLinkedSddDraft = useCallback((): void => {
    if (!linkedSddDraft) return
    void openSddRequirementDraftFromHistory(linkedSddDraft)
  }, [linkedSddDraft, openSddRequirementDraftFromHistory])
  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null

  const {
    closeCodeRightTool,
    openCodeRightTool,
    openDesignDocumentInWhiteboard,
    openDesignFileTreeTab,
    openWorkspaceFileTreeTab,
    toggleCodeRightWorkspace
  } = useWorkbenchRightTools({
    input, inputRef, prevThreadId, activeThreadId,
    activeThreadDesignDocumentId: lockedDesignProfile?.documentTarget.documentId,
    activeGuiPlan, rightPanelMode, sidePanel,
    currentSideConversations, designWorkspaceRoot, workspaceRoot, fileTreeWorkspaceRoot,
    filePreviewTarget, codeRightTabs, openSideConversationDraft, selectSideConversation,
    setSidePanelOpen, openFileTreeSidePanel, openDesignFileTreeSidePanel, openRightPanelTab,
    closeRightPanelTab, toggleTerminal, collapseRightPanel, expandRightPanel
  })
  const {
    selectedModelSupportsImageInput
  } = useWorkbenchComposerCapabilities({
    route,
    rightPanelMode,
    activeClawModel: activeClawChannel?.model,
    designAssistantModel,
    resolvedDesignAssistantProviderId,
    writeAssistantModel,
    resolvedWriteAssistantProviderId,
    composerModel,
    composerProviderId,
    composerModelGroups,
    runtimeInfo
  })
  const {
    addComposerImageBase64,
    attachmentUploadBusy,
    attachmentUploadEnabled,
    attachmentUploadError,
    clearComposerAttachments,
    composerAttachments,
    getAttachmentScope,
    handlePickAttachments,
    handlePasteClipboardImage,
    removeComposerAttachments,
    removeComposerAttachment, restoreComposerAttachments,
    setAttachmentUploadError,
    webAccessAvailable
  } = useWorkbenchAttachmentRuntime({
    activeThreadId,
    canvasDocument,
    canvasSelectedIds,
    composerMode,
    modelUnsupportedMessage: t('composerAttachmentModelUnsupported'),
    rightPanelMode,
    route,
    taskSurface,
    runtimeConnection,
    runtimeInfo,
    selectedModelSupportsImageInput,
    threads,
    workspaceRoot,
    onFallbackToFileReference: route === 'chat' && !activeSddDraft
      ? addComposerFileReference
      : undefined
  })

  const {
    attachDevPreviewContext,
    clearDevPreviewContexts,
    removeComposerContextWithLinkedImage
  } = useWorkbenchDevPreviewContexts({
    activeThreadId, route, extensionWorkspaceRoot, extensionComposerContexts,
    activeComposerContextEvents, selectedModelSupportsImageInput, attachmentUploadEnabled,
    addComposerImageBase64, removeComposerAttachments, removeComposerContext,
    clearComposerContexts, attachComposerContext
  })
  const {
    buildCodeCanvasOutboundPrompt,
    designThreads,
    designHistoryThreadIds,
    hasRegisteredHistory: designHasRegisteredHistory,
    handleDesignQualityRepairRequest,
    handleDesignRuntimeQualityFindings,
    implementDesignInCode,
    openDesignMode,
    sendCodeCanvasPrompt,
    sendDesignPrompt,
    switchDesignThread
  } = useWorkbenchDesignAgentRuntime({
    activeCodeCanvasWorkspace,
    activeDocumentId: designActiveDocumentId,
    activeThreadId,
    attachmentUploadEnabled,
    busy,
    clearHtmlElementContext: () => handleDesignHtmlElementAsContext(null),
    clearComposerAttachments,
    composerAttachments,
    composerModelGroups,
    composerReasoningEffort,
    composerModel,
    composerProviderId,
    composerFastMode,
    createThread,
    designContextSuppressedIds,
    designHtmlElementContext,
    designWorkspaceRoot,
    clearDesignHistory,
    ensureDesignThreadForWorkspace: ensureDesignThread,
    rollbackProvisionalThread,
    designTaskProfileSelection: taskSurface === 'design' ? designTaskProfile : undefined,
    lockedDesignProfile,
    expectedThreadId: activeThreadId,
    imageGenerationAvailable: runtimeInfo?.capabilities.imageGen?.available === true,
    imageGenerationReason: runtimeInfo?.capabilities.imageGen?.reason,
    getAttachmentScope,
    clearActiveThreadSelection,
    openDesign,
    rightPanelMode,
    route,
    runtimeConnection,
    selectThread,
    sendMessage,
    setAttachmentUploadError,
    setConnectPhoneSidebarOpen,
    setDesignAssistantOpen,
    setError,
    setInput,
    setRightPanelMode,
    threads,
    workspaceRoot
  })

  const {
    applySddFramework, handleSddNextStep, sendSddAssistantPrompt, sendSddPrototypeTurn,
    startNewSddAssistantConversation
  } = useWorkbenchSddTurnController({
    activeGuiPlan, attachmentUploadEnabled, blocks, busy, composerAttachments, composerMode,
    composerModelGroups, composerReasoningEffort, composerFastMode, input, resolvedWriteAssistantProviderId,
    runtimeConnection, runtimeInfo, selectedModelSupportsImageInput, sendMessage, sendPlanTurn,
    setAttachmentUploadError, setComposerMode, setError, setInput, setWriteAssistantModel,
    writeAssistantModel, clearComposerAttachments, ensureSddAssistantThreadForDraft, getAttachmentScope,
    openSddAssistantPanel,
    startNewSddAssistantConversation: startNewSddThreadConversation
  })

  const { requestAutoPlanBuild, dialog: autoPlanBuildDialog, enabled: autoPlanBuildEnabled } =
    useAutoPlanBuildController({ workspaceRoot, sendPlanTurn, setError })
  const { handleSend: handleCodeSend, sendWritePrompt } = useWorkbenchComposerSubmitController({
    activeClawChannelId, activeClawChannelModel: activeClawChannel?.model,
    activeClawChannelProviderId: activeClawChannel?.providerId,
    activeSddDraft: Boolean(activeSddDraft), activeThreadId, taskSurface, attachmentUploadEnabled,
    buildCodeCanvasOutboundPrompt, clearComposerAttachments, removeComposerAttachments, clearComposerFileReferences, restoreComposerAttachments, restoreComposerFileReferences,
    composerAttachments, composerFileReferences, composerMode, composerModel, composerProviderId,
    composerModelGroups, composerReasoningEffort, composerFastMode, getAttachmentScope,
    handleGuiPlanCommand, input, resetClawChannelSession, requestAutoPlanBuild, rightPanelMode, route,
    selectClawChannel, sendMessage, sendPlanTurn, sendSddAssistantPrompt,
    setAttachmentUploadError, setClawChannelModel, setError, setInput, threads, workspaceRoot,
    appendLocalClawTurn
  })
  const handleSend = useCallback((): void => {
    if (route === 'chat' && !activeSddDraft && taskSurface === 'design') {
      void sendDesignPrompt(input)
      return
    }
    handleCodeSend()
  }, [activeSddDraft, handleCodeSend, input, route, sendDesignPrompt, taskSurface])

  const {
    closeRightPanel, exploreSddRequirementInDesign, openCodeMode, openPluginsView, openExtensionsView, openBoardView, openScheduleView,
    openThread, openWorkflowView, openWriteMode, pickWriteAssistantWorkspace, sidebarView,
    startNewChat, startNewChatInWorkspace, startNewConversation, startNewWriteAssistantConversation,
    toggleConnectPhone
  } = useWorkbenchNavigationController({
    activeSddDraft: Boolean(activeSddDraft), activeThreadId, pluginHostRoute, rightPanelMode, route,
    runtimeConnection, sddDraftContent, threads, useWorktreePool, workspaceRoot, worktreeBranch,
    clearFilePreviewTargets, createConversation, createThread, createWriteThread, dismissActiveSddDraft,
    ensureWriteThreadForWorkspace, findSddDraftForSidebarThread, openClaw, openCode,
    openPlugins, openBoard, openSchedule, openWorkflow, openWrite,
    selectThread, setConnectPhoneSidebarOpen, setDesignAssistantOpen, setFilePreviewTarget, setInput,
    setRightPanelMode, setRoute, setUseWorktreePool, setWriteAssistantOpen
  })

  const {
    graphChildContext,
    openComposerGraph,
    openComposerGraphChild,
    returnFromSubagent
  } = useWorkbenchGraphChildRuntime({
    t, graphEnabled, graphChildReturnTarget, graphRuns, graphChildRuns, graphChildNow,
    activeThreadId, activeThreadParentId, selectThread, openRightPanelTab
  })
  const { canvasFocusMode, exitCanvasFocusMode, startNewDesignCanvasConversation } =
    useWorkbenchFocusedCanvasController(
      { canvasFocusMode: layoutCanvasFocusMode, exitCanvasFocusMode: exitLayoutCanvasFocus },
      {
        designWorkspaceRoot, workspaceRoot, designActiveDocumentId,
        lockedDesignDocumentId: lockedDesignProfile?.documentTarget.documentId
      }
    )

  const {
    chatComposerProps, conversationRuntimeBanner, imageAnnotationHost, planOverlay,
    rightPanel, rightPanelSharedProps, writeRuntimeBanner, focusedCanvasWorkspace
  } = useWorkbenchShellRuntime({
    canvasFocusMode,
    exitCanvasFocusMode,
    startNewDesignCanvasConversation,
    leftSidebarCollapsed,
    toggleLeftSidebar,
    input, setInput, composerMode, setComposerMode, composerOrchestration, graphEnabled,
    autoPlanBuildEnabled,
    taskSurface, taskSurfaceLocked, taskSurfaceTransitioning, designTaskProfile, designProfileLocked,
    threadHasDesignDocument, lockedDesignProfile, onTaskSurfaceChange, onDesignTaskProfileChange,
    setComposerOrchestration, openComposerGraph, openComposerGraphChild, busy,
    currentTurnOrchestration, route, runtimeConnection, activeThreadId, activeClawChannelId,
    activeClawChannel, composerModel, composerProviderId, composerPickList, composerModelGroups,
    composerReasoningEffort, composerFastMode, setComposerReasoningEffort, setComposerFastMode,
    composerPersonaId, composerPersonaEnabled, codeAgentPresets, setComposerPersonaId,
    setClawChannelModel, setComposerModel, openSettings, handleSend, composerAttachments,
    extensionComposerContextChips, removeComposerContextWithLinkedImage, attachmentUploadEnabled,
    attachmentUploadBusy, attachmentUploadError, activeSddDraft, composerFileReferences,
    designDocumentFileMentionCandidates, webAccessAvailable, composerExecutionSettings,
    composerExecutionApplying, runtimeSkills, disabledSkillIds, handlePickAttachments,
    handlePasteClipboardImage, removeComposerAttachment, restoreComposerAttachments, addComposerFileReference,
    pickComposerFileReferences, openWorkspaceFileTreeTab, openDesignFileTreeTab,
    removeComposerFileReference, queuedMessages, removeQueuedMessage, guideQueuedMessage,
    interrupt, handleGuiPlanCommand, useWorktreePool, worktreeBranch, setWorktreeBranch,
    setUseWorktreePool, createThread, activeSkillWorkspace, reviewActiveThread,
    updateComposerExecutionSettings, spawnSideConversation, openSideConversationDraft,
    startNewSddRequirement,
    blocks, liveReasoning, liveAssistant, probeRuntime, runtimeStatus, runtimeLogPath,
    error, runtimeErrorDetail, stageInsetClass, t, rightPanelMode, closeRightPanelTab,
    closeRightPanel, buildGuiPlan, verifyGuiPlan, replanChangedRequirements, setRightPanelMode,
    rightPanelVisible, rightSidebarWidth, beginRightResize, writeAssistantOpen,
    collapseRightPanel, designImplementOpen, designAssistantOpen, designImplementTitle,
    workspaceRoot, designAssistantModel, resolvedDesignAssistantProviderId,
    designAssistantPickList, setDesignAssistantModel, designComposerReasoningEffort,
    setDesignComposerReasoningEffort, designContextChips, removeDesignContextChip,
    sendDesignPrompt, designDrawingTitle, clearActiveDrawingHistory, designHasRegisteredHistory,
    designThreads, designHistoryThreadIds, switchDesignThread, writeAssistantModel,
    resolvedWriteAssistantProviderId, writeAssistantPickList, setWriteAssistantModel,
    startNewWriteAssistantConversation, pickWriteAssistantWorkspace, applySddFramework,
    startNewSddAssistantConversation, devPreviewBlocks, latestDevPreviewUrl,
    extensionWorkspaceRoot, selectedPreviewElementCount, selectedModelSupportsImageInput,
    attachDevPreviewContext, clearDevPreviewContexts, activeCodeCanvasWorkspace,
    filePreviewTarget, openFilePreviewTargets, openWorkspaceFilePreviewTarget,
    closeWorkspaceFilePreviewTarget, pinnedFilePreviewTargetKeys, preserveFilePreviewTargets,
    togglePinnedFilePreviewTarget, closeOtherFilePreviewTargets, togglePreserveFilePreviewTargets,
    activeExtensionRightPanel, codeRightTabs, currentSideConversations, currentSideRunningCount,
    runtimeInfo, fileTreeSidePanelOpen, fileTreeSidePanelView, fileTreeWorkspaceRoot,
    generatedDocumentCollection, openGeneratedDocumentPreview,
    designWorkspaceRoot, designDocuments, designActiveDocumentId, setFileTreeSidePanelView,
    previewWorkspaceFileFromSidebar, addWorkspaceReferenceFromSidebar,
    openDesignDocumentInWhiteboard, extensionRightRailItems, extensionRightPanelItems,
    openRightPanelTab, activateRightPanelTab, closeCodeRightTool, toggleFileTreeSidePanel,
    setError, canvasDocumentKey, canvasDocument, sendCodeCanvasPrompt,
    implementDesignInCode, selectCanvasShape, handleDesignHtmlElementAsContext,
    handleDesignRuntimeQualityFindings, handleDesignQualityRepairRequest
  })
  return <>
    {autoPlanBuildDialog}
    <WorkbenchContent context={{
    shellRef, extensionHostContextMenus, activeExtensionCenterView, route, setWorkspaceContextMenu,
    leftSidebarCollapsed, leftSidebarWidth, codeThreads, activeThreadId, sidebarView,
    connectPhoneSidebarOpen, connectPhoneInitialTarget, activeExtensionLeftSidebar, extensionWorkspaceRoot,
    selectExtensionSurface, runtimeConnection, threadSearch, showArchivedThreads, focusModeEnabled,
    updateFocusMode, setThreadSearch, openThread, renameThread, pinThread, archiveThread,
    deleteThread, deleteDrawing, startNewChat, startNewChatInWorkspace,
    openSettings, openPluginsView, openExtensionsView, toggleTheme, toggleConnectPhone,
    openConnectWeixin: () => { setConnectPhoneInitialTarget('weixin'); openClaw(); setConnectPhoneSidebarOpen(true) },
    openCodeMode, openWriteMode, openDesignMode, openBoardView, openScheduleView, openWorkflowView,
    startNewConversation, beginLeftResize, toggleLeftSidebar, busy, implementDesignInCode,
    handleDesignHtmlElementAsContext, selectCanvasShape, sendDesignPrompt,
    handleDesignRuntimeQualityFindings, handleDesignQualityRepairRequest, rightPanelSharedProps,
    designWorkspaceRoot, workspaceRoot, designAssistantModel, resolvedDesignAssistantProviderId,
    designAssistantPickList, setDesignAssistantModel, designComposerReasoningEffort,
    composerFastMode, setDesignComposerReasoningEffort, setComposerFastMode, designContextChips,
    removeDesignContextChip, input, rightPanel, writeRuntimeBanner, setInput, sendWritePrompt,
    conversationRuntimeBanner, activeSddDraft, rightPanelMode, toggleSddAssistantPanel,
    quoteToSddAssistant, sendSddPrototypeTurn, exploreSddRequirementInDesign, handleSddNextStep,
    dismissActiveSddDraft, sddDraftOperationStatus, stageInsetClass, uiModeCameosEnabled,
    timelineBlocks, timelineLiveReasoning, timelineLiveAssistant, error, guiPlanSaveStatus,
    graphEnabled, showDevPreviewCard, latestDevPreviewUrl, threads, activeThreadParentId,
    activeThreadRelation, graphChildContext, chatComposerProps, activeSkillWorkspace,
    terminalOpen, fileTreeWorkspaceRoot, terminalHeight, codeRightTabs, probeRuntime,
    buildGuiPlan, openGuiPlanPanel, setRightPanelMode, reviewActiveThread, openDevPreview,
    returnFromSubagent, beginTerminalResize, toggleTerminal, toggleCodeRightWorkspace,
    linkedSddDraft, openLinkedSddDraft, extensionTopBarActions, extensionComposerActions,
    extensionMessageActions, extensionMessageContextMenus, extensionAttachmentContextMenus,
    extensionCommands, extensionResultPreviews, extensionSurfaceItems, openExtensionSurface,
    messageContributionsForSurface,
    openCodeRightTool, currentSideRunningCount, extensionRightRailItems, selectRightRailExtension,
    imageAnnotationHost, planOverlay, openManagedExtensionView, activeExtensionAuxiliaryPanel,
    workspaceContextMenu, activeGuiPlan,
    focusedCanvasWorkspace, openGeneratedDocuments, openGeneratedDocumentPreview,
    onOpenCommandPalette: openWorkbenchCommandPalette
  }} />
    <WorkbenchCommandPaletteRuntime
      sources={{ route, workspaceRoot: activeSkillWorkspace, threads: codeThreads, codeWorkspaceRoots,
        runtimeReady: runtimeConnection === 'ready', busy, activeThreadId,
        activeThreadArchived: threads.find((item) => item.id === activeThreadId)?.archived === true,
        canOpenGoalPanel: runtimeConnection === 'ready' && route !== 'claw',
        canCreateNewThread: runtimeConnection === 'ready' && route !== 'claw' && Boolean(activeSkillWorkspace),
        hasPlanCommand: route !== 'claw', hasBtwCommand: route !== 'claw', hideBtwCommand: false,
        hasReviewCommand: route !== 'claw', skillCommands: runtimeSkills, disabledSkillIds,
        extensionRightRailItems, composerModel, composerModelGroups,
        activeThreadPinned: threads.find((item) => item.id === activeThreadId)?.pinned === true,
        projectBoardEnabled }}
      shortcutContext={{ composerMode, setComposerMode, handleGuiPlanCommand, createThread,
        chooseWorkspace, toggleTerminal, openSettings, useWorktreePool, setUseWorktreePool,
        worktreeBranch, navigationLocked: designDrawingCreationSubmitting }}
      actions={{ routes: { chat: openCodeMode, write: openWriteMode, design: openDesignMode,
        settings: openSettings, plugins: openPluginsView, extensions: openExtensionsView,
        claw: openClaw, board: openBoardView, schedule: openScheduleView, workflow: openWorkflowView },
        openSettings, openThread, selectWorkspaceRoot, selectExtension: selectRightRailExtension,
        openCode, setInput, setError, setComposerModel, archiveThread, pinThread }}
      input={input}
    />
  </>
}
