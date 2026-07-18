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
import { normalizeWorkspaceRoot, workspaceRootScopeKey } from '../lib/workspace-path'
import {
  relativeWorkspacePath,
} from '../lib/composer-file-references'
import { useDesignWorkspaceStore } from '../design/design-workspace-store'
import { designDocumentComposerFileReferences } from '../design/design-document-file-reference'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
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
  ExtensionWorkbenchClientError,
  type ExtensionManagementEntry,
  type ExtensionManagementVersion
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
import { getSlashQuery } from './chat/floating-composer-commands'

const FILE_TREE_SIDEBAR_WIDTH = 320
const extensionSurfaceLayoutStorage = {
  getItem: readBrowserStorageItem,
  setItem: writeBrowserStorageItem,
  removeItem: removeBrowserStorageItem
}

function selectedExtensionVersion(
  entry: ExtensionManagementEntry
): ExtensionManagementVersion | undefined {
  if (entry.useDevelopment) return entry.development
  return entry.versions.find((version) => version.version === entry.selectedVersion)
}

export function Workbench(): ReactElement {
  const { t, i18n } = useTranslation('common')
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
    extensionComposerContexts, attachExtensionComposerContext, removeExtensionComposerContext,
    removeQueuedMessage, guideQueuedMessage, interrupt, probeRuntime, composerModel, composerProviderId,
    composerPickList, composerModelGroups, disabledSkillIds, composerMode, setComposerMode,
    setComposerModel, setThreadSearch, renameThread, pinThread, archiveThread, deleteThread,
    clearActiveThreadSelection, spawnSideConversation, openSideConversationDraft, selectSideConversation, setSidePanelOpen,
    sideConversations, sidePanel
  } = useWorkbenchChatStoreState()
  const extensionWorkspaceRoot = useMemo(
    () => resolveActiveExtensionWorkspaceRoot(activeThreadId, threads, workspaceRoot),
    [activeThreadId, threads, workspaceRoot]
  )
  useEffect(() => {
    if (typeof window.kunGui?.onExtensionComposerContext !== 'function') return
    return window.kunGui.onExtensionComposerContext(attachExtensionComposerContext)
  }, [attachExtensionComposerContext])
  const extensionComposerContextChips = useMemo(() => {
    if (route !== 'chat') return []
    const workspace = workspaceRootScopeKey(extensionWorkspaceRoot)
    return extensionComposerContexts
      .filter((event) => workspaceRootScopeKey(event.workspaceRoot) === workspace)
      .map((event) => ({
        id: event.attachment.attachmentId,
        kind: 'extension-context' as const,
        label: event.attachment.title,
        detail: event.attachment.summary,
        removable: true
      }))
  }, [extensionComposerContexts, extensionWorkspaceRoot, route])
  const extensionContributionLoadContext = useMemo<ExtensionContributionLoadContext>(() => ({
    workspaceRoot: extensionWorkspaceRoot,
    locale: i18n.language
  }), [extensionWorkspaceRoot, i18n.language])
  const extensionContributionLoadContextRef =
    useCommittedExtensionContributionLoadContext(extensionContributionLoadContext)
  const [input, setInput] = useState('')
  const [useWorktreePool, setUseWorktreePool] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [composerReasoningEffort, setComposerReasoningEffort] =
    useState<ComposerReasoningEffort>('max')
  const [connectPhoneSidebarOpen, setConnectPhoneSidebarOpen] = useState(false)
  const designDocuments = useDesignWorkspaceStore((s) => s.documents)
  const { focusModeEnabled, runtimeLogPath, toggleTheme, uiModeCameosEnabled, updateFocusMode } =
    useWorkbenchUiRuntime()
  const contributionContext = useMemo(
    () => workbenchContextForRoute(route, extensionWorkspaceRoot),
    [extensionWorkspaceRoot, route]
  )
  const contributionLoadState = useExtensionContributionLoadState()
  const extensionContributionSnapshotReady = isExtensionContributionSnapshotReady(
    contributionLoadState,
    extensionWorkspaceRoot,
    i18n.language
  )
  const extensionLeftSidebarItems = useWorkbenchContributions(
    'views.leftSidebar',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionRightPanelItems = useWorkbenchContributions(
    'views.rightSidebar',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionRightRailItems = useExtensionRightRailViewEntries(
    contributionContext,
    extensionContributionSnapshotReady
  )
  const extensionAuxiliaryPanelItems = useWorkbenchContributions(
    'views.auxiliaryPanel',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionEditorTabItems = useWorkbenchContributions(
    'views.editorTab',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const extensionFullPageItems = useWorkbenchContributions(
    'views.fullPage',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.owner.kind === 'extension')
  const [activeExtensionSurfaceId, setActiveExtensionSurfaceId] = useState<string | null>(() =>
    readStoredExtensionSurfaceId(extensionSurfaceLayoutStorage))
  const extensionAuthorizationInFlightRef = useRef<{
    extensionId: string
    context: ExtensionContributionLoadContext
  } | null>(null)
  const selectExtensionSurface = useCallback((contributionId: string | null): void => {
    setActiveExtensionSurfaceId(contributionId)
    writeStoredExtensionSurfaceId(extensionSurfaceLayoutStorage, contributionId)
  }, [])
  const extensionSurfaceItems = useMemo<ExtensionWorkbenchView[]>(() => [
    ...extensionLeftSidebarItems,
    ...extensionRightPanelItems,
    ...extensionAuxiliaryPanelItems,
    ...extensionEditorTabItems,
    ...extensionFullPageItems
  ], [
    extensionAuxiliaryPanelItems,
    extensionEditorTabItems,
    extensionFullPageItems,
    extensionLeftSidebarItems,
    extensionRightPanelItems
  ])
  const extensionTopBarActions = useWorkbenchContributions(
    'actions.topBar', contributionContext, extensionContributionSnapshotReady)
  const extensionComposerActions = useWorkbenchContributions(
    'actions.composer', contributionContext, extensionContributionSnapshotReady)
  const extensionMessageActions = useWorkbenchContributions(
    'actions.message', contributionContext, extensionContributionSnapshotReady)
  const extensionCommands = useWorkbenchContributions(
    'commands', contributionContext, extensionContributionSnapshotReady)
  const extensionHostContextMenus = useWorkbenchContributions(
    'contextMenus',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => ['workspace', 'editor', 'view'].includes(contribution.payload.location))
  const extensionMessageContextMenus = useWorkbenchContributions(
    'contextMenus',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.payload.location === 'message')
  const extensionAttachmentContextMenus = useWorkbenchContributions(
    'contextMenus',
    contributionContext,
    extensionContributionSnapshotReady
  ).filter((contribution) => contribution.payload.location === 'attachment')
  const extensionResultPreviews = useWorkbenchContributions(
    'message.resultPreviews',
    contributionContext,
    extensionContributionSnapshotReady
  )
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{
    position: { x: number; y: number }
    location: 'workspace' | 'editor' | 'view'
    contributionId?: string
  } | null>(null)
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
    latestAutoOpenDevPreviewUrl, latestDevPreviewUrl,
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
  const { runtimeInfo, runtimeSkills } = useWorkbenchRuntimeMetadata({
    activeSkillWorkspace,
    runtimeConnection,
    skillMenuOpen: getSlashQuery(input) !== null
  })
  const {
    activateRightPanelTab, beginLeftResize, beginRightResize, beginTerminalResize, closeRightPanelTab,
    codeRightTabs, collapseRightPanel, expandRightPanel, filePreviewTarget,
    leftSidebarCollapsed, leftSidebarWidth, openDevPreview, rightPanelMode, rightPanelVisible,
    openRightPanelTab, rightSidebarWidth, setFilePreviewTarget, setRightPanelMode,
    setRightSidebarWidth, shellRef, terminalHeight, terminalOpen, toggleLeftSidebar, toggleTerminal,
  } = useWorkbenchLayout({
    activeThreadId,
    designAssistantOpen,
    designImplementOpen,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    route,
    workspaceRoot: extensionWorkspaceRoot,
    writeAssistantOpen
  })
  const activeExtensionRightPanel = rightPanelMode && isExtensionContributionId(rightPanelMode)
    ? extensionRightPanelItems.find((contribution) => contribution.id === rightPanelMode)
    : undefined
  const activeExtensionSurface = activeExtensionSurfaceId
    ? extensionSurfaceItems.find((contribution) => contribution.id === activeExtensionSurfaceId)
    : undefined
  const activeExtensionLeftSidebar = activeExtensionSurface?.point === 'views.leftSidebar'
    ? activeExtensionSurface
    : undefined
  const activeExtensionAuxiliaryPanel = activeExtensionSurface?.point === 'views.auxiliaryPanel'
    ? activeExtensionSurface
    : undefined
  const activeExtensionCenterView = activeExtensionSurface?.point === 'views.editorTab' ||
    activeExtensionSurface?.point === 'views.fullPage'
    ? activeExtensionSurface
    : undefined

  const openExtensionSurface = useCallback((view: ExtensionWorkbenchView): void => {
    if (view.point === 'views.rightSidebar') {
      selectExtensionSurface(null)
      setRoute('chat')
      if (isExtensionContributionId(view.id)) {
        openRightPanelTab(view.id)
      }
      return
    }
    if (view.point === 'views.leftSidebar' && leftSidebarCollapsed) toggleLeftSidebar()
    setRightPanelMode(null)
    selectExtensionSurface(view.id)
  }, [
    leftSidebarCollapsed,
    openRightPanelTab,
    selectExtensionSurface,
    setRoute,
    setRightPanelMode,
    toggleLeftSidebar
  ])

  const selectRightRailExtension = useCallback((entry: ExtensionRightRailViewEntry): void => {
    const runnable = workbenchContributionRegistry.get(entry.id, contributionContext)
    if (isExtensionWorkbenchView(runnable) && runnable.point === 'views.rightSidebar') {
      openExtensionSurface(runnable)
      return
    }
    if (
      entry.owner.kind !== 'extension' ||
      entry.workspaceTrusted ||
      !extensionWorkspaceRoot
    ) return

    const extensionId = entry.owner.extensionId
    const loadContext = extensionContributionLoadContext
    const currentAuthorization = extensionAuthorizationInFlightRef.current
    if (
      currentAuthorization &&
      sameExtensionContributionLoadContext(currentAuthorization.context, loadContext)
    ) return
    const authorization = { extensionId, context: loadContext }
    extensionAuthorizationInFlightRef.current = authorization
    const contextIsCurrent = (): boolean => sameExtensionContributionLoadContext(
      loadContext,
      extensionContributionLoadContextRef.current
    )
    void (async () => {
      try {
        const extensions = await extensionWorkbenchClient.listExtensions(
          loadContext.workspaceRoot,
          loadContext.locale
        )
        if (!contextIsCurrent()) return
        const extension = extensions.find((candidate) =>
          candidate.id === extensionId)
        const selected = extension ? selectedExtensionVersion(extension) : undefined
        if (!selected) throw new Error(t('extensionRailVersionUnavailable'))
        await extensionWorkbenchClient.setPermissions(
          extensionId,
          selected.version,
          selected.grantedPermissions,
          loadContext.workspaceRoot
        )
        if (!contextIsCurrent()) return
        const outcome = await refreshExtensionContributionSnapshot(
          loadContext.workspaceRoot,
          loadContext.locale
        )
        if (outcome !== 'applied' || !contextIsCurrent()) return
        const authorized = workbenchContributionRegistry.get(entry.id, contributionContext)
        if (!isExtensionWorkbenchView(authorized) || authorized.point !== 'views.rightSidebar') {
          throw new Error(t('extensionRailRequiredPermissionsMissing'))
        }
        openExtensionSurface(authorized)
      } catch (error) {
        if (!contextIsCurrent()) return
        if (
          error instanceof ExtensionWorkbenchClientError &&
          error.code === 'EXTENSION_CONSENT_DENIED'
        ) return
        const detail = error instanceof Error ? error.message : String(error)
        setError(t('extensionRailAuthorizationFailed', { detail }))
      } finally {
        if (extensionAuthorizationInFlightRef.current === authorization) {
          extensionAuthorizationInFlightRef.current = null
        }
      }
    })()
  }, [
    contributionContext,
    extensionContributionLoadContext,
    extensionContributionLoadContextRef,
    extensionWorkspaceRoot,
    openExtensionSurface,
    setError,
    t
  ])

  const openManagedExtensionView = useCallback(async (contributionId: string): Promise<void> => {
    let contribution = workbenchContributionRegistry.get(contributionId, contributionContext)
    if (!isExtensionWorkbenchView(contribution)) {
      const loadContext = extensionContributionLoadContext
      const outcome = await refreshExtensionContributionSnapshot(
        loadContext.workspaceRoot,
        loadContext.locale
      )
      if (
        outcome !== 'applied' ||
        !sameExtensionContributionLoadContext(
          loadContext,
          extensionContributionLoadContextRef.current
        )
      ) return
      contribution = workbenchContributionRegistry.get(contributionId, contributionContext)
    }
    if (!isExtensionWorkbenchView(contribution)) {
      const diagnostics = workbenchContributionRegistry.getDiagnostics()
        .filter((diagnostic) => diagnostic.contributionId === contributionId ||
          contributionId.startsWith(`extension:${diagnostic.extensionId ?? ''}/`))
      const detail = diagnostics[0]?.message
      throw new Error(detail
        ? t('extensionViewOpenFailedDetail', { detail })
        : t('extensionViewOpenFailed'))
    }
    openExtensionSurface(contribution)
  }, [
    contributionContext,
    extensionContributionLoadContext,
    extensionContributionLoadContextRef,
    openExtensionSurface,
    t
  ])

  useEffect(() => {
    setActiveExtensionSurfaceId(readStoredExtensionSurfaceId(extensionSurfaceLayoutStorage))
  }, [extensionWorkspaceRoot])

  useEffect(() => {
    if (!extensionContributionSnapshotReady) return
    const availableIds = new Set(extensionRightPanelItems.map((contribution) => contribution.id))
    for (const id of codeRightTabs.tabs) {
      if (isExtensionContributionId(id) && !availableIds.has(id)) closeRightPanelTab(id)
    }
  }, [
    closeRightPanelTab,
    codeRightTabs.tabs,
    extensionContributionSnapshotReady,
    extensionRightPanelItems
  ])

  useEffect(() => {
    if (
      extensionContributionSnapshotReady &&
      activeExtensionSurfaceId &&
      !activeExtensionSurface
    ) selectExtensionSurface(null)
  }, [activeExtensionSurface, activeExtensionSurfaceId, extensionContributionSnapshotReady, selectExtensionSurface])
  const {
    composerFileReferences, fileTreeSidePanelView, openFilePreviewTargets,
    pinnedFilePreviewTargetKeys, preserveFilePreviewTargets, fileTreeWorkspaceRoot,
    clearComposerFileReferences, addComposerFileReference, pickComposerFileReferences,
    removeComposerFileReference, openWorkspaceFilePreviewTarget, previewWorkspaceFileFromSidebar,
    closeWorkspaceFilePreviewTarget, togglePinnedFilePreviewTarget, closeOtherFilePreviewTargets,
    togglePreserveFilePreviewTargets, addWorkspaceReferenceFromSidebar,
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

  const openSideChat = useCallback((): void => {
    const latestSide = currentSideConversations.at(-1)
    if (latestSide) {
      selectSideConversation(latestSide.threadId)
      return
    }
    openSideConversationDraft()
  }, [currentSideConversations, openSideConversationDraft, selectSideConversation])

  const openWorkspaceFileTreeTab = useCallback((): void => {
    openFileTreeSidePanel()
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.files)
  }, [openFileTreeSidePanel, openRightPanelTab])

  const openDesignFileTreeTab = useCallback((): void => {
    openDesignFileTreeSidePanel()
    openRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.files)
  }, [openDesignFileTreeSidePanel, openRightPanelTab])

  const openCodeRightTool = useCallback((id: RightPanelContributionId): void => {
    if (id === BUILTIN_RIGHT_PANEL_IDS.terminal) {
      toggleTerminal()
      return
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) openSideChat()
    if (id === BUILTIN_RIGHT_PANEL_IDS.files) setFileTreeSidePanelView('workspace')
    openRightPanelTab(id)
  }, [openRightPanelTab, openSideChat, setFileTreeSidePanelView, toggleTerminal])

  const closeCodeRightTool = useCallback((id: RightPanelContributionId): void => {
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) setSidePanelOpen(false)
    closeRightPanelTab(id)
  }, [closeRightPanelTab, setSidePanelOpen])

  const toggleCodeRightWorkspace = useCallback((): void => {
    if (codeRightTabs.expanded) {
      collapseRightPanel()
      return
    }
    expandRightPanel()
  }, [
    codeRightTabs.expanded,
    collapseRightPanel,
    expandRightPanel
  ])

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    const unavailable: RightPanelContributionId[] = []
    if (!activeGuiPlan) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.plan)
    if (!fileTreeWorkspaceRoot) {
      unavailable.push(BUILTIN_RIGHT_PANEL_IDS.files)
    }
    if (!filePreviewTarget) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.file)
    if (!activeThreadId) unavailable.push(BUILTIN_RIGHT_PANEL_IDS.sideConversations)
    for (const id of unavailable) {
      if (codeRightTabs.tabs.includes(id)) closeRightPanelTab(id)
    }
  }, [
    activeGuiPlan,
    activeThreadId,
    closeRightPanelTab,
    codeRightTabs.tabs,
    filePreviewTarget,
    fileTreeWorkspaceRoot
  ])

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
    removeComposerAttachments,
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
    buildCodeCanvasOutboundPrompt, clearComposerAttachments, removeComposerAttachments, clearComposerFileReferences,
    composerAttachments, composerFileReferences, composerMode, composerModelGroups,
    composerReasoningEffort, getAttachmentScope,
    handleGuiPlanCommand, input, resetClawChannelSession, rightPanelMode, route,
    selectClawChannel, sendMessage, sendPlanTurn, sendSddAssistantPrompt,
    setAttachmentUploadError, setClawChannelModel, setError, setInput, threads, workspaceRoot,
    appendLocalClawTurn
  })

  const {
    closeRightPanel, exploreSddRequirementInDesign, openCodeMode, openPluginsView, openExtensionsView, openScheduleView,
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
    composerModelGroups, composerReasoningEffort, setComposerReasoningEffort,
    setClawChannelModel, setComposerModel, openProvidersSettings: () => openSettings('providers'), handleSend,
    composerAttachments,
    contextChips: extensionComposerContextChips,
    removeContextChip: removeExtensionComposerContext,
    attachmentUploadEnabled, attachmentUploadBusy, attachmentUploadError,
    activeSddDraft: Boolean(activeSddDraft), composerFileReferences,
    extraFileMentionCandidates: designDocumentFileMentionCandidates, webAccessAvailable,
    composerExecutionSettings, composerExecutionApplying, composerChangeSummary, runtimeSkills, disabledSkillIds,
    handlePickAttachments, handlePasteClipboardImage, removeComposerAttachment, addComposerFileReference,
    pickComposerFileReferences, openFileTreeSidePanel: openWorkspaceFileTreeTab,
    openDesignFileTreeSidePanel: openDesignFileTreeTab,
    removeComposerFileReference, queuedMessages,
    removeQueuedMessage, guideQueuedMessage, interrupt, handleGuiPlanCommand, useWorktreePool, worktreeBranch, setWorktreeBranch,
    setUseWorktreePool, createThread, activeSkillWorkspace, reviewActiveThread, updateComposerExecutionSettings,
    openChangesPanel: () => setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.changes),
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
    onClose: route === 'chat'
      ? () => closeRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.plan)
      : closeRightPanel,
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
      onTogglePreserveAcrossThreads: togglePreserveFilePreviewTargets
    },
    extensionView: activeExtensionRightPanel,
    code: {
      state: codeRightTabs,
      sideConversationCount: currentSideConversations.length,
      sideConversationRunningCount: currentSideRunningCount,
      files: {
        open: true,
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
      extensionItems: extensionRightRailItems,
      extensionViews: extensionRightPanelItems,
      onActivate: activateRightPanelTab,
      onClose: closeCodeRightTool
    },
    workspaceRoot: extensionWorkspaceRoot
  })

  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          extensionHostContextMenus.length === 0 ||
          !canOpenHostContextMenuForTarget(event.target)
        ) return
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('[data-extension-message-context]')) return
        const viewRoot = target?.closest<HTMLElement>('.ds-extension-view')
        const location = viewRoot
          ? 'view'
          : activeExtensionCenterView || route === 'design' || route === 'write'
            ? 'editor'
            : 'workspace'
        if (!extensionHostContextMenus.some((item) => item.payload.location === location)) return
        event.preventDefault()
        setWorkspaceContextMenu({
          position: { x: event.clientX, y: event.clientY },
          location,
          ...(viewRoot?.dataset.contributionId
            ? { contributionId: viewRoot.dataset.contributionId }
            : {})
        })
      }}
    >
      <WorkbenchLeftSidebar
        collapsed={leftSidebarCollapsed || activeExtensionCenterView?.point === 'views.fullPage'}
        width={leftSidebarWidth}
        route={route}
        codeThreads={codeThreads}
        activeThreadId={activeThreadId}
        sidebarView={sidebarView}
        connectPhoneSidebarOpen={connectPhoneSidebarOpen}
        extensionsActive={route === 'extensions'}
        extensionView={activeExtensionLeftSidebar}
        workspaceRoot={extensionWorkspaceRoot}
        onCloseExtensionView={() => selectExtensionSurface(null)}
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
        onOpenExtensions={openExtensionsView}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {activeExtensionCenterView ? (
        <main className="ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="ds-stage-route-host relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ExtensionViewOutlet
              contribution={activeExtensionCenterView}
              workspaceRoot={extensionWorkspaceRoot}
              onClose={() => selectExtensionSurface(null)}
            />
          </div>
        </main>
      ) : (
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
          onSvgCreated: async (artifactId, shapeId, userPrompt, brief) => {
            selectCanvasShape(shapeId)
            return sendDesignPrompt(brief || userPrompt || 'Create this SVG motion design', {
              svgArtifactId: artifactId
            })
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
            assistantOpen: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi,
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
            devPreviewOpened: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.browser,
            returnParentTitle: threads.find((thread) => thread.id === activeThreadParentId)?.title?.trim() ?? '',
            showReturnBar: activeThreadRelation === 'side' && Boolean(activeThreadParentId),
            composerProps: chatComposerProps,
            terminalOpen,
            terminalWorkspaceRoot: fileTreeWorkspaceRoot,
            terminalHeight,
            rightWorkspaceExpanded: codeRightTabs.expanded,
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
            onToggleTerminal: toggleTerminal,
            onToggleRightWorkspace: toggleCodeRightWorkspace,
            extensionTopBarActions,
            extensionComposerActions,
            extensionMessageActions,
            extensionContextMenus: extensionMessageContextMenus,
            extensionAttachmentContextMenus,
            extensionCommands,
            extensionResultPreviews,
            onExtensionCommand: async (commandId, context) => {
              const result = await extensionWorkbenchClient.invokeCommand(
                commandId,
                context,
                extensionWorkspaceRoot || undefined
              )
              const view = resolveCommandOpenView(
                commandId,
                result,
                extensionCommands,
                extensionSurfaceItems
              )
              if (view) openExtensionSurface(view)
              return result
            }
          },
          rightPanel,
          sideRail: {
            rightPanelMode,
            onToggleRightPanelMode: openCodeRightTool,
            planPanelEnabled: Boolean(activeGuiPlan),
            canvasEnabled: true,
            sideChatCount: currentSideConversations.length,
            sideChatRunningCount: currentSideRunningCount,
            sideChatOpen: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sideConversations,
            sideChatEnabled: runtimeConnection === 'ready' && Boolean(activeThreadId),
            fileTreeOpen: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.files,
            fileTreeEnabled: Boolean(fileTreeWorkspaceRoot),
            onToggleFileTree: () => openCodeRightTool(BUILTIN_RIGHT_PANEL_IDS.files),
            onOpenSideChat: () => openCodeRightTool(BUILTIN_RIGHT_PANEL_IDS.sideConversations),
            extensionItems: extensionRightRailItems,
            onSelectExtension: selectRightRailExtension
          }
        }}
        imageAnnotationHost={imageAnnotationHost}
        planOverlay={planOverlay}
        extensions={{
          workspaceRoot: extensionWorkspaceRoot,
          onOpenIntegrations: openPluginsView,
          onOpenView: openManagedExtensionView
        }}
      />
      )}
      {activeExtensionAuxiliaryPanel ? (
        <div className="ds-no-drag h-[min(38vh,360px)] min-h-48 shrink-0 border-t border-ds-border-muted">
          <ExtensionViewOutlet
            contribution={activeExtensionAuxiliaryPanel}
            workspaceRoot={extensionWorkspaceRoot}
            onClose={() => selectExtensionSurface(null)}
          />
        </div>
      ) : null}
      </div>
      <DeclarativeContextMenuOverlay
        contributions={extensionHostContextMenus.filter(
          (contribution) => contribution.payload.location === workspaceContextMenu?.location)}
        commands={extensionCommands}
        context={{
          surface: workspaceContextMenu?.location ?? 'workspace',
          workspaceRoot: extensionWorkspaceRoot || null,
          contributionId: workspaceContextMenu?.contributionId ?? null
        }}
        position={workspaceContextMenu?.position ?? null}
        onCommand={(commandId, commandContext) =>
          extensionWorkbenchClient.invokeCommand(
            commandId,
            commandContext,
            extensionWorkspaceRoot || undefined
          )}
        onClose={() => setWorkspaceContextMenu(null)}
      />
    </div>
  )
}
