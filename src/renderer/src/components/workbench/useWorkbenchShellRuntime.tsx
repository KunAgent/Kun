import type { ReactElement } from 'react'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useWorkbenchChatComposerProps } from './useWorkbenchChatComposerProps'
import { buildWorkbenchRightPanelSharedProps } from './useWorkbenchRightPanelSharedProps'
import { useWorkbenchRuntimeBanners } from './useWorkbenchRuntimeBanners'
import { useWorkbenchPlanPanelRuntime } from './useWorkbenchPlanPanelRuntime'
import { useWorkbenchRightPanelElement } from './useWorkbenchRightPanelElement'
import { FocusedCanvasWorkspace } from './FocusedCanvasWorkspace'
import { WorkbenchImageAnnotationHost } from './WorkbenchImageAnnotationHost'

const FILE_TREE_SIDEBAR_WIDTH = 320

type Context = Record<string, any>

export function useWorkbenchShellRuntime(context: Context): {
  chatComposerProps: any
  conversationRuntimeBanner: ReactElement | null
  imageAnnotationHost: ReactElement
  planOverlay: ReactElement | null
  rightPanel: ReactElement | null
  rightPanelSharedProps: any
  writeRuntimeBanner: ReactElement | null
  focusedCanvasWorkspace: ReactElement | null
} {
  const {
    canvasFocusMode,
    exitCanvasFocusMode,
    startNewDesignCanvasConversation,
    leftSidebarCollapsed,
    toggleLeftSidebar,
    input, setInput, composerMode, setComposerMode, composerOrchestration, graphEnabled,
    taskSurface, taskSurfaceLocked, taskSurfaceTransitioning, designTaskProfile, designProfileLocked,
    threadHasDesignDocument, lockedDesignProfile, onTaskSurfaceChange,
    onDesignTaskProfileChange,
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
    handlePasteClipboardImage, removeComposerAttachment, addComposerFileReference,
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
    designWorkspaceRoot, designDocuments, designActiveDocumentId, setFileTreeSidePanelView,
    previewWorkspaceFileFromSidebar, addWorkspaceReferenceFromSidebar,
    openDesignDocumentInWhiteboard, extensionRightRailItems, extensionRightPanelItems,
    openRightPanelTab, activateRightPanelTab, closeCodeRightTool, toggleFileTreeSidePanel,
    setError, canvasDocumentKey, canvasDocument, sendCodeCanvasPrompt,
    implementDesignInCode, selectCanvasShape,
    handleDesignHtmlElementAsContext, handleDesignRuntimeQualityFindings,
    handleDesignQualityRepairRequest
  } = context
  const mainComposerContextChips = taskSurface === 'design'
    ? [...designContextChips, ...extensionComposerContextChips]
    : extensionComposerContextChips
  const removeMainComposerContext = (id: string): void => {
    if (taskSurface === 'design' && designContextChips.some((chip: { id: string }) => chip.id === id)) {
      removeDesignContextChip(id)
    } else removeComposerContextWithLinkedImage(id)
  }
  const chatComposerProps = useWorkbenchChatComposerProps({
    input, setInput, composerMode, setComposerMode, composerOrchestration, graphEnabled,
    taskSurface, taskSurfaceLocked, taskSurfaceTransitioning, designTaskProfile, designProfileLocked, onTaskSurfaceChange,
    onDesignTaskProfileChange,
    imageGenerationEnabled: runtimeInfo
      ? runtimeInfo.capabilities.imageGen?.enabled === true
      : undefined,
    imageGenerationAvailable: runtimeInfo?.capabilities.imageGen?.available === true,
    imageGenerationReason: runtimeInfo?.capabilities.imageGen?.reason,
    onConfigureImageGeneration: () => openSettings('imageGeneration'),
    setComposerOrchestration,
    openGraph: openComposerGraph,
    openGraphChild: openComposerGraphChild,
    busy, currentTurnOrchestration, route, runtimeReady: runtimeConnection === 'ready',
    activeThreadId, activeClawChannelId,
    activeClawChannelModel: activeClawChannel?.model, composerModel, composerProviderId, composerPickList,
    composerModelGroups, composerReasoningEffort, composerFastMode,
    composerPersonaId, composerPersonaEnabled, codeAgentPresets, setComposerPersonaId,
    setComposerReasoningEffort, setComposerFastMode,
    setClawChannelModel, setComposerModel, openProvidersSettings: () => openSettings('providers'), handleSend,
    composerAttachments,
    contextChips: mainComposerContextChips,
    removeContextChip: removeMainComposerContext,
    attachmentUploadEnabled, attachmentUploadBusy, attachmentUploadError,
    activeSddDraft: Boolean(activeSddDraft), composerFileReferences,
    extraFileMentionCandidates: designDocumentFileMentionCandidates, webAccessAvailable,
    composerExecutionSettings, composerExecutionApplying, runtimeSkills, disabledSkillIds,
    handlePickAttachments, handlePasteClipboardImage, removeComposerAttachment, addComposerFileReference,
    pickComposerFileReferences, openFileTreeSidePanel: openWorkspaceFileTreeTab,
    openDesignFileTreeSidePanel: openDesignFileTreeTab,
    removeComposerFileReference, queuedMessages,
    removeQueuedMessage, guideQueuedMessage, interrupt, handleGuiPlanCommand, useWorktreePool, worktreeBranch, setWorktreeBranch,
    setUseWorktreePool, createThread, activeSkillWorkspace, reviewActiveThread, updateComposerExecutionSettings,
    spawnSideConversation, openSideConversationDraft, startNewSddRequirement
  })
  const rightPanelSharedProps = buildWorkbenchRightPanelSharedProps({
    input, setInput, mode: composerMode, setMode: setComposerMode, busy, runtimeConnection,
    activeThreadId, blocks, liveReasoning, liveAssistant, composerModelGroups, composerReasoningEffort,
    setComposerReasoningEffort,
    queuedMessages, removeQueuedMessage, guideQueuedMessage,
    attachments: composerAttachments,
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
    graphEnabled,
    busy,
    title: t('planPanelTitle'),
    cancelLabel: t('cancel'),
    onClose: route === 'chat'
      ? () => closeRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.plan)
      : closeRightPanel,
    onBuildPlan: (orchestration) => void buildGuiPlan(orchestration),
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

  const dockedRightPanel = useWorkbenchRightPanelElement({
    visible: rightPanelDockedVisible,
    width: rightSidebarWidth,
    route,
    rightPanelMode,
    graphEnabled,
    onBeginResize: beginRightResize,
    writeAssistantOpen,
    shared: rightPanelSharedProps,
    planPanelProps,
    onCollapse: route === 'chat' ? collapseRightPanel : closeRightPanel,
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
        setComposerModel: setDesignAssistantModel,
        composerReasoningEffort: designComposerReasoningEffort,
        composerFastMode,
        setComposerReasoningEffort: setDesignComposerReasoningEffort,
        setComposerFastMode
      },
      contextChips: designContextChips,
      input,
      onRemoveContextChip: removeDesignContextChip,
      onSendPrompt: sendDesignPrompt,
      drawingTitle: designDrawingTitle,
      onClearHistory: clearActiveDrawingHistory,
      hasRegisteredHistory: designHasRegisteredHistory,
      threads: designThreads,
      historyThreadIds: designHistoryThreadIds,
      onSwitchThread: switchDesignThread
    },
    write: {
      composerModel: writeAssistantModel,
      composerProviderId: resolvedWriteAssistantProviderId,
      composerPickList: writeAssistantPickList,
      skillCommands: runtimeSkills,
      disabledSkillIds,
      composerFastMode,
      setComposerModel: setWriteAssistantModel,
      setComposerFastMode,
      onNewConversation: startNewWriteAssistantConversation,
      onPickWorkspace: () => void pickWriteAssistantWorkspace()
    },
    sdd: {
      draft: activeSddDraft,
      composerModel: writeAssistantModel,
      composerProviderId: resolvedWriteAssistantProviderId,
      composerPickList: writeAssistantPickList,
      composerFastMode,
      setComposerModel: setWriteAssistantModel,
      setComposerFastMode,
      onApplyFramework: applySddFramework,
      onNewConversation: () => {
        if (!activeSddDraft) return
        startNewSddAssistantConversation()
      }
    },
    changes: { blocks },
    browser: {
      blocks: devPreviewBlocks,
      preferredUrl: latestDevPreviewUrl,
      workspaceRoot: extensionWorkspaceRoot,
      activeThreadId,
      selectedElementCount: selectedPreviewElementCount,
      supportsImageCapture: selectedModelSupportsImageInput && attachmentUploadEnabled,
      onAttachContext: attachDevPreviewContext,
      onDocumentChange: clearDevPreviewContexts
    },
    canvas: {
      workspaceRoot: activeCodeCanvasWorkspace,
      activeThreadId,
      designDocumentId: lockedDesignProfile?.documentTarget.documentId,
      boardArtifactId: lockedDesignProfile?.documentTarget.boardArtifactId,
      // The full Design surface stays mounted whenever the thread owns a
      // Design document, independent of the next-turn Code/Design selection.
      designTaskActive: threadHasDesignDocument,
      onRequestImageRegenerate: (prompt) => void sendDesignPrompt(prompt),
      busy,
      onOpenAgentSettings: () => openSettings('design'),
      onImplementDesign: implementDesignInCode,
      onUseElementAsContext: handleDesignHtmlElementAsContext,
      onScreenCreated: (shapeId, userPrompt, brief) => {
        selectCanvasShape(shapeId)
        return sendDesignPrompt(brief?.trim() || userPrompt || 'Design this screen', {
          screenShapeId: shapeId
        })
      },
      onSvgCreated: async (artifactId, shapeId, userPrompt, brief) => {
        selectCanvasShape(shapeId)
        return sendDesignPrompt(brief || userPrompt || 'Create this SVG motion design', {
          svgArtifactId: artifactId
        })
      },
      onRuntimeQualityFindings: handleDesignRuntimeQualityFindings,
      onRequestQualityRepair: handleDesignQualityRepairRequest
    },
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
      onTogglePreserveAcrossThreads: togglePreserveFilePreviewTargets
    },
    extensionView: activeExtensionRightPanel,
    code: {
      state: codeRightTabs,
      activeThreadId,
      threadRunning: busy,
      sideConversationCount: currentSideConversations.length,
      sideConversationRunningCount: currentSideRunningCount,
      sideAttachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available === true,
      sideDefaultModelSupportsImageInput:
        runtimeInfo?.capabilities.model.inputModalities.includes('image') === true,
      files: {
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
        onAddReference: addWorkspaceReferenceFromSidebar,
        onOpenDesignInWhiteboard: openDesignDocumentInWhiteboard
      },
      extensionItems: extensionRightRailItems,
      extensionViews: extensionRightPanelItems,
      onOpen: openRightPanelTab,
      onActivate: activateRightPanelTab,
      onClose: closeCodeRightTool,
      onToggleFiles: toggleFileTreeSidePanel,
      onNewSideConversation: openSideConversationDraft
    },
    workspaceRoot: extensionWorkspaceRoot
  })
  // Do not merely hide the docked panel in focused mode: hidden tabs keep
  // visited content mounted, which would otherwise create a second
  // CanvasViewport for the same bound board.
  const rightPanel = canvasFocusMode ? null : dockedRightPanel

  // The focused presentation re-parents the canvas panel from the right rail
  // onto a stage-covering host, so exactly one CanvasViewport owns the bound
  // document at any time. The conversation overlay renders the SAME primary
  // design conversation that the docked rail would show.
  const focusedCanvasWorkspace = canvasFocusMode ? (
    <FocusedCanvasWorkspace
      canvas={{
        workspaceRoot: activeCodeCanvasWorkspace,
        activeThreadId,
        designDocumentId: lockedDesignProfile?.documentTarget.documentId,
        boardArtifactId: lockedDesignProfile?.documentTarget.boardArtifactId,
        designTaskActive: threadHasDesignDocument,
        onRequestImageRegenerate: (prompt) => void sendDesignPrompt(prompt),
        busy,
        onOpenAgentSettings: () => openSettings('design'),
        onImplementDesign: implementDesignInCode,
        onUseElementAsContext: handleDesignHtmlElementAsContext,
        onScreenCreated: (shapeId, userPrompt, brief) => {
          selectCanvasShape(shapeId)
          return sendDesignPrompt(brief?.trim() || userPrompt || 'Design this screen', {
            screenShapeId: shapeId
          })
        },
        onSvgCreated: async (artifactId, shapeId, userPrompt, brief) => {
          selectCanvasShape(shapeId)
          return sendDesignPrompt(brief || userPrompt || 'Create this SVG motion design', {
            svgArtifactId: artifactId
          })
        },
        onRuntimeQualityFindings: handleDesignRuntimeQualityFindings,
        onRequestQualityRepair: handleDesignQualityRepairRequest,
        onCollapse: exitCanvasFocusMode
      }}
      conversation={{
        input,
        setInput,
        mode: composerMode,
        setMode: setComposerMode,
        busy,
        runtimeConnection,
        activeThreadId,
        blocks,
        liveReasoning,
        liveAssistant,
        composerModel: designAssistantModel,
        composerProviderId: resolvedDesignAssistantProviderId,
        composerPickList: designAssistantPickList,
        composerModelGroups,
        composerReasoningEffort: designComposerReasoningEffort,
        composerFastMode,
        setComposerModel: setDesignAssistantModel,
        setComposerReasoningEffort: setDesignComposerReasoningEffort,
        setComposerFastMode,
        queuedMessages,
        removeQueuedMessage,
        guideQueuedMessage,
        attachments: composerAttachments,
        attachmentUploadEnabled,
        attachmentUploadBusy,
        attachmentUploadError,
        contextChips: designContextChips,
        onPickAttachments: (files) => void handlePickAttachments(files),
        onPasteClipboardImage: (options) => void handlePasteClipboardImage(options),
        onRemoveAttachment: removeComposerAttachment,
        onRemoveContextChip: removeDesignContextChip,
        onSend: () => sendDesignPrompt(input),
        onInterrupt: (options) => void interrupt(options),
        onRetryConnection: () => void probeRuntime('user', { restart: true }),
        onOpenSettings: (section) => openSettings((section ?? 'design') as never),
        onConfigureProviders: () => openSettings('providers'),
        designThreads,
        designHistoryThreadIds: designHistoryThreadIds,
        onSwitchThread: (id) => void switchDesignThread(id)
      }}
      onClearHistory={clearActiveDrawingHistory}
      onNewConversation={() => void startNewDesignCanvasConversation()}
      onExitFocus={exitCanvasFocusMode}
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={toggleLeftSidebar}
    />
  ) : null


  return {
    chatComposerProps,
    conversationRuntimeBanner,
    imageAnnotationHost,
    planOverlay,
    rightPanel,
    rightPanelSharedProps,
    writeRuntimeBanner,
    focusedCanvasWorkspace
  }
}
