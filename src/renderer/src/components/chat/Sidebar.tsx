import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  FileQuestion,
  Focus,
  LayoutGrid,
  Moon,
  Plus,
  Settings,
  Smartphone,
  Sun,
  Workflow
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { SidebarMascot } from './AnimatedWorkLogo'
import { ConnectPhoneSidebarPanel } from './ConnectPhoneView'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { WorkspaceModeTabs } from './WorkspaceModeTabs'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton
} from '../sidebar/SidebarPrimitives'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  pluginsActive: boolean
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
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onNewRequirement: () => void
  onOpenRequirementDraft: (draft: SddDraft) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onToggleTheme: () => void
  focusModeEnabled: boolean
  onFocusModeChange: (enabled: boolean) => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onScheduleOpen: () => void
  onWorkflowOpen: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  pluginsActive,
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
  onNewRequirement,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onToggleTheme,
  focusModeEnabled,
  onFocusModeChange,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onScheduleOpen,
  onWorkflowOpen
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

  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)

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
          <div className="flex min-h-[42px] items-center justify-center gap-2.5 pb-1">
            {!focusModeEnabled ? (
              <span className="flex h-[46px] w-[56px] shrink-0 items-center justify-center">
                <SidebarMascot />
              </span>
            ) : null}
            <FocusModeToggle
              enabled={focusModeEnabled}
              onToggle={() => onFocusModeChange(!focusModeEnabled)}
              label={t('focusMode')}
              status={focusModeEnabled ? t('switchOn') : t('switchOff')}
              title={t('focusModeToggleTitle')}
              ariaLabel={t('focusModeToggleLabel')}
            />
          </div>
          <SidebarCommandRow
            icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
            label={t('claw')}
            onClick={onToggleConnectPhone}
            active={connectPhoneSidebarOpen}
            variant="footer"
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
      <div className="ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />

        {activeView !== 'claw' && activeView !== 'schedule' && activeView !== 'workflow' ? (
          <>
            <SidebarCommandRow
              icon={<Plus className="h-4 w-4" strokeWidth={2} />}
              label={t('newAgent')}
              onClick={runtimeReady ? onNewChat : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="accent"
            />
            <SidebarCommandRow
              icon={<FileQuestion className="h-4 w-4" strokeWidth={1.9} />}
              label={t('sddNewRequirement')}
              onClick={runtimeReady ? onNewRequirement : undefined}
              disabled={!runtimeReady}
              disabledHint={t('runtimeActionNeedsConnection')}
              variant="accent"
            />
          </>
        ) : null}
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('schedule')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
        <SidebarCommandRow
          icon={<Workflow className="h-4 w-4" strokeWidth={1.75} />}
          label={t('workflow')}
          onClick={onWorkflowOpen}
          active={activeView === 'workflow'}
        />
      </div>

      <div className="ds-no-drag mx-1 my-1" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
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
          searchQuery={threadSearch}
          showArchived={showArchivedThreads}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          busy={busy}
          watchTurnCompletion={watchTurnCompletion}
          unreadThreadIds={unreadThreadIds}
          locale={i18n.language}
          onPickWorkspace={() => void chooseWorkspace()}
          onRemoveWorkspace={deleteWorkspace}
          onCreateThreadInWorkspace={onNewChatInWorkspace}
          onOpenRequirementDraft={onOpenRequirementDraft}
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
      <SidebarProjectsSection
        threads={threads}
        activeView={activeView === 'write' ? 'write' : 'chat'}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onOpenRequirementDraft={onOpenRequirementDraft}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onPinThread={onPinThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        t={t}
      />
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

function FocusModeToggle({
  enabled,
  onToggle,
  label,
  status,
  title,
  ariaLabel
}: {
  enabled: boolean
  onToggle: () => void
  label: string
  status: string
  title: string
  ariaLabel: string
}): ReactElement {
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      title={`${title} · ${status}`}
      onClick={onToggle}
      className={`group inline-flex h-8 w-[112px] shrink-0 items-center justify-between overflow-hidden rounded-[10px] border px-2.5 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/25 ${
        enabled
          ? 'border-accent/35 bg-[var(--ds-sidebar-row-active)] text-[#1f1f1f] shadow-[0_1px_3px_rgba(20,47,95,0.07),inset_0_0_0_1px_var(--ds-sidebar-row-ring),inset_0_1px_0_rgba(255,255,255,0.72)] dark:text-white'
          : 'border-[var(--ds-sidebar-divider)] bg-[var(--ds-sidebar-field-bg)] text-[#5c6675] shadow-[inset_0_1px_0_rgba(255,255,255,0.46)] hover:bg-[var(--ds-sidebar-row-hover)] hover:text-[#1f2733] dark:text-white/62 dark:shadow-none dark:hover:text-white'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Focus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          enabled
            ? 'bg-accent/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]'
            : 'bg-slate-300/75 shadow-[inset_0_0_0_1px_rgba(100,116,139,0.16)] dark:bg-white/[0.14] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(20,47,95,0.24)] transition-transform ${
            enabled ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
