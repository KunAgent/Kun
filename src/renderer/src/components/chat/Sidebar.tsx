import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  Command,
  LayoutGrid,
  Plus,
  Settings
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { WorkspaceModeTabs } from './WorkspaceModeTabs'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'write' | 'claw'
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onShowArchivedThreadsChange: (show: boolean) => void
  onSelectThread: (id: string) => void
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onClawOpen: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onShowArchivedThreadsChange,
  onSelectThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onOpenSettings,
  onOpenPlugins,
  onCodeOpen,
  onWriteOpen,
  onClawOpen
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
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

  const [appVersion, setAppVersion] = useState('')
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  useEffect(() => {
    let cancelled = false
    if (typeof window.dsGui?.getAppVersion !== 'function') return
    void window.dsGui.getAppVersion().then((version) => {
      if (!cancelled) setAppVersion(version)
    }).catch(() => {
      if (!cancelled) setAppVersion('')
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
    <aside className="ds-drag ds-sidebar-shell ds-frosted relative flex h-full w-full shrink-0 flex-col px-3 pb-3">
      <div className="shrink-0 px-1 pb-2 pt-3">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <div className="flex min-h-8 items-center justify-center px-1 pt-1">
          <div className="truncate text-center text-[17px] font-medium tracking-[-0.025em] text-ds-ink">
            {t('appName')}
          </div>
        </div>
        <div className="mx-1 mt-4 border-t border-ds-border-muted/20" />
      </div>

      <div className="ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
          onClawOpen={onClawOpen}
        />

        {activeView !== 'claw' ? (
        <SidebarLink
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label={t('newAgent')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          shortcut="⌘N"
          variant="flat-accent"
        />
        ) : null}
        <SidebarLink
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
      </div>

      <div className="ds-no-drag mx-1 my-3" />

      {activeView === 'claw' ? (
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
      ) : (
      <SidebarProjectsSection
        threads={threads}
        activeView={activeView}
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onSelectThread={onSelectThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        onShowArchivedChange={onShowArchivedThreadsChange}
        t={t}
      />
      )}

      <div className="ds-no-drag mt-2 border-t border-ds-border-muted/20 px-1 pt-3">
        <SidebarLink
          icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
          label={t('settings')}
          onClick={() => onOpenSettings('general')}
          variant="footer"
          trailing={appVersion ? <span className="text-[12px] text-ds-faint">v{appVersion}</span> : undefined}
        />
      </div>

    </aside>

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

type SidebarLinkProps = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  shortcut?: string
  variant?: 'flat' | 'flat-accent' | 'footer'
  trailing?: ReactElement
  active?: boolean
}

function SidebarLink({
  icon,
  label,
  onClick,
  disabled,
  disabledHint,
  shortcut,
  variant = 'flat',
  trailing,
  active = false
}: SidebarLinkProps): ReactElement {
  const isAccent = variant === 'flat-accent'
  const isFooter = variant === 'footer'
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-medium transition ${
        disabled
          ? 'cursor-not-allowed text-ds-faint opacity-55'
          : active
            ? 'bg-ds-hover/70 text-ds-ink shadow-sm ring-1 ring-ds-border-muted/50'
          : isFooter
            ? 'text-ds-muted hover:bg-ds-hover/45 hover:text-ds-ink'
            : isAccent
              ? 'border border-ds-border-muted/30 bg-white/[0.02] text-ds-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-white/[0.035] dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
              : 'text-ds-muted hover:bg-ds-hover/45 hover:text-ds-ink'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${
          isAccent
            ? 'text-accent'
            : isFooter
              ? 'text-ds-faint'
              : 'text-ds-muted'
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut ? (
        <kbd className="ds-kbd hidden items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-ds-faint sm:inline-flex">
          <Command className="h-2.5 w-2.5" strokeWidth={2} />
          {shortcut.replace('⌘', '')}
        </kbd>
      ) : null}
      {trailing ?? null}
      {isFooter ? <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} /> : null}
    </button>
  )
}
