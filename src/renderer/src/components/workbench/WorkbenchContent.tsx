import type { ReactElement } from 'react'
import { WorkbenchLeftSidebar } from './WorkbenchLeftSidebar'
import { WorkbenchStageRouter } from './WorkbenchStageRouter'
import { AgentBrowserFloatingPreview } from '../AgentBrowserFloatingPreview'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  canOpenHostContextMenuForTarget,
  DeclarativeContextMenuOverlay,
  ExtensionViewOutlet
} from '../../extensions/ControlledContributionSurfaces'
import { extensionWorkbenchClient } from '../../extensions/extension-workbench-client'
import { resolveCommandOpenView } from '../../extensions/ExtensionWorkbenchSurfaces'
import { normalizeWorkbenchRoute } from './workbench-route'
import { shouldShowSideSessionReturnBar } from './workbench-side-session-mode'

type Context = Record<string, any>

export function WorkbenchContent({ context }: { context: Context }): ReactElement {
  const {
    shellRef, extensionHostContextMenus, activeExtensionCenterView, route, setWorkspaceContextMenu,
    leftSidebarCollapsed, leftSidebarWidth, codeThreads, activeThreadId, sidebarView,
    connectPhoneSidebarOpen, connectPhoneInitialTarget, activeExtensionLeftSidebar, extensionWorkspaceRoot,
    selectExtensionSurface, runtimeConnection, threadSearch, showArchivedThreads, focusModeEnabled,
    updateFocusMode, setThreadSearch, openThread, renameThread, pinThread, archiveThread,
    deleteThread, startNewChat, startNewChatInWorkspace,
    openSettings, openPluginsView, openExtensionsView, toggleTheme, toggleConnectPhone, openConnectWeixin,
    openCodeMode, openWriteMode, openBoardView, openScheduleView, openWorkflowView,
    startNewConversation, beginLeftResize, toggleLeftSidebar, busy,
    input, rightPanel, writeRuntimeBanner, setInput, sendWritePrompt,
    conversationRuntimeBanner, activeSddDraft, rightPanelMode, toggleSddAssistantPanel,
    quoteToSddAssistant, sendSddPrototypeTurn, exploreSddRequirementInDesign, handleSddNextStep,
    dismissActiveSddDraft, sddDraftOperationStatus, stageInsetClass,
    uiModeCameosEnabled, timelineBlocks, timelineLiveReasoning, timelineLiveAssistant,
    error, guiPlanSaveStatus, graphEnabled, showDevPreviewCard, latestDevPreviewUrl, threads,
    activeThreadParentId, activeThreadRelation, graphChildContext, chatComposerProps,
    activeSkillWorkspace, terminalOpen, fileTreeWorkspaceRoot, terminalHeight, codeRightTabs,
    probeRuntime, buildGuiPlan, openGuiPlanPanel, setRightPanelMode,
    reviewActiveThread, openDevPreview, returnFromSubagent, beginTerminalResize, toggleTerminal,
    toggleCodeRightWorkspace, linkedSddDraft, openLinkedSddDraft, extensionTopBarActions,
    extensionComposerActions, extensionMessageActions, extensionMessageContextMenus,
    extensionAttachmentContextMenus, extensionCommands, extensionResultPreviews,
    messageContributionsForSurface,
    extensionSurfaceItems, openExtensionSurface, openCodeRightTool, currentSideRunningCount,
    extensionRightRailItems, selectRightRailExtension, imageAnnotationHost, planOverlay,
    openManagedExtensionView, activeExtensionAuxiliaryPanel, workspaceContextMenu, activeGuiPlan,
    focusedCanvasWorkspace, openGeneratedDocuments, openGeneratedDocumentPreview
  } = context
  const normalizedRoute = normalizeWorkbenchRoute(route)
  const activeConversationThread = threads.find((thread: any) => thread.id === activeThreadId)
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
        if (!extensionHostContextMenus.some((item: any) => item.payload.location === location)) return
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
        route={normalizedRoute}
        codeThreads={codeThreads}
        activeThreadId={activeThreadId}
        sidebarView={sidebarView}
        connectPhoneSidebarOpen={connectPhoneSidebarOpen}
        connectPhoneInitialTarget={connectPhoneInitialTarget}
        extensionsActive={normalizedRoute === 'extensions'}
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
        onOpenSettings={(section) => openSettings(section)}
        onOpenPlugins={openPluginsView}
        onOpenExtensions={openExtensionsView}
        onToggleTheme={toggleTheme}
        onToggleConnectPhone={toggleConnectPhone}
        onCodeOpen={openCodeMode}
        onWriteOpen={openWriteMode}
        onScheduleOpen={openScheduleView}
        onBoardOpen={openBoardView}
        onWorkflowOpen={openWorkflowView}
        onNewConversation={startNewConversation}
        onBeginResize={beginLeftResize}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
        route={normalizedRoute}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={toggleLeftSidebar}
        onOpenThread={openThread}
        onConnectWeixin={openConnectWeixin}
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
          route: normalizedRoute,
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
            planActionsBusy:
              busy ||
              runtimeConnection !== 'ready' ||
              guiPlanSaveStatus === 'saving',
            graphEnabled,
            devPreviewVisible: showDevPreviewCard,
            devPreviewUrl: latestDevPreviewUrl,
            devPreviewOpened: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.browser,
            returnParentTitle: threads.find((thread: any) => thread.id === activeThreadParentId)?.title?.trim() ?? '',
            showReturnBar: shouldShowSideSessionReturnBar({
              thread: activeConversationThread,
              relation: activeThreadRelation,
              parentThreadId: activeThreadParentId
            }),
            returnBarVariant: (
              activeConversationThread?.agentId === 'explore'
                ? 'explore'
                : 'subagent'
            ) as 'explore' | 'subagent',
            graphChildContext,
            composerProps: chatComposerProps,
            conversationDropWorkspaceRoot: activeSkillWorkspace,
            terminalOpen,
            terminalWorkspaceRoot: fileTreeWorkspaceRoot,
            terminalHeight,
            rightWorkspaceExpanded: codeRightTabs.expanded,
            onToggleLeftSidebar: toggleLeftSidebar,
            onRetryConnection: () => void probeRuntime('user', { restart: true }),
            onOpenSettings: () => openSettings('agents'),
            onSelectSuggestion: (text) => setInput(text),
            onBuildPlan: (orchestration, meta) => void buildGuiPlan(orchestration, meta),
            onOpenPlan: (meta) => openGuiPlanPanel(meta),
            onOpenChanges: () => setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.changes),
            onReviewChanges: () => void reviewActiveThread({ kind: 'uncommittedChanges' }),
            reviewChangesDisabled: busy || runtimeConnection !== 'ready',
            onPreviewGeneratedDocument: openGeneratedDocumentPreview,
            onOpenGeneratedDocuments: openGeneratedDocuments,
            onOpenDevPreview: openDevPreview,
            onBackToParent: returnFromSubagent,
            onBeginTerminalResize: beginTerminalResize,
            onToggleTerminal: toggleTerminal,
            onToggleRightWorkspace: toggleCodeRightWorkspace,
            onOpenRequirementDraft: linkedSddDraft ? openLinkedSddDraft : undefined,
            extensionTopBarActions,
            extensionComposerActions,
            extensionMessageActions,
            extensionContextMenus: extensionMessageContextMenus,
            extensionAttachmentContextMenus,
            extensionCommands,
            extensionResultPreviews,
            messageContributionsForSurface,
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
            graphEnabled,
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
      <AgentBrowserFloatingPreview activeThreadId={activeThreadId} />
      {focusedCanvasWorkspace}
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
          (contribution: any) => contribution.payload.location === workspaceContextMenu?.location)}
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
