import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutGrid,
  Moon,
  Plus,
  Settings,
  Smartphone,
  Sun,
  UserRound,
  Users
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { useActivityStore } from '../../store/activity-store'
import { selectNeedsYouCount } from '../../store/activity-selectors'
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
import {
  ADE_STATUS_GROUP_ORDER,
  adeStatusGroup,
  groupByProject,
  indexAdeThreads,
  threadDisplayBuckets,
  type AdeStatusGroup
} from './ade-sidebar-groups'
import { AdeOneOnOneDialog } from './AdeOneOnOneDialog'

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
  /** One-to-one thread pinned to a harness; isolation defaults to a new worktree. */
  onNewOneOnOne: (input: {
    harnessId: string
    credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
    providerId?: string
    model?: string
    isolation?: 'local' | 'worktree'
    permissionMode?: string
  }) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleTheme: () => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onAdeOpen: () => void
}

const GROUP_LABEL_KEY: Record<AdeStatusGroup, string> = {
  attention: 'adeGroupAttention',
  review: 'adeGroupReview',
  running: 'adeGroupRunning',
  done: 'adeGroupDone',
  idle: 'adeGroupConversations'
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
  onNewOneOnOne,
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
  // P3-17: 一对一先选 agent;按项目分组开关;worker 线程默认折叠。
  const [oneOnOneOpen, setOneOnOneOpen] = useState(false)
  const [groupMode, setGroupMode] = useState<'status' | 'project'>('status')
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const busy = useChatStore((s) => s.busy)
  const clearActiveThreadSelection = useChatStore((s) => s.clearActiveThreadSelection)
  const activityRows = useActivityStore((s) => s.rows)
  const needsYouCount = useActivityStore((s) => selectNeedsYouCount(s.rows))
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

  // Worker threads nest under their manager row instead of listing flat.
  const { roots, childrenByParent } = useMemo(() => indexAdeThreads(threads), [threads])

  // ADE 侧栏分组:待你处理 / 待审查 / 进行中 / 已完成 / 会话 / 已归档,或按项目分组(00 §4)。
  const groups = useMemo(() => {
    const byStatus = new Map<AdeStatusGroup, NormalizedThread[]>(
      ADE_STATUS_GROUP_ORDER.map((key) => [key, []])
    )
    const archived: NormalizedThread[] = []
    for (const thread of roots) {
      if (thread.archived === true) {
        archived.push(thread)
        continue
      }
      const buckets = threadDisplayBuckets(activityRows, thread.id)
      byStatus.get(adeStatusGroup(thread, sidebarThreadActivity(thread, activityContext), buckets))!
        .push(thread)
    }
    return { byStatus, archived }
  }, [roots, activityRows, activityContext])

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

  const renderRoot = (thread: NormalizedThread): ReactElement => {
    const children = childrenByParent.get(thread.id) ?? []
    if (!children.length) return renderRow(thread)
    const expanded = expandedParents.has(thread.id)
    return (
      <div key={thread.id}>
        {renderRow(thread)}
        <button
          type="button"
          data-ade-worker-toggle={thread.id}
          className="flex w-full items-center gap-1 rounded-sm px-3 py-0.5 text-left text-[11px] text-ds-faint hover:bg-ds-hover hover:text-ds-text"
          onClick={() =>
            setExpandedParents((prev) => {
              const next = new Set(prev)
              if (next.has(thread.id)) next.delete(thread.id)
              else next.add(thread.id)
              return next
            })
          }
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={2} />
          )}
          <Users className="h-3 w-3" strokeWidth={1.75} />
          {t('adeWorkerCount', { count: children.length })}
        </button>
        {expanded ? (
          <div className="space-y-0.5 pl-3" data-ade-worker-list={thread.id}>
            {children.map(renderRow)}
          </div>
        ) : null}
      </div>
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

  const statusGroups: Array<{ key: string; label: string; items: NormalizedThread[] }> =
    ADE_STATUS_GROUP_ORDER.map((key) => ({
      key,
      label: t(GROUP_LABEL_KEY[key]),
      items: groups.byStatus.get(key) ?? []
    }))
  const projectGroups = useMemo(
    () => groupByProject(roots.filter((t) => t.archived !== true)),
    [roots]
  )
  const visibleGroups = [
    ...(groupMode === 'status' ? statusGroups : projectGroups),
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
          icon={<Bot className="h-4 w-4" strokeWidth={2} />}
          label={t('adeNewManager')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<UserRound className="h-4 w-4" strokeWidth={1.75} />}
          label={t('adeNewOneOnOne')}
          onClick={runtimeReady ? () => setOneOnOneOpen(true) : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          active={oneOnOneOpen}
        />
        {oneOnOneOpen ? (
          <AdeOneOnOneDialog
            onConfirm={(selection) => onNewOneOnOne(selection)}
            onOpenSettings={onOpenSettings}
            onClose={() => setOneOnOneOpen(false)}
          />
        ) : null}
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('missionControl')}
          onClick={clearActiveThreadSelection}
          active={activeThreadId === null}
          trailing={
            needsYouCount > 0 ? (
              <span
                data-mission-needs-you-count
                className="rounded-full bg-ds-warning-soft px-1.5 text-[10.5px] font-medium leading-4 text-ds-status-warning"
              >
                {needsYouCount}
              </span>
            ) : null
          }
        />
        <SidebarCommandRow
          icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
          label={t('adeAgents')}
          onClick={() => onOpenSettings('agentsHarnesses')}
        />
      </div>
      <div className="ds-no-drag mt-1 flex items-center justify-end px-2">
        <button
          type="button"
          data-ade-group-toggle
          title={t('adeGroupToggleHint')}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-ds-faint hover:bg-ds-hover hover:text-ds-text"
          onClick={() => setGroupMode((m) => (m === 'status' ? 'project' : 'status'))}
        >
          <Folder className="h-3 w-3" strokeWidth={1.75} />
          {groupMode === 'status' ? t('adeGroupByProject') : t('adeGroupByStatus')}
        </button>
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
                  {group.items.map(renderRoot)}
                </div>
              </section>
            )
          )
        )}
      </div>
    </SidebarFrame>
  )
}
