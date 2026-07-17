import { Suspense, type ComponentProps, type PointerEventHandler, type ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import { DesignSidebar } from '../design/DesignSidebar'
import { Sidebar } from '../chat/Sidebar'
import { WriteSidebar } from '../write/WriteSidebar'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'
import { CollaborationSidebar } from '../../collaboration/CollaborationSidebar'

type CodeSidebarProps = ComponentProps<typeof Sidebar>

export type WorkbenchLeftSidebarProps = {
  collapsed: boolean
  width: number
  route: string
  codeThreads: CodeSidebarProps['threads']
  activeThreadId: CodeSidebarProps['activeThreadId']
  sidebarView: CodeSidebarProps['activeView']
  connectPhoneSidebarOpen: boolean
  extensionsActive: boolean
  capabilitiesActive: boolean
  extensionView?: RegisteredContribution<'views.leftSidebar'>
  workspaceRoot?: string
  onCloseExtensionView?: () => void
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  focusModeEnabled: boolean
  onFocusModeChange: CodeSidebarProps['onFocusModeChange']
  onThreadSearchChange: CodeSidebarProps['onThreadSearchChange']
  onSelectThread: CodeSidebarProps['onSelectThread']
  onRenameThread: CodeSidebarProps['onRenameThread']
  onPinThread: CodeSidebarProps['onPinThread']
  onArchiveThread: CodeSidebarProps['onArchiveThread']
  onDeleteThread: CodeSidebarProps['onDeleteThread']
  onRestoreThread: CodeSidebarProps['onRestoreThread']
  onNewChat: CodeSidebarProps['onNewChat']
  onNewChatInWorkspace: CodeSidebarProps['onNewChatInWorkspace']
  onNewRequirement: CodeSidebarProps['onNewRequirement']
  onOpenRequirementDraft: CodeSidebarProps['onOpenRequirementDraft']
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: CodeSidebarProps['onOpenPlugins']
  onOpenExtensions: CodeSidebarProps['onOpenExtensions']
  onOpenCapabilities: CodeSidebarProps['onOpenCapabilities']
  onToggleTheme: CodeSidebarProps['onToggleTheme']
  onToggleConnectPhone: CodeSidebarProps['onToggleConnectPhone']
  onCodeOpen: CodeSidebarProps['onCodeOpen']
  onWriteOpen: CodeSidebarProps['onWriteOpen']
  onDesignOpen: CodeSidebarProps['onDesignOpen']
  onCollaborationOpen: CodeSidebarProps['onCollaborationOpen']
  onScheduleOpen: CodeSidebarProps['onScheduleOpen']
  onWorkflowOpen: CodeSidebarProps['onWorkflowOpen']
  onNewConversation: CodeSidebarProps['onNewConversation']
  onBeginResize: PointerEventHandler<HTMLDivElement>
}

function SidebarFallback(): ReactElement {
  return <div className="h-full bg-ds-sidebar" />
}

export function WorkbenchLeftSidebar({
  collapsed,
  width,
  route,
  codeThreads,
  activeThreadId,
  sidebarView,
  connectPhoneSidebarOpen,
  extensionsActive,
  capabilitiesActive,
  extensionView,
  workspaceRoot,
  onCloseExtensionView,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  focusModeEnabled,
  onFocusModeChange,
  onThreadSearchChange,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onNewRequirement,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onOpenExtensions,
  onOpenCapabilities,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onDesignOpen,
  onCollaborationOpen,
  onScheduleOpen,
  onWorkflowOpen,
  onNewConversation,
  onBeginResize
}: WorkbenchLeftSidebarProps): ReactElement | null {
  if (collapsed) return null
  return (
    <>
      <div className="min-h-0 shrink-0" style={{ width }}>
        {extensionView ? (
          <ExtensionViewOutlet
            contribution={extensionView}
            workspaceRoot={workspaceRoot}
            onClose={onCloseExtensionView}
          />
        ) : route === 'collaboration' ? (
          <CollaborationSidebar
            onCodeOpen={onCodeOpen}
            onWriteOpen={onWriteOpen}
            onDesignOpen={onDesignOpen}
            onCollaborationOpen={onCollaborationOpen}
          />
        ) : route === 'design' ? (
          <DesignSidebar
            onCodeOpen={onCodeOpen}
            onWriteOpen={onWriteOpen}
            onDesignOpen={onDesignOpen}
            onCollaborationOpen={onCollaborationOpen}
            onOpenSettings={onOpenSettings}
            onToggleTheme={onToggleTheme}
          />
        ) : route === 'write' ? (
          <Suspense fallback={<SidebarFallback />}>
            <WriteSidebar
              activeView="write"
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
              onCodeOpen={onCodeOpen}
              onWriteOpen={onWriteOpen}
              onDesignOpen={onDesignOpen}
              onCollaborationOpen={onCollaborationOpen}
              onOpenSettings={onOpenSettings}
              onToggleConnectPhone={onToggleConnectPhone}
            />
          </Suspense>
        ) : (
          <Sidebar
            threads={codeThreads}
            activeThreadId={activeThreadId}
            activeView={sidebarView}
            connectPhoneSidebarOpen={connectPhoneSidebarOpen}
            pluginsActive={route === 'plugins'}
            extensionsActive={extensionsActive}
            capabilitiesActive={capabilitiesActive}
            runtimeReady={runtimeReady}
            threadSearch={threadSearch}
            showArchivedThreads={showArchivedThreads}
            onThreadSearchChange={onThreadSearchChange}
            onSelectThread={onSelectThread}
            onRenameThread={onRenameThread}
            onPinThread={onPinThread}
            onArchiveThread={onArchiveThread}
            onDeleteThread={onDeleteThread}
            onRestoreThread={onRestoreThread}
            onNewChat={onNewChat}
            onNewChatInWorkspace={onNewChatInWorkspace}
            onNewRequirement={onNewRequirement}
            onOpenRequirementDraft={onOpenRequirementDraft}
            onOpenSettings={onOpenSettings}
            onOpenPlugins={onOpenPlugins}
            onOpenExtensions={onOpenExtensions}
            onOpenCapabilities={onOpenCapabilities}
            onToggleTheme={onToggleTheme}
            focusModeEnabled={focusModeEnabled}
            onFocusModeChange={onFocusModeChange}
            onToggleConnectPhone={onToggleConnectPhone}
            onCodeOpen={onCodeOpen}
            onWriteOpen={onWriteOpen}
            onDesignOpen={onDesignOpen}
            onCollaborationOpen={onCollaborationOpen}
            onScheduleOpen={onScheduleOpen}
            onWorkflowOpen={onWorkflowOpen}
            onNewConversation={onNewConversation}
          />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
        onPointerDown={onBeginResize}
      />
    </>
  )
}
