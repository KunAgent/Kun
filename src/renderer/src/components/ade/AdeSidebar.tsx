import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Plus, Settings, Smartphone, Sun } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSectionHeader
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { ThreadRow } from '../chat/SidebarProjectRows'
import {
  ThreadRenameDialog,
  type RenameThreadDialogState
} from '../chat/SidebarProjectOverlays'
import {
  sidebarThreadActivity,
  type SidebarThreadActivityContext
} from '../chat/sidebar-project-selectors'

const noOp = (): void => undefined

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  connectPhoneSidebarOpen: boolean
  runtimeReady: boolean
  showArchivedThreads: boolean
  focusModeEnabled: boolean
  onFocusModeChange: (enabled: boolean) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onPinThread: (id: string, pinned: boolean) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleTheme: () => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onAdeOpen: () => void
}

type AdeThreadGroupKey = 'attention' | 'running' | 'idle'

function adeThreadGroup(
  thread: NormalizedThread,
  context: SidebarThreadActivityContext
): AdeThreadGroupKey {
  const activity = sidebarThreadActivity(thread, context)
  if (activity === 'awaiting-input' || activity === 'failed' || activity === 'unread') {
    return 'attention'
  }
  if (activity === 'running' || activity === 'scheduled') return 'running'
  return 'idle'
}

export function AdeSidebar({
  threads,
  activeThreadId,
  connectPhoneSidebarOpen,
  runtimeReady,
  showArchivedThreads,
  focusModeEnabled,
  onFocusModeChange,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onOpenSettings,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onAdeOpen
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [isDarkMode, setIsDarkMode] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  )
  const [renameState, setRenameState] = useState<RenameThreadDialogState | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const scheduledThreadActivities = useChatStore((s) => s.scheduledThreadActivities)
  const awaitingUserInputThreadIds = useChatStore((s) => s.awaitingUserInputThreadIds)

  const activityContext: SidebarThreadActivityContext = useMemo(
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

  // ADE 侧栏按状态分组:待你处理 / 进行中 / 会话 / 已归档(00 §4)。
  const groups = useMemo(() => {
    const attention: NormalizedThread[] = []
    const running: NormalizedThread[] = []
    const idle: NormalizedThread[] = []
    const archived: NormalizedThread[] = []
    for (const thread of threads) {
      if (thread.archived === true) {
        archived.push(thread)
        continue
      }
      const group = adeThreadGroup(thread, activityContext)
      if (group === 'attention') attention.push(thread)
      else if (group === 'running') running.push(thread)
      else idle.push(thread)
    }
    return { attention, running, idle, archived }
  }, [threads, activityContext])

  const renderRow = (thread: NormalizedThread): ReactElement => {
    const activity = sidebarThreadActivity(thread, activityContext)
    return (
      <ThreadRow
        key={thread.id}
        thread={thread}
        active={thread.id === activeThreadId}
        deleting={false}
        locale={i18n.language}
        showRunning={activity === 'running'}
        showFailed={activity === 'failed'}
        showUnread={activity === 'unread'}
        showAwaitingInput={activity === 'awaiting-input'}
        onSelect={() => onSelectThread(thread.id)}
        onContextMenu={noOp}
        onPreviewOpen={noOp}
        onPreviewClose={noOp}
        onPin={() => void onPinThread(thread.id, thread.pinned !== true)}
        onRename={() => setRenameState({ thread, value: thread.title, submitting: false })}
        onArchive={() => void onArchiveThread(thread.id)}
        onDelete={() => void onDeleteThread(thread.id)}
        onRestore={() => void onRestoreThread(thread.id)}
      />
    )
  }

  const submitRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!renameState || renameState.submitting) return
    const nextTitle = renameState.value.trim()
    if (!nextTitle) return
    setRenameState({ ...renameState, submitting: true })
    try {
      await onRenameThread(renameState.thread.id, nextTitle)
      setRenameState(null)
    } catch {
      setRenameState({ ...renameState, submitting: false })
    }
  }

  const visibleGroups: Array<{ key: string; label: string; items: NormalizedThread[] }> = [
    { key: 'attention', label: t('adeGroupAttention'), items: groups.attention },
    { key: 'running', label: t('adeGroupRunning'), items: groups.running },
    { key: 'idle', label: t('adeGroupConversations'), items: groups.idle },
    ...(showArchivedThreads
      ? [{ key: 'archived', label: t('adeGroupArchived'), items: groups.archived }]
      : [])
  ]

  return (
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
      {renameState ? (
        <ThreadRenameDialog
          state={renameState}
          onClose={() => setRenameState(null)}
          onValueChange={(value) => setRenameState((s) => (s ? { ...s, value } : s))}
          onSubmit={(event) => void submitRename(event)}
          t={t}
        />
      ) : null}
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-1">
        <WorkspaceModeTabs
          activeView="ade"
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
          onAdeOpen={onAdeOpen}
        />
        <SidebarCommandRow
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label={t('adeNewConversation')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          variant="accent"
        />
      </div>
      <div className="ds-no-drag mt-1 min-h-0 flex-1 overflow-y-auto pb-2" data-ade-thread-list>
        {threads.length === 0 ? (
          <p className="px-3 pt-4 text-[12.5px] leading-5 text-ds-faint">{t('adeEmpty')}</p>
        ) : (
          visibleGroups.map((group) =>
            group.items.length === 0 ? null : (
              <section key={group.key} data-ade-thread-group={group.key}>
                <SidebarSectionHeader label={group.label} />
                <div className="space-y-0.5 px-1">
                  {group.items.map(renderRow)}
                </div>
              </section>
            )
          )
        )}
      </div>
    </SidebarFrame>
  )
}
