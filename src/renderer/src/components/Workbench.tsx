import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import { type ComposerReasoningEffort } from './chat/FloatingComposerModelPicker'
import { WorkbenchLeftSidebar } from './workbench/WorkbenchLeftSidebar'
import { WorkbenchStageRouter } from './workbench/WorkbenchStageRouter'
import { useWorkbenchComposerCapabilities } from './workbench/useWorkbenchComposerCapabilities'
import { useWorkbenchFileTreeController } from './workbench/useWorkbenchFileTreeController'
import { useWorkbenchSddThreadController } from './workbench/useWorkbenchSddThreadController'
import { useWorkbenchSddTurnController } from './workbench/useWorkbenchSddTurnController'
import { useWorkbenchComposerSubmitController } from './workbench/useWorkbenchComposerSubmitController'
import { useWorkbenchNavigationController } from './workbench/useWorkbenchNavigationController'
import { useWorkbenchDesignRuntime } from './workbench/useWorkbenchDesignRuntime'
import { useWorkbenchRuntimeMetadata } from './workbench/useWorkbenchRuntimeMetadata'
import { useWorkbenchExecutionSettings } from './workbench/useWorkbenchExecutionSettings'
import { useWorkbenchKeyboardShortcuts } from './workbench/useWorkbenchKeyboardShortcuts'
import { useWorkbenchChatComposerProps } from './workbench/useWorkbenchChatComposerProps'
import { buildWorkbenchRightPanelSharedProps } from './workbench/useWorkbenchRightPanelSharedProps'
import { useWorkbenchChatStoreState } from './workbench/useWorkbenchChatStoreState'
import { useWorkbenchRuntimeBanners } from './workbench/useWorkbenchRuntimeBanners'
import { useWorkbenchRightPanelElement } from './workbench/useWorkbenchRightPanelElement'
import { useWorkbenchDerivedState } from './workbench/useWorkbenchDerivedState'
import { useWorkbenchPlanPanelRuntime } from './workbench/useWorkbenchPlanPanelRuntime'
import { useWorkbenchWriteAssistantRuntime } from './workbench/useWorkbenchWriteAssistantRuntime'
import { useWorkbenchUiRuntime } from './workbench/useWorkbenchUiRuntime'
import { useWorkbenchAttachmentRuntime } from './workbench/useWorkbenchAttachmentRuntime'
import { useWorkbenchDesignAgentRuntime } from './workbench/useWorkbenchDesignAgentRuntime'
import { WorkbenchImageAnnotationHost } from './workbench/WorkbenchImageAnnotationHost'
import { isWriteThreadId } from '../write/write-thread-registry'
import { useSddDraftStore } from '../sdd/sdd-draft-store'
import {
  releaseSddAssistantThread,
} from '../sdd/sdd-thread-registry'
import { useWorkbenchLayout } from './workbench-layout'
import { useWorkbenchPlanController } from './workbench-plan-controller'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  relativeWorkspacePath,
} from '../lib/composer-file-references'
import { useDesignWorkspaceStore } from '../design/design-workspace-store'
import { designDocumentComposerFileReferences } from '../design/design-document-file-reference'

const FILE_TREE_SIDEBAR_WIDTH = 320

export function Workbench(): ReactElement {
  const { t } = useTranslation('common')
  const {
    threads, threadSearch, showArchivedThreads, activeThreadId, activeThreadRelation,
    activeThreadParentId, selectThread, createThread, createConversation, blocks,
    liveReasoning, liveAssistant, error, runtimeErrorDetail, runtimeStatus, busy,
    route, pluginHostRoute, workspaceRoot, conversationWorkspaceRoot, runtimeConnection,
    setRoute, openCode, openWrite, openDesign, ensureWriteThreadForWorkspace,
    ensureDesignThreadForWorkspace, createWriteThread, createDesignThread, openSettings,
    openPlugins, openClaw, openSchedule, openWorkflow, chooseWorkspace, clawChannels,
    activeClawChannelId, selectClawChannel, resetClawChannelSession, setClawChannelModel,
    appendLocalClawTurn, setError, sendMessage, reviewActiveThread, queuedMessages,
    removeQueuedMessage, interrupt, probeRuntime, composerModel, composerProviderId,
    composerPickList, composerModelGroups, disabledSkillIds, composerMode, setComposerMode,
    setComposerModel, setThreadSearch, renameThread, pinThread, archiveThread, deleteThread,
    clearActiveThreadSelection, spawnSideConversation, openSideConversationDraft, selectSideConversation, setSidePanelOpen,
    sideConversations, sidePanel
  } = useWorkbenchChatStoreState()
  const [input, setInput] = useState('')
  const [useWorktreePool, setUseWorktreePool] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [composerReasoningEffort, setComposerReasoningEffort] =
    useState<ComposerReasoningEffort>('max')
  const [connectPhoneSidebarOpen, setConnectPhoneSidebarOpen] = useState(false)
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
    canvasDocument, canvasDocumentKey, canvasSelectedIds, designAssistantPickList,
    resolvedDesignAssistantProviderId, selectCanvasShape, designContextChips,
    designContextSuppressedIds, designHtmlElementContext, removeDesignContextChip,
    handleDesignHtmlElementAsContext
  } = useWorkbenchDesignRuntime({
    route,
    composerPickList,
    composerModelGroups,
    setInput
  })
  const designDocumentFileMentionCandidates = useMemo(() => {
    const root = normalizeWorkspaceRoot(designWorkspaceRoot || workspaceRoot)
    return root ? designDocumentComposerFileReferences(designDocuments, root) : []
  }, [designDocuments, designWorkspaceRoot, workspaceRoot])

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    routeRef.current = route
  }, [route])

  useEffect(() => {
    runtimeConnectionRef.current = runtimeConnection
  }, [runtimeConnection])

  const stageInsetClass = 'ds-stage-inset'

  const prevThreadId = useRef<string | null>(null)
  const inputRef = useRef('')
  const {
    activeClawChannel, activeCodeCanvasWorkspace, activeSkillWorkspace, codeThreads,
    composerChangeSummary, currentSideConversations, currentSideRunningCount, devPreviewBlocks,
    latestAutoOpenDevPreviewUrl, latestDevPreviewUrl, lockVisionToTextModelSwitch,
    timelineBlocks, timelineLiveAssistant, timelineLiveReasoning
  } = useWorkbenchDerivedState({
    activeClawChannelId,
    activeThreadId,
    blocks,
    clawChannels,
    liveAssistant,
    liveReasoning,
    route,
    sideConversations,
    threads,
    workspaceRoot
  })
  const { runtimeInfo, runtimeSkills } = useWorkbenchRuntimeMetadata({
    activeSkillWorkspace,
    runtimeConnection
  })
  const {
    beginLeftResize, beginRightResize, beginTerminalResize, filePreviewTarget,
    leftSidebarCollapsed, leftSidebarWidth, openDevPreview, rightPanelMode, rightPanelVisible,
    rightSidebarWidth, setFilePreviewTarget, setRightPanelMode, setRightSidebarWidth, shellRef,
    terminalHeight, terminalOpen, toggleLeftSidebar, toggleRightPanelMode, toggleTerminal,
  } = useWorkbenchLayout({
    activeThreadId,
    designAssistantOpen,
    designImplementOpen,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    route,
    workspaceRoot,
    writeAssistantOpen
  })
  const {
    composerFileReferences, fileTreeSidePanelOpen, fileTreeSidePanelView, openFilePreviewTargets,
    pinnedFilePreviewTargetKeys, preserveFilePreviewTargets, fileTreeWorkspaceRoot,
    clearComposerFileReferences, addComposerFileReference, pickComposerFileReferences,
    removeComposerFileReference, openWorkspaceFilePreviewTarget, previewWorkspaceFileFromSidebar,
    closeWorkspaceFilePreviewTarget, togglePinnedFilePreviewTarget, closeOtherFilePreviewTargets,
    togglePreserveFilePreviewTargets, addWorkspaceReferenceFromSidebar, toggleFileTreeSidePanel,
    openFileTreeSidePanel, openDesignFileTreeSidePanel, setFileTreeSidePanelView,
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
    setRightSidebarWidth
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
      if (!threadId) return
      if (draft) await renameSddAssistantThreadToDraft(threadId, draft)
      if (!releaseSddAssistantThread(threadId)) return
      await useChatStore.getState().refreshThreads()
    }
  })
  useWorkbenchKeyboardShortcuts({
    composerMode,
    setComposerMode,
    handleGuiPlanCommand,
    createThread,
    chooseWorkspace,
    toggleTerminal,
    openSettings,
    useWorktreePool,
    setUseWorktreePool,
    worktreeBranch
  })

  const showDevPreviewCard =
    route === 'chat' &&
    latestDevPreviewUrl !== null

  useEffect(() => {
    const previousThreadId = prevThreadId.current
    prevThreadId.current = activeThreadId
    if (previousThreadId !== null && previousThreadId !== activeThreadId && sidePanel.open) {
      setSidePanelOpen(false)
    }
  }, [activeThreadId, setSidePanelOpen, sidePanel.open])

  const openSideChat = (): void => {
    const latestSide = currentSideConversations.at(-1)
    if (latestSide) {
      selectSideConversation(latestSide.threadId)
      return
    }
    openSideConversationDraft()
  }

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    if (rightPanelMode === 'plan' && !activeGuiPlan) {
      setRightPanelMode(null)
    }
  }, [activeGuiPlan, rightPanelMode, setRightPanelMode])

  const {
    selectedModelSupportsImageInput,
    selectedContextWindowTokens
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
    attachmentUploadBusy,
    attachmentUploadEnabled,
    attachmentUploadError,
    clearComposerAttachments,
    composerAttachments,
    getAttachmentScope,
    handlePickAttachments,
    handlePasteClipboardImage,
    removeComposerAttachment,
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
    runtimeConnection,
    runtimeInfo,
    selectedModelSupportsImageInput,
    threads,
    workspaceRoot
  })

  const {
    buildCodeCanvasOutboundPrompt,
    designThreads,
    handleDesignQualityRepairRequest,
    handleDesignRuntimeQualityFindings,
    implementDesignInCode,
    openDesignMode,
    sendCodeCanvasPrompt,
    sendDesignFromCode,
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
    createThread,
    designContextSuppressedIds,
    designHtmlElementContext,
    designWorkspaceRoot,
    ensureDesignThreadForWorkspace,
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
    composerModelGroups, composerReasoningEffort, input, resolvedWriteAssistantProviderId,
    runtimeConnection, runtimeInfo, selectedModelSupportsImageInput, sendMessage, sendPlanTurn,
    setAttachmentUploadError, setComposerMode, setError, setInput, setWriteAssistantModel,
    writeAssistantModel, clearComposerAttachments, ensureSddAssistantThreadForDraft, getAttachmentScope,
    openSddAssistantPanel,
    startNewSddAssistantConversation: startNewSddThreadConversation
  })

  const { handleSend, sendWritePrompt } = useWorkbenchComposerSubmitController({
    activeClawChannelId, activeClawChannelModel: activeClawChannel?.model,
    activeClawChannelProviderId: activeClawChannel?.providerId,
    activeSddDraft: Boolean(activeSddDraft), activeThreadId, attachmentUploadEnabled,
    buildCodeCanvasOutboundPrompt, clearComposerAttachments, clearComposerFileReferences,
    composerAttachments, composerFileReferences, composerMode, composerModelGroups,
    composerReasoningEffort, ensureWriteThreadForWorkspace, getAttachmentScope,
    handleGuiPlanCommand, input, resetClawChannelSession, rightPanelMode, route,
    selectClawChannel, sendMessage, sendPlanTurn, sendSddAssistantPrompt,
    setAttachmentUploadError, setClawChannelModel, setError, setInput, threads, workspaceRoot,
    appendLocalClawTurn
  })

  const {
    closeRightPanel, exploreSddRequirementInDesign, openCodeMode, openPluginsView, openScheduleView,
    openThread, openWorkflowView, openWriteMode, pickWriteAssistantWorkspace, sidebarView,
    startNewChat, startNewChatInWorkspace, startNewConversation, startNewWriteAssistantConversation,
    toggleConnectPhone
  } = useWorkbenchNavigationController({
    activeSddDraft: Boolean(activeSddDraft), activeThreadId, pluginHostRoute, rightPanelMode, route,
    runtimeConnection, sddDraftContent, threads, useWorktreePool, workspaceRoot, worktreeBranch,
    clearFilePreviewTargets, createConversation, createThread, createWriteThread, dismissActiveSddDraft,
    ensureWriteThreadForWorkspace, findSddDraftForSidebarThread, openClaw, openCode, openDesign,
    openPlugins, openSchedule, openWorkflow, openWrite, openSddRequirementDraftFromHistory,
    selectThread, setConnectPhoneSidebarOpen, setDesignAssistantOpen, setFilePreviewTarget, setInput,
    setRightPanelMode, setRoute, setUseWorktreePool, setWriteAssistantOpen
  })

  const chatComposerProps = useWorkbenchChatComposerProps({
    input, setInput, composerMode, setComposerMode, busy, route, runtimeReady: runtimeConnection === 'ready',
    activeThreadId, selectedContextWindowTokens, runtimeInfo, activeClawChannelId,
    activeClawChannelModel: activeClawChannel?.model, composerModel, composerProviderId, composerPickList,
    composerModelGroups, composerReasoningEffort, setComposerReasoningEffort, lockVisionToTextModelSwitch,
    setClawChannelModel, setComposerModel, openProvidersSettings: () => openSettings('providers'), handleSend,
    composerAttachments, attachmentUploadEnabled, attachmentUploadBusy, attachmentUploadError,
    activeSddDraft: Boolean(activeSddDraft), composerFileReferences,
    extraFileMentionCandidates: designDocumentFileMentionCandidates, webAccessAvailable,
    composerExecutionSettings, composerExecutionApplying, composerChangeSummary, runtimeSkills, disabledSkillIds,
    handlePickAttachments, handlePasteClipboardImage, removeComposerAttachment, addComposerFileReference,
    pickComposerFileReferences, openFileTreeSidePanel, openDesignFileTreeSidePanel,
    removeComposerFileReference, queuedMessages,
    removeQueuedMessage, interrupt, handleGuiPlanCommand, useWorktreePool, worktreeBranch, setWorktreeBranch,
    setUseWorktreePool, createThread, activeSkillWorkspace, reviewActiveThread, updateComposerExecutionSettings,
    openChangesPanel: () => setRightPanelMode('changes'),
    runtimeConnectionReady: runtimeConnection === 'ready',
    spawnSideConversation, openSideConversationDraft
  })
  const rightPanelSharedProps = buildWorkbenchRightPanelSharedProps({
    input, setInput, mode: composerMode, setMode: setComposerMode, busy, runtimeConnection,
    activeThreadId, blocks, liveReasoning, liveAssistant, composerModelGroups, composerReasoningEffort,
    setComposerReasoningEffort, queuedMessages, removeQueuedMessage, attachments: composerAttachments,
    attachmentUploadEnabled, attachmentUploadBusy, attachmentUploadError,
    onPickAttachments: (files) => void handlePickAttachments(files),
    onPasteClipboardImage: (options) => void handlePasteClipboardImage(options),
    onRemoveAttachment: removeComposerAttachment,
    onInterrupt: (options) => void interrupt(options),
    onRetryConnection: () => void probeRuntime('user', { restart: true }),
    onConfigureProviders: () => openSettings('providers')
  })

  const { writeRuntimeBanner, conversationRuntimeBanner } = useWorkbenchRuntimeBanners({
    runtimeStatus,
    runtimeConnection,
    runtimeLogPath,
    runtimeError: error,
    runtimeErrorDetail,
    activeThreadId,
    stageInsetClass,
    runtimeActionNeedsConnection: t('runtimeActionNeedsConnection'),
    t,
    onOpenSettings: () => openSettings('agents'),
    onRetryConnection: () => void probeRuntime('user', { restart: true })
  })
  const { planPanelInOverlay, planPanelProps, planOverlay } = useWorkbenchPlanPanelRuntime({
    route,
    activeSddDraft: Boolean(activeSddDraft),
    rightPanelMode,
    activeSkillWorkspace,
    activeThreadId,
    runtimeReady: runtimeConnection === 'ready',
    busy,
    title: t('planPanelTitle'),
    cancelLabel: t('cancel'),
    onClose: closeRightPanel,
    onBuildPlan: () => void buildGuiPlan(),
    onVerifyPlan: () => void verifyGuiPlan(),
    onReplanChanged: (ids) => void replanChangedRequirements(ids),
    setRightPanelMode
  })
  const rightPanelDockedVisible = rightPanelVisible && !planPanelInOverlay

  const imageAnnotationHost = (
    <WorkbenchImageAnnotationHost
      route={route}
      activeSddDraft={Boolean(activeSddDraft)}
      canvasDocumentKey={canvasDocumentKey}
      canvasDocument={canvasDocument}
      activeCodeCanvasWorkspace={activeCodeCanvasWorkspace}
      designWorkspaceRoot={designWorkspaceRoot}
      fallbackWorkspaceRoot={workspaceRoot}
      setError={setError}
      sendCodeCanvasPrompt={sendCodeCanvasPrompt}
      sendDesignPrompt={sendDesignPrompt}
    />
  )

  const rightPanel = useWorkbenchRightPanelElement({
    visible: rightPanelDockedVisible,
    width: rightSidebarWidth,
    route,
    rightPanelMode,
    onBeginResize: beginRightResize,
    writeAssistantOpen,
    shared: rightPanelSharedProps,
    planPanelProps,
    onCollapse: closeRightPanel,
    openSettings,
    onSend: handleSend,
    design: {
      implementOpen: designImplementOpen,
      assistantOpen: designAssistantOpen,
      implementTitle: designImplementTitle,
      implementationWorkspaceRoot: workspaceRoot,
      implementationComposer: {
        composerModel,
        composerProviderId,
        composerPickList,
        setComposerModel
      },
      assistantComposer: {
        composerModel: designAssistantModel,
        composerProviderId: resolvedDesignAssistantProviderId,
        composerPickList: designAssistantPickList,
        setComposerModel: setDesignAssistantModel
      },
      contextChips: designContextChips,
      input,
      onRemoveContextChip: removeDesignContextChip,
      onSendPrompt: sendDesignPrompt,
      createThread: createDesignThread,
      threads: designThreads,
      onSwitchThread: switchDesignThread,
      fallbackWorkspaceRoot: workspaceRoot
    },
    write: {
      composerModel: writeAssistantModel,
      composerProviderId: resolvedWriteAssistantProviderId,
      composerPickList: writeAssistantPickList,
      skillCommands: runtimeSkills,
      disabledSkillIds,
      setComposerModel: setWriteAssistantModel,
      onNewConversation: startNewWriteAssistantConversation,
      onPickWorkspace: () => void pickWriteAssistantWorkspace()
    },
    sdd: {
      draft: activeSddDraft,
      composerModel: writeAssistantModel,
      composerProviderId: resolvedWriteAssistantProviderId,
      composerPickList: writeAssistantPickList,
      setComposerModel: setWriteAssistantModel,
      onApplyFramework: applySddFramework,
      onNewConversation: () => {
        if (!activeSddDraft) return
        startNewSddAssistantConversation()
      }
    },
    changes: { blocks },
    todo: { onOpenPlan: openGuiPlanPanel },
    browser: { blocks: devPreviewBlocks, preferredUrl: latestDevPreviewUrl },
    canvas: { workspaceRoot: activeCodeCanvasWorkspace, activeThreadId },
    file: {
      target: filePreviewTarget,
      openTargets: openFilePreviewTargets,
      workspaceRoot,
      onSelectTarget: openWorkspaceFilePreviewTarget,
      onCloseTarget: closeWorkspaceFilePreviewTarget,
      pinnedTargetKeys: pinnedFilePreviewTargetKeys,
      preserveAcrossThreads: preserveFilePreviewTargets,
      onTogglePinnedTarget: togglePinnedFilePreviewTarget,
      onCloseOtherTargets: closeOtherFilePreviewTargets,
      onTogglePreserveAcrossThreads: togglePreserveFilePreviewTargets,
      onRedesign: sendDesignFromCode
    }
  })

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
      <WorkbenchLeftSidebar
        collapsed={leftSidebarCollapsed}
        width={leftSidebarWidth}
        route={route}
        codeThreads={codeThreads}
        activeThreadId={activeThreadId}
        sidebarView={sidebarView}
        connectPhoneSidebarOpen={connectPhoneSidebarOpen}
        runtimeReady={runtimeConnection === 'ready'}
        threadSearch={threadSearch}
        showArchivedThreads={showArchivedThreads}
        focusModeEnabled={focusModeEnabled}
        onFocusModeChange={updateFocusMode}
        onThreadSearchChange={setThreadSearch}
        onSelectThread={openThread}
        onRenameThread={renameThread}
        onPinThread={pinThread}
        onArchiveThread={(id) => archiveThread(id, true)}
        onDeleteThread={deleteThread}
        onRestoreThread={(id) => archiveThread(id, false)}
        onNewChat={startNewChat}
        onNewChatInWorkspace={startNewChatInWorkspace}
        onNewRequirement={() => void startNewSddRequirement()}
        onOpenRequirementDraft={(draft) => void openSddRequirementDraftFromHistory(draft)}
        onOpenSettings={(section) => openSettings(section)}
        onOpenPlugins={openPluginsView}
        onToggleTheme={toggleTheme}
        onToggleConnectPhone={toggleConnectPhone}
        onCodeOpen={openCodeMode}
        onWriteOpen={openWriteMode}
        onDesignOpen={openDesignMode}
        onScheduleOpen={openScheduleView}
        onWorkflowOpen={openWorkflowView}
        onNewConversation={startNewConversation}
        onBeginResize={beginLeftResize}
      />

      <WorkbenchStageRouter
        route={route}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={toggleLeftSidebar}
        onOpenThread={openThread}
        design={{
          leftSidebarCollapsed,
          onToggleLeftSidebar: toggleLeftSidebar,
          busy,
          onOpenAgentSettings: () => openSettings('design'),
          onImplementDesign: implementDesignInCode,
          onUseElementAsContext: handleDesignHtmlElementAsContext,
          onScreenCreated: (shapeId, userPrompt, brief) => {
            selectCanvasShape(shapeId)
            // Prefer the agent's expanded screen brief over the raw user prompt.
            const screenPrompt = brief?.trim() || userPrompt || 'Design this screen'
            sendDesignPrompt(screenPrompt, { screenShapeId: shapeId })
          },
          onRuntimeQualityFindings: handleDesignRuntimeQualityFindings,
          onRequestQualityRepair: handleDesignQualityRepairRequest,
          rightPanel
        }}
        write={{
          runtimeBanner: writeRuntimeBanner,
          leftSidebarCollapsed,
          onToggleLeftSidebar: toggleLeftSidebar,
          input,
          setInput,
          onSubmitPrompt: sendWritePrompt,
          onOpenAgentSettings: () => openSettings('write'),
          rightPanel
        }}
        conversation={{
          route,
          runtimeBanner: conversationRuntimeBanner,
          activeSddDraft: Boolean(activeSddDraft),
          sdd: {
            leftSidebarCollapsed,
            assistantOpen: rightPanelMode === 'sdd-ai',
            onToggleLeftSidebar: toggleLeftSidebar,
            onToggleAssistant: () => void toggleSddAssistantPanel(),
            onAssistantQuote: quoteToSddAssistant,
            onPrototypeTurn: sendSddPrototypeTurn,
            onExploreInDesign: exploreSddRequirementInDesign,
            onNext: () => void handleSddNextStep(),
            onClose: () => dismissActiveSddDraft({ closeAssistant: true }),
            nextDisabled: busy || runtimeConnection !== 'ready' || sddDraftOperationStatus === 'upgrading'
          },
          chat: {
            stageInsetClass,
            leftSidebarCollapsed,
            busy,
            focusModeEnabled,
            uiModeCameosEnabled,
            blocks: timelineBlocks,
            liveReasoning: timelineLiveReasoning,
            liveAssistant: timelineLiveAssistant,
            activeThreadId,
            runtimeConnection,
            runtimeError: error,
            planActionsBusy: busy,
            devPreviewVisible: showDevPreviewCard,
            devPreviewUrl: latestDevPreviewUrl,
            devPreviewOpened: rightPanelMode === 'browser',
            returnParentTitle: threads.find((thread) => thread.id === activeThreadParentId)?.title?.trim() ?? '',
            showReturnBar: activeThreadRelation === 'side' && Boolean(activeThreadParentId),
            composerProps: chatComposerProps,
            terminalOpen,
            terminalWorkspaceRoot: fileTreeWorkspaceRoot,
            terminalHeight,
            onToggleLeftSidebar: toggleLeftSidebar,
            onRetryConnection: () => void probeRuntime('user', { restart: true }),
            onOpenSettings: () => openSettings('agents'),
            onSelectSuggestion: (text) => setInput(text),
            onBuildPlan: () => void buildGuiPlan(),
            onOpenPlan: openGuiPlanPanel,
            onOpenDevPreview: openDevPreview,
            onBackToParent: () => {
              if (activeThreadParentId) void selectThread(activeThreadParentId)
            },
            onBeginTerminalResize: beginTerminalResize,
            onToggleTerminal: toggleTerminal
          },
          sideChat: {
            open: sidePanel.open,
            count: currentSideConversations.length,
            runningCount: currentSideRunningCount,
            enabled: runtimeConnection === 'ready' && Boolean(activeThreadId),
            onOpen: openSideChat
          },
          rightPanel,
          rightPanelDockedVisible,
          rightSidebarWidth,
          fileTree: {
            open: fileTreeSidePanelOpen,
            view: fileTreeSidePanelView,
            width: FILE_TREE_SIDEBAR_WIDTH,
            workspaceRoot: fileTreeWorkspaceRoot,
            designWorkspaceRoot: normalizeWorkspaceRoot(designWorkspaceRoot || workspaceRoot),
            designDocuments,
            activeDesignDocumentId: designActiveDocumentId,
            selectedTarget: filePreviewTarget,
            onViewChange: setFileTreeSidePanelView,
            onPreviewFile: previewWorkspaceFileFromSidebar,
            onAddReference: addWorkspaceReferenceFromSidebar
          },
          sideRail: {
            rightPanelMode,
            onToggleRightPanelMode: toggleRightPanelMode,
            planPanelEnabled: Boolean(activeGuiPlan),
            onToggleFileTree: toggleFileTreeSidePanel
          }
        }}
        imageAnnotationHost={imageAnnotationHost}
        planOverlay={planOverlay}
      />
    </div>
  )
}
