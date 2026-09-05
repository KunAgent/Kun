import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  Columns3,
  LayoutGrid,
  Moon,
  Plus,
  Puzzle,
  Settings,
  Smartphone,
  Sun,
  Workflow
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode, ClawInstallTarget } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { ConnectPhoneSidebarPanel } from './ConnectPhoneView'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { registerSidebarDragAutoScroll } from './sidebar-drag-auto-scroll'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import { SidebarProjectBoardsSection } from './SidebarProjectBoardsSection'
import { useProjectBoardEnabled } from '../../project-board/use-project-board-enabled'
import { WorkspaceModeTabs } from './WorkspaceModeTabs'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'write' | 'claw' | 'board' | 'schedule' | 'workflow' | 'subagents'
  connectPhoneSidebarOpen: boolean
  connectPhoneInitialTarget: ClawInstallTarget
  pluginsActive: boolean
  extensionsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onPinThread: (id: string, pinned: boolean) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (
    workspaceRoot: string,
    options?: { forceNew?: boolean }
  ) => Promise<string | null>
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onOpenExtensions: () => void
  onToggleTheme: () => void
  focusModeEnabled: boolean
  onFocusModeChange: (enabled: boolean) => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onScheduleOpen: () => void
  onBoardOpen?: () => void
  onWorkflowOpen: () => void
  onNewConversation: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  connectPhoneInitialTarget,
  pluginsActive,
  extensionsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
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
  focusModeEnabled,
  onFocusModeChange,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onScheduleOpen,
  onBoardOpen,
  onWorkflowOpen,
  onNewConversation
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [isDarkMode, setIsDarkMode] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // HTML5 drag does not scroll containers; without this, dragged sidebar rows
  // cannot reach projects above or below the visible window.
  useEffect(() => registerSidebarDragAutoScroll(document), [])

  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const conversationWorkspaceRoot = useChatStore((s) => s.conversationWorkspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const threadListStatus = useChatStore((s) => s.threadListStatus)
  const threadListError = useChatStore((s) => s.threadListError)
  const threadListCursorByWorkspace = useChatStore((s) => s.threadListCursorByWorkspace)
  const refreshThreads = useChatStore((s) => s.refreshThreads)
  const loadMoreThreads = useChatStore((s) => s.loadMoreThreads)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const removeWorkspace = useChatStore((s) => s.removeWorkspace)
  const removedCodeWorkspaces = useChatStore((s) => s.removedCodeWorkspaces)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const scheduledThreadActivities = useChatStore((s) => s.scheduledThreadActivities)
  const awaitingUserInputThreadIds = useChatStore((s) => s.awaitingUserInputThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)
  const { enabled: projectBoardEnabled } = useProjectBoardEnabled()

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      footer={
        <div className="space-y-1">
          <SidebarFocusModeControl
            enabled={focusModeEnabled}
            onChange={onFocusModeChange}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarCommandRow
                icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
                label={t('settings')}
                onClick={() => onOpenSettings('general')}
                variant="footer"
              />
            </div>
            <SidebarIconButton
              title={t('claw')}
              ariaLabel={t('claw')}
              onClick={onToggleConnectPhone}
              active={connectPhoneSidebarOpen}
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
            <SidebarIconButton
              title={isDarkMode ? t('switchToLight') : t('switchToDark')}
              ariaLabel={t('toggleTheme')}
              onClick={onToggleTheme}
            >
              {isDarkMode ? (
                <Sun className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </SidebarIconButton>
          </div>
        </div>
      }
    >
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />

        {activeView !== 'claw' && activeView !== 'schedule' && activeView !== 'workflow' ? (
          <SidebarCommandRow
            icon={<Plus className="h-4 w-4" strokeWidth={2} />}
            label={t('newAgent')}
            onClick={runtimeReady ? onNewChat : undefined}
            disabled={!runtimeReady}
            disabledHint={t('runtimeActionNeedsConnection')}
            variant="accent"
          />
        ) : null}
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Puzzle className="h-4 w-4" strokeWidth={1.75} />}
          label={i18n.language.toLowerCase().startsWith('zh') ? '扩展' : 'Extensions'}
          onClick={onOpenExtensions}
          active={extensionsActive}
        />
        {projectBoardEnabled ? (
          <SidebarCommandRow
            icon={<Columns3 className="h-4 w-4" strokeWidth={1.75} />}
            label={t('projectBoardNav')}
            onClick={onBoardOpen}
            active={activeView === 'board'}
          />
        ) : null}
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('schedule')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
        <SidebarCommandRow
          icon={<Workflow className="h-4 w-4" strokeWidth={1.75} />}
          label={t('workflowCreate')}
          onClick={onWorkflowOpen}
          active={activeView === 'workflow'}
        />
      </div>

      <div className="ds-no-drag mx-1 my-1" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          initialTarget={connectPhoneInitialTarget}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : activeView === 'claw' ? (
        <ClawSidebarContent
          channels={clawChannels}
          activeChannelId={activeClawChannelId}
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          onSelectChannel={(channelId) => void selectClawChannel(channelId)}
          onAddChannel={() => setImDialogMode('add')}
          onResetChannel={(channelId) => void resetClawChannelSession(channelId)}
          onOpenSettings={() => setImDialogMode('edit')}
          t={t}
        />
      ) : projectBoardEnabled && activeView === 'board' ? (
        <SidebarProjectBoardsSection
          threads={threads}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          conversationRoot={conversationWorkspaceRoot}
          removedCodeWorkspaces={removedCodeWorkspaces}
          runtimeReady={runtimeReady}
          onAddProject={() => void chooseWorkspace({
            createThreadAfter: false,
            selectThreadAfter: false
          })}
          t={t}
        />
      ) : activeView === 'workflow' ? (
        <div className="ds-no-drag flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Workflow className="h-7 w-7 text-ds-faint" strokeWidth={1.5} />
          <p className="text-[12.5px] leading-5 text-ds-faint">{t('workflowSidebarHint')}</p>
        </div>
      ) : activeView === 'schedule' ? (
        <SidebarProjectsSection
          threads={threads}
          activeView="chat"
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          threadListStatus={threadListStatus}
          threadListError={threadListError}
          onRetryThreads={() => void refreshThreads()}
          onLoadMoreThreads={(workspacePath) => void loadMoreThreads(workspacePath)}
          threadListCursorByWorkspace={threadListCursorByWorkspace}
          searchQuery={threadSearch}
          showArchived={showArchivedThreads}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          conversationRoot={conversationWorkspaceRoot}
          busy={busy}
          watchTurnCompletion={watchTurnCompletion}
          unreadThreadIds={unreadThreadIds}
          scheduledThreadActivities={scheduledThreadActivities}
          awaitingUserInputThreadIds={awaitingUserInputThreadIds}
          locale={i18n.language}
          onPickWorkspace={() => void chooseWorkspace()}
          onRemoveWorkspace={removeWorkspace}
          onCreateThreadInWorkspace={onNewChatInWorkspace}
          onSelectThread={onSelectThread}
          onRenameThread={onRenameThread}
          onPinThread={onPinThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          onRestoreThread={onRestoreThread}
          onSearchQueryChange={onThreadSearchChange}
          t={t}
        />
      ) : (
      <>
      <SidebarProjectsSection
        threads={threads}
        activeView={activeView === 'write' ? 'write' : 'chat'}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        threadListStatus={threadListStatus}
        threadListError={threadListError}
        onRetryThreads={() => void refreshThreads()}
        onLoadMoreThreads={(workspacePath) => void loadMoreThreads(workspacePath)}
        threadListCursorByWorkspace={threadListCursorByWorkspace}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        conversationRoot={conversationWorkspaceRoot}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        scheduledThreadActivities={scheduledThreadActivities}
        awaitingUserInputThreadIds={awaitingUserInputThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={removeWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onPinThread={onPinThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        t={t}
      />
      <SidebarConversationsSection
        threads={threads}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        conversationRoot={conversationWorkspaceRoot}
        onNewConversation={onNewConversation}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onPinThread={onPinThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        t={t}
      />
      </>
      )}

    </SidebarFrame>

    {imDialogMode ? (
      <ClawAddImDialog
        mode={imDialogMode}
        initialProvider={activeClawChannel?.provider}
        initialChannelId={imDialogMode === 'edit' ? activeClawChannel?.id : undefined}
        channels={clawChannels}
        onClose={() => setImDialogMode(null)}
        onAddProvider={(provider, agentProfile, platformCredential, options) =>
          addClawChannel(provider, agentProfile, platformCredential, options)
        }
        onDeleteChannel={(channelId) => deleteClawChannel(channelId)}
        t={t}
      />
    ) : null}
    </>
  )
}
