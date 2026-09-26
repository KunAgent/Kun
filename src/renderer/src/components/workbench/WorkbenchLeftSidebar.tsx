import { Suspense, type ComponentProps, type PointerEventHandler, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsRouteSection } from '../../store/chat-store'
import type { ClawInstallTarget } from '../chat/SidebarClawDialogHelpers'
import { Sidebar } from '../chat/Sidebar'
import { WriteSidebar } from '../write/WriteSidebar'
import { PaperSidebar } from '../paper/PaperSidebar'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'
import { normalizeWorkbenchRoute } from './workbench-route'
import { workbenchDividerClassName } from './workbench-divider'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'

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
  /** Remote-mobile drawer: backdrop tap or navigation action closes the drawer. */
  onBackdropClose?: () => void
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
  onBeginResize,
  onBackdropClose
}: WorkbenchLeftSidebarProps): ReactElement | null {
  const { t } = useTranslation('common')
  const remoteMobile = useRemoteMobileLayout()
  const workSurface = useWriteWorkspaceStore((s) => s.workSurface)
  if (collapsed || route === 'rooms') return null
  const normalizedRoute = normalizeWorkbenchRoute(route)
  // On a phone the sidebar is an overlay drawer: navigation actions and the
  // backdrop both collapse it again (onBackdropClose toggles collapsed state).
  const close = (): void => { onBackdropClose?.() }
  const wrapClose = <A extends unknown[], R>(fn: (...args: A) => R) =>
    remoteMobile ? (...args: A): R => { const result = fn(...args); close(); return result } : fn
  const wrapCloseOpt = <A extends unknown[], R>(fn?: (...args: A) => R) =>
    remoteMobile && fn ? (...args: A): R => { const result = fn(...args); close(); return result } : fn
  const content = (
    <div
      data-workbench-left-sidebar
      className={remoteMobile ? 'h-full min-h-0 w-full' : 'min-h-0 shrink-0'}
      style={remoteMobile ? undefined : { width }}
    >
      {extensionView ? (
        <ExtensionViewOutlet
          contribution={extensionView}
          workspaceRoot={workspaceRoot}
          onClose={wrapCloseOpt(onCloseExtensionView)}
        />
      ) : normalizedRoute === 'write' ? (
        <Suspense fallback={<SidebarFallback />}>
          {workSurface === 'papers' ? (
            <PaperSidebar
              activeView="write"
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
              focusModeEnabled={focusModeEnabled}
              onCodeOpen={wrapClose(onCodeOpen)}
              onWriteOpen={wrapClose(onWriteOpen)}
              onFocusModeChange={onFocusModeChange}
              onOpenSettings={wrapClose(onOpenSettings)}
              onToggleConnectPhone={onToggleConnectPhone}
            />
          ) : (
            <WriteSidebar
              activeView="write"
              connectPhoneSidebarOpen={connectPhoneSidebarOpen}
              focusModeEnabled={focusModeEnabled}
              onCodeOpen={wrapClose(onCodeOpen)}
              onWriteOpen={wrapClose(onWriteOpen)}
              onFocusModeChange={onFocusModeChange}
              onOpenSettings={wrapClose(onOpenSettings)}
              onToggleConnectPhone={onToggleConnectPhone}
            />
          )}
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
          onSelectThread={wrapClose(onSelectThread)}
          onRenameThread={onRenameThread}
          onPinThread={onPinThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          onRestoreThread={onRestoreThread}
          onNewChat={wrapClose(onNewChat)}
          onNewChatInWorkspace={wrapClose(onNewChatInWorkspace)}
          onOpenSettings={wrapClose(onOpenSettings)}
          onOpenPlugins={wrapClose(onOpenPlugins)}
          onOpenExtensions={wrapClose(onOpenExtensions)}
          onToggleTheme={onToggleTheme}
          focusModeEnabled={focusModeEnabled}
          onFocusModeChange={onFocusModeChange}
          onToggleConnectPhone={onToggleConnectPhone}
          onCodeOpen={wrapClose(onCodeOpen)}
          onWriteOpen={wrapClose(onWriteOpen)}
          onScheduleOpen={wrapClose(onScheduleOpen)}
          onBoardOpen={wrapCloseOpt(onBoardOpen)}
          onWorkflowOpen={wrapClose(onWorkflowOpen)}
          onNewConversation={wrapClose(onNewConversation)}
        />
      )}
    </div>
  )
  if (remoteMobile) {
    return (
      <div className="ds-no-drag fixed inset-0 z-50" role="dialog" aria-modal="true">
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          onClick={close}
          aria-label={t('sidebarCollapse')}
        />
        <div className="ds-sidebar-surface absolute inset-y-0 left-0 flex w-[min(85vw,320px)] min-w-0 flex-col shadow-2xl">
          {content}
        </div>
      </div>
    )
  }
  return (
    <>
      {content}
      <div
        role="separator"
        aria-orientation="vertical"
        className={workbenchDividerClassName(normalizedRoute)}
        onPointerDown={onBeginResize}
      />
    </>
  )
}
