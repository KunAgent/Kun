import { Suspense, type ComponentProps, type PointerEventHandler, type ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import type { ClawInstallTarget } from '../chat/SidebarClawDialogHelpers'
import { Sidebar } from '../chat/Sidebar'
import { WriteSidebar } from '../write/WriteSidebar'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'
import { normalizeWorkbenchRoute } from './workbench-route'
import { workbenchDividerClassName } from './workbench-divider'

type CodeSidebarProps = ComponentProps<typeof Sidebar>

export type WorkbenchLeftSidebarProps = {
  collapsed: boolean
  width: number
  route: string
  codeThreads: CodeSidebarProps['threads']
  activeThreadId: CodeSidebarProps['activeThreadId']
  sidebarView: CodeSidebarProps['activeView']
  connectPhoneSidebarOpen: boolean
  connectPhoneInitialTarget?: ClawInstallTarget
  extensionsActive: boolean
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
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: CodeSidebarProps['onOpenPlugins']
  onOpenExtensions: CodeSidebarProps['onOpenExtensions']
  onToggleTheme: CodeSidebarProps['onToggleTheme']
  onToggleConnectPhone: CodeSidebarProps['onToggleConnectPhone']
  onCodeOpen: CodeSidebarProps['onCodeOpen']
  onWriteOpen: CodeSidebarProps['onWriteOpen']
  onScheduleOpen: CodeSidebarProps['onScheduleOpen']
  onBoardOpen?: CodeSidebarProps['onBoardOpen']
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
  connectPhoneInitialTarget = 'feishu',
  extensionsActive,
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
  onOpenSettings,
  onOpenPlugins,
  onOpenExtensions,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onScheduleOpen,
  onBoardOpen,
  onWorkflowOpen,
  onNewConversation,
  onBeginResize
}: WorkbenchLeftSidebarProps): ReactElement | null {
  if (collapsed) return null
  const normalizedRoute = normalizeWorkbenchRoute(route)
  return (
    <>
      <div className="min-h-0 shrink-0" style={{ width }}>
        {extensionView ? (
          <ExtensionViewOutlet
            contribution={extensionView}
            workspaceRoot={workspaceRoot}
            onClose={onCloseExtensionView}
          />
        ) : normalizedRoute === 'write' ? (
          <Suspense fallback={<SidebarFallback />}>
            <WriteSidebar
              activeView="write"
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
              focusModeEnabled={focusModeEnabled}
              onCodeOpen={onCodeOpen}
              onWriteOpen={onWriteOpen}
              onFocusModeChange={onFocusModeChange}
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
            connectPhoneInitialTarget={connectPhoneInitialTarget}
            pluginsActive={route === 'plugins'}
            extensionsActive={extensionsActive}
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
            onOpenSettings={onOpenSettings}
            onOpenPlugins={onOpenPlugins}
            onOpenExtensions={onOpenExtensions}
            onToggleTheme={onToggleTheme}
            focusModeEnabled={focusModeEnabled}
            onFocusModeChange={onFocusModeChange}
            onToggleConnectPhone={onToggleConnectPhone}
            onCodeOpen={onCodeOpen}
            onWriteOpen={onWriteOpen}
            onScheduleOpen={onScheduleOpen}
            onBoardOpen={onBoardOpen}
            onWorkflowOpen={onWorkflowOpen}
            onNewConversation={onNewConversation}
          />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className={workbenchDividerClassName(normalizedRoute)}
        onPointerDown={onBeginResize}
      />
    </>
  )
}
