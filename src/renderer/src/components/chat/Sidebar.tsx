import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  Columns3,
  LayoutGrid,
  Puzzle,
  Workflow,
  Zap
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
import { SidebarAttentionPanel } from './SidebarAttentionPanel'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { registerSidebarDragAutoScroll } from './sidebar-drag-auto-scroll'
import { SidebarAgentChatsSection } from './SidebarAgentChatsSection'
import { SidebarMenuRow, SidebarNavRow, SidebarPrimaryActions } from './SidebarCodeNav'
import { SidebarProjectBoardsSection } from './SidebarProjectBoardsSection'
import { CodexReferenceDialog } from '../../history-reference/CodexReferenceDialog'
import { useCodexReferenceEnabled } from '../../history-reference/use-codex-reference-enabled'
import { useProjectBoardEnabled } from '../../project-board/use-project-board-enabled'
import { WorkspaceModeTabs } from './WorkspaceModeTabs'
import { SidebarFrame } from '../sidebar/SidebarPrimitives'
import { SidebarStandardFooter } from '../sidebar/SidebarStandardFooter'

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
  const iconProps = { className: 'h-4 w-4', strokeWidth: 1.75 }
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
  const codexReferenceEnabled = useCodexReferenceEnabled()
  const [codexDialogOpen, setCodexDialogOpen] = useState(false)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  // Same inputs the project rows classify with — the panel just re-prioritizes
  // them into a single cross-workspace "needs you" list.
  const sidebarActivityContext = useMemo(
    () => ({
      activeThreadId,
      busy,
      watchTurnCompletion,
      unreadThreadIds,
      scheduledThreadActivities,
      awaitingUserInputThreadIds
    }),
    [
      activeThreadId,
      busy,
      watchTurnCompletion,
      unreadThreadIds,
      scheduledThreadActivities,
      awaitingUserInputThreadIds
    ]
  )

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      footer={
        <SidebarStandardFooter
          focusModeEnabled={focusModeEnabled}
          connectPhoneSidebarOpen={connectPhoneSidebarOpen}
          onFocusModeChange={onFocusModeChange}
          onOpenSettings={() => onOpenSettings('general')}
          onOpenAgentSettings={() => onOpenSettings('agents')}
          onToggleConnectPhone={onToggleConnectPhone}
          onToggleTheme={onToggleTheme}
        />
      }
    >
      {codexDialogOpen && codexReferenceEnabled ? <CodexReferenceDialog workspaceRoot={workspaceRoot}
        onClose={() => setCodexDialogOpen(false)} onCreated={(id) => { setCodexDialogOpen(false); onSelectThread(id) }} /> : null}
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />

        {activeView !== 'claw' ? (
          <SidebarPrimaryActions
            runtimeReady={runtimeReady}
            newTaskLabel={t('newAgent')}
            newChatLabel={t('agentChatsStart')}
            disabledHint={t('runtimeActionNeedsConnection')}
            onNewTask={onNewChat}
          />
        ) : null}
        <nav className="sidebar-code-nav" aria-label={t('sidebarTools')}>
          {codexReferenceEnabled && activeView === 'chat' ? <SidebarNavRow
            icon={<Clock3 {...iconProps} />} label={t('codexHistoryCreate')} active={false}
            disabled={!runtimeReady} onClick={() => setCodexDialogOpen(true)}
          /> : null}
          <SidebarMenuRow
            icon={<Zap {...iconProps} />}
            label={t('sidebarAutomation')}
            items={[
              // Re-selecting the open automation view toggles back to Code.
              { id: 'schedule', label: t('schedule'), icon: <Clock3 {...iconProps} />, active: activeView === 'schedule', onSelect: activeView === 'schedule' ? onCodeOpen : onScheduleOpen },
              { id: 'workflow', label: t('workflow'), icon: <Workflow {...iconProps} />, active: activeView === 'workflow', onSelect: activeView === 'workflow' ? onCodeOpen : onWorkflowOpen }
            ]}
          />
          <SidebarMenuRow
            icon={<LayoutGrid {...iconProps} />}
            label={t('sidebarAddons')}
            items={[
              { id: 'plugins', label: t('plugins'), icon: <LayoutGrid {...iconProps} />, active: pluginsActive, onSelect: onOpenPlugins },
              { id: 'extensions', label: i18n.language.toLowerCase().startsWith('zh') ? '扩展' : 'Extensions', icon: <Puzzle {...iconProps} />, active: extensionsActive, onSelect: onOpenExtensions }
            ]}
          />
          {projectBoardEnabled ? (
            <SidebarNavRow
              icon={<Columns3 {...iconProps} />}
              label={t('projectBoardNav')}
              onClick={onBoardOpen}
              active={activeView === 'board'}
            />
          ) : null}
        </nav>
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
      ) : (
      <>
      <SidebarAgentChatsSection
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
      {!threadSearch.trim() && ['chat', 'write', 'schedule', 'workflow'].includes(activeView) ? (
        <SidebarAttentionPanel
          threads={threads}
          activityContext={sidebarActivityContext}
          onSelectThread={onSelectThread}
          t={t}
        />
      ) : null}
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
