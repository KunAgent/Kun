import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Play,
  Plus,
  Power,
  Timer,
  Trash2,
  X
} from 'lucide-react'
import {
  DEFAULT_SCHEDULE_MODEL,
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  SCHEDULE_REASONING_EFFORT_IDS,
  getKunRuntimeSettings,
  getModelProviderSettings,
  isComposerChatModelId,
  listNonTextModelIds,
  mergeScheduleSettings,
  modelProfileSupportsTextChat,
  modelProviderModelProfile,
  normalizeScheduleSettings,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ModelProviderModelProfileV1,
  type ScheduleKind,
  type ScheduleReasoningEffort,
  type ScheduleRuntimeStatus,
  type ScheduleSettingsV1,
  type ScheduledTaskV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { confirmDialog } from '../../lib/confirm-dialog'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import {
  compactHomePathForSettingsDisplay,
  expandHomePathForSettingsUse
} from '../../lib/settings-home-paths'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { ScheduleDefaultsDialog } from './ScheduleDefaultsDialog'
import { createScheduleRefreshCoordinator } from './schedule-refresh-coordinator'
import { SessionDaemonsView } from './SessionDaemonsView'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread?: (threadId: string) => void
  onConnectWeixin?: () => void
}

export {
  dateTimeLocalValueFromIso,
  filterScheduledTasks,
  isoFromDateTimeLocalValue,
  newScheduledTask,
  preferredScheduleImChannel,
  resolveScheduleModelSelection,
  scheduleImChannelOptionLabel,
  scheduleImProviderLabel,
  scheduleModelProviderOptions,
  scheduleTaskSummary,
  scheduledTaskClawLabel,
  scheduledTaskLastThreadId,
  scheduledTaskResultIsExpandable,
  validateScheduledTaskDraft
} from './schedule-task-support'
import { ScheduleTaskDialog } from './ScheduleTaskDialog'
import {
  EMPTY_SCHEDULE_TASKS,
  RESULT_PREVIEW_CHAR_THRESHOLD,
  RESULT_PREVIEW_LINE_THRESHOLD,
  SCHEDULE_FILTERS,
  configuredScheduleImChannels,
  filterScheduledTasks,
  formatDateTime,
  newScheduledTask,
  nowIso,
  preferredScheduleProviderId,
  resolveScheduleModelSelection,
  resolveScheduleReasoningSelection,
  scheduleModelProfileForSelection,
  scheduleModelProviderOptions,
  scheduleReasoningLabel,
  scheduleTaskSummary,
  scheduledTaskClawLabel,
  scheduledTaskLastThreadId,
  scheduledTaskResultIsExpandable,
  statusTone,
  validateScheduledTaskDraft,
  type ScheduleModelProviderOption,
  type TaskDialogState,
  type TaskFilter
} from './schedule-task-support'
export function ScheduleTasksView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenThread,
  onConnectWeixin
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [status, setStatus] = useState<ScheduleRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [scheduleSection, setScheduleSection] = useState<'tasks' | 'daemons'>('tasks')
  const mainRef = useRef<HTMLElement | null>(null)
  const sectionScrollTop = useRef<{ tasks: number; daemons: number }>({ tasks: 0, daemons: 0 })
  const switchScheduleSection = (next: 'tasks' | 'daemons'): void => {
    if (mainRef.current) {
      sectionScrollTop.current[scheduleSection] = mainRef.current.scrollTop
    }
    setScheduleSection(next)
  }
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = sectionScrollTop.current[scheduleSection]
  }, [scheduleSection])
  const [dialog, setDialog] = useState<TaskDialogState | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [expandedResultTaskIds, setExpandedResultTaskIds] = useState<Set<string>>(() => new Set())
  const refreshCoordinator = useRef(createScheduleRefreshCoordinator()).current

  const load = useCallback(async (): Promise<void> => {
    const ticket = refreshCoordinator.beginRefresh()
    if (ticket === null) return
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        rendererRuntimeClient.getSettings({ forceRefresh: true }),
        typeof window.kunGui?.getScheduleStatus === 'function'
          ? window.kunGui.getScheduleStatus()
          : Promise.resolve(null)
      ])
      if (!refreshCoordinator.isCurrent(ticket)) return
      setSettings(nextSettings)
      setStatus(nextStatus)
      setError(null)
    } catch (loadError) {
      if (!refreshCoordinator.isCurrent(ticket)) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (refreshCoordinator.isCurrent(ticket)) setLoading(false)
    }
  }, [refreshCoordinator])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 5_000)
    return () => {
      window.clearInterval(id)
      refreshCoordinator.invalidate()
    }
  }, [load, refreshCoordinator])

  const schedule = settings ? normalizeScheduleSettings(settings.schedule) : null
  const tasks = schedule?.tasks ?? EMPTY_SCHEDULE_TASKS
  const clawChannels = settings?.claw.channels ?? []
  const modelProviders = useMemo(
    () => settings ? scheduleModelProviderOptions(settings) : [],
    [settings]
  )
  const runningTaskIds = useMemo(() => new Set(status?.runningTaskIds ?? []), [status])
  const queuedTaskIds = useMemo(() => new Set(status?.queuedTaskIds ?? []), [status])
  const visibleTasks = useMemo(() => filterScheduledTasks(tasks, filter), [filter, tasks])

  const persistSchedule = async (
    patch: Parameters<typeof mergeScheduleSettings>[1]
  ): Promise<ScheduleSettingsV1> => {
    if (!settings) throw new Error('Settings are not loaded')
    const ticket = refreshCoordinator.beginMutation()
    const nextSchedule = mergeScheduleSettings(settings.schedule, patch)
    setSettings({ ...settings, schedule: nextSchedule })
    try {
      const saved = await rendererRuntimeClient.setSettings({ schedule: nextSchedule })
      const canonical = normalizeScheduleSettings(saved.schedule)
      if (!refreshCoordinator.isCurrent(ticket)) return canonical
      setSettings(saved)
      if (typeof window.kunGui?.getScheduleStatus === 'function') {
        const nextStatus = await window.kunGui.getScheduleStatus()
        if (refreshCoordinator.isCurrent(ticket)) setStatus(nextStatus)
      }
      return canonical
    } catch (saveError) {
      if (refreshCoordinator.isCurrent(ticket)) setSettings(settings)
      throw saveError
    } finally {
      refreshCoordinator.endMutation()
    }
  }

  const resolveDialogWorkspaceRoot = useCallback((workspaceRoot?: string): string => {
    const explicit = workspaceRoot?.trim() || ''
    if (explicit) return explicit
    return schedule?.defaultWorkspaceRoot.trim() || settings?.workspaceRoot.trim() || ''
  }, [schedule?.defaultWorkspaceRoot, settings?.workspaceRoot])

  const openCreateDialog = (): void => {
    const workspaceRoot = resolveDialogWorkspaceRoot()
    const selection = settings
      ? resolveScheduleModelSelection(
          modelProviders,
          preferredScheduleProviderId(settings, modelProviders, schedule?.providerId),
          schedule?.model || DEFAULT_SCHEDULE_MODEL
        )
      : { providerId: '', model: DEFAULT_SCHEDULE_MODEL }
    const selectedProvider = modelProviders.find((provider) => provider.providerId === selection.providerId) ?? null
    const selectedProfile = scheduleModelProfileForSelection(selectedProvider, selection.model)
    setDialog({ mode: 'create', draft: newScheduledTask(workspaceRoot, {
      providerId: selection.providerId,
      model: selection.model,
      reasoningEffort: resolveScheduleReasoningSelection(DEFAULT_SCHEDULE_REASONING_EFFORT, selectedProfile)
    }) })
    setDialogError(null)
  }

  const openEditDialog = (task: ScheduledTaskV1): void => {
    const selection = resolveScheduleModelSelection(modelProviders, task.providerId, task.model)
    const selectedProvider = modelProviders.find((provider) => provider.providerId === selection.providerId) ?? null
    const selectedProfile = scheduleModelProfileForSelection(selectedProvider, selection.model)
    setDialog({
      mode: 'edit',
      taskId: task.id,
      draft: {
        ...task,
        providerId: selection.providerId,
        model: selection.model,
        reasoningEffort: resolveScheduleReasoningSelection(task.reasoningEffort, selectedProfile),
        workspaceRoot: resolveDialogWorkspaceRoot(task.workspaceRoot),
        schedule: { ...task.schedule }
      }
    })
    setDialogError(null)
  }

  const pickDialogWorkspace = async (): Promise<void> => {
    if (!dialog) return
    try {
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error(t('workspacePickerUnavailable'))
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(
        expandHomePathForSettingsUse(resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot)) || undefined
      )
      if (picked.canceled || !picked.path) return
      onDraftChangeInDialog({ workspaceRoot: picked.path })
      setDialogError(null)
    } catch (error) {
      setDialogError(formatWorkspacePickerError(error))
    }
  }

  const onDraftChangeInDialog = (patch: Partial<ScheduledTaskV1>): void => {
    setDialog((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current)
  }

  const saveDialog = async (): Promise<void> => {
    if (!dialog || !schedule || !settings) return
    const validation = validateScheduledTaskDraft(dialog.draft, t)
    if (validation) {
      setDialogError(validation)
      return
    }
    const now = nowIso()
    const workspaceRoot = expandHomePathForSettingsUse(resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot))
    const draftClawChannelId = dialog.draft.clawChannelId.trim()
    const selection = resolveScheduleModelSelection(
      modelProviders,
      dialog.draft.providerId,
      dialog.draft.model
    )
    const selectedProvider =
      modelProviders.find((provider) => provider.providerId === selection.providerId) ?? null
    const selectedProfile = scheduleModelProfileForSelection(selectedProvider, selection.model)
    const configuredClawChannelId = configuredScheduleImChannels(clawChannels)
      .some((channel) => channel.id === draftClawChannelId)
      ? draftClawChannelId
      : ''
    const task = {
      ...dialog.draft,
      title: dialog.draft.title.trim(),
      prompt: dialog.draft.prompt,
      workspaceRoot,
      clawChannelId: configuredClawChannelId,
      providerId: selection.providerId,
      model: selection.model,
      reasoningEffort: resolveScheduleReasoningSelection(dialog.draft.reasoningEffort, selectedProfile),
      mode: 'agent' as const,
      updatedAt: now,
      nextRunAt: ''
    }
    if (dialog.mode === 'create') {
      await persistSchedule({
        enabled: true,
        tasks: [...schedule.tasks, { ...task, createdAt: now }]
      })
    } else {
      await persistSchedule({
        tasks: schedule.tasks.map((item) => item.id === dialog.taskId ? task : item)
      })
    }
    setDialog(null)
    setDialogError(null)
  }

  const updateTask = async (taskId: string, patch: Partial<ScheduledTaskV1>): Promise<void> => {
    if (!schedule) return
    const now = nowIso()
    await persistSchedule({
      tasks: schedule.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              ...patch,
              ...(patch.schedule ? { schedule: { ...task.schedule, ...patch.schedule } } : {}),
              nextRunAt: patch.enabled !== undefined || patch.schedule ? '' : task.nextRunAt,
              updatedAt: now
            }
          : task
      )
    })
  }

  const deleteTask = async (taskId: string): Promise<void> => {
    if (!schedule) return
    if (!(await confirmDialog(t('scheduleDeleteConfirm')))) return
    await persistSchedule({ tasks: schedule.tasks.filter((task) => task.id !== taskId) })
  }

  const runTask = async (taskId: string): Promise<void> => {
    if (typeof window.kunGui?.runScheduleTask !== 'function') return
    const result = await window.kunGui.runScheduleTask(taskId)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await load()
  }

  const toggleKeepAwake = async (value: boolean): Promise<void> => {
    await persistSchedule({ keepAwake: value })
  }

  const toggleResultPreview = (taskId: string): void => {
    setExpandedResultTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">
                {t('schedule')}
              </h1>
            </div>
          </div>
        </header>
      </div>

      <main ref={mainRef} className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-8">
          <nav className="flex items-center gap-1 border-b border-ds-border-muted" aria-label={t('schedule')}>
            <button
              type="button"
              onClick={() => switchScheduleSection('tasks')}
              className={`relative -mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition ${
                scheduleSection === 'tasks'
                  ? 'border-ds-ink text-ds-ink'
                  : 'border-transparent text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t('scheduleTabTasks')}
            </button>
            <button
              type="button"
              onClick={() => switchScheduleSection('daemons')}
              className={`relative -mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition ${
                scheduleSection === 'daemons'
                  ? 'border-ds-ink text-ds-ink'
                  : 'border-transparent text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t('scheduleTabDaemons')}
            </button>
          </nav>
          {scheduleSection === 'daemons' ? (
            schedule ? (
              <SessionDaemonsView
                schedule={schedule}
                clawChannels={clawChannels}
                defaultWorkspaceRoot={settings?.claw.im.workspaceRoot.trim() || ''}
                onPatchSchedule={persistSchedule}
                onOpenThread={onOpenThread}
                onConnectWeixin={onConnectWeixin}
              />
            ) : (
              <div className="py-20 text-center text-[14px] text-ds-faint">{t('loading')}</div>
            )
          ) : (
          <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] leading-6 text-ds-faint">
              {t('scheduleSubtitle')}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as TaskFilter)}
                className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
              >
                {SCHEDULE_FILTERS.map((item) => (
                  <option key={item} value={item}>{t(`scheduleFilter_${item}`)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSettingsDialogOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                title={t('scheduleDefaultsTitle')}
                aria-label={t('scheduleDefaultsTitle')}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                {t('scheduleNewTask')}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Clock3 className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
              <span className="min-w-0 text-[14px] text-ds-ink">
                {t('scheduleAwakeNotice')}
              </span>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ds-muted">
              {t('scheduleKeepAwake')}
              <input
                type="checkbox"
                checked={Boolean(schedule?.keepAwake)}
                onChange={(event) => void toggleKeepAwake(event.target.checked)}
                className="sr-only"
              />
              <span className={`relative h-5 w-9 rounded-full transition ${schedule?.keepAwake ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${schedule?.keepAwake ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </label>
          </div>

          {loading ? (
            <div className="py-20 text-center text-[14px] text-ds-faint">{t('loading')}</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="flex min-h-[340px] items-center justify-center text-[13px] text-ds-faint">
              {tasks.length === 0 ? t('scheduleEmpty') : t('scheduleFilterEmpty')}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleTasks.map((task) => {
                const busy =
                  runningTaskIds.has(task.id) || queuedTaskIds.has(task.id) ||
                  task.lastStatus === 'running' || task.lastStatus === 'queued'
                const displayedStatus = runningTaskIds.has(task.id)
                  ? 'running'
                  : queuedTaskIds.has(task.id) ? 'queued' : task.lastStatus
                const lastThreadId = scheduledTaskLastThreadId(task)
                const clawLabel = scheduledTaskClawLabel(task, clawChannels, t)
                const providerLabel = task.providerId
                  ? modelProviders.find((provider) => provider.providerId === task.providerId)?.label
                  : ''
                const modelLabel = providerLabel ? `${providerLabel} / ${task.model}` : task.model
                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-ds-border bg-ds-card px-4 py-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h2 className="truncate text-[15px] font-semibold text-ds-ink">
                            {task.title || t('scheduleUntitled')}
                          </h2>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(task.lastStatus)}`}>
                            {t(`scheduleStatus_${displayedStatus}`)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ds-faint">
                          <span>{scheduleTaskSummary(task, t)}</span>
                          <span>{t('scheduleNextRun')}: {formatDateTime(task.nextRunAt, t('scheduleNotScheduled'))}</span>
                          <span>{t('scheduleLastRun')}: {formatDateTime(task.lastRunAt, t('scheduleNeverRun'))}</span>
                          {clawLabel ? <span>{clawLabel}</span> : null}
                          <span>{modelLabel} · {scheduleReasoningLabel(task.reasoningEffort, t)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {lastThreadId ? (
                          <button
                            type="button"
                            onClick={() => onOpenThread?.(lastThreadId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            title={t('scheduleOpenLastThread')}
                            aria-label={t('scheduleOpenLastThread')}
                          >
                            <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void runTask(task.id)}
                          disabled={busy}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                          title={t('scheduleRunNow')}
                          aria-label={t('scheduleRunNow')}
                        >
                          <Play className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditDialog(task)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          title={t('scheduleEditTask')}
                          aria-label={t('scheduleEditTask')}
                        >
                          <PencilLine className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTask(task.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                          title={t('scheduleDeleteTask')}
                          aria-label={t('scheduleDeleteTask')}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <label className="ml-1 inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={task.enabled}
                            onChange={(event) => void updateTask(task.id, { enabled: event.target.checked })}
                            className="sr-only"
                          />
                          <span className={`relative h-5 w-9 rounded-full transition ${task.enabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${task.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                          </span>
                        </label>
                      </div>
                    </div>
                    {task.lastMessage ? (
                      <div className="mt-3 rounded-lg border border-ds-border-muted bg-ds-main/45 px-3 py-2.5">
                        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[12px] font-semibold text-ds-faint">
                            {task.lastStatus === 'error'
                              ? t('scheduleLastError')
                              : task.lastStatus === 'running'
                                ? t('scheduleCurrentStatus')
                                : t('scheduleLastResult')}
                          </span>
                          {scheduledTaskResultIsExpandable(task.lastMessage) ? (
                            <button
                              type="button"
                              onClick={() => toggleResultPreview(task.id)}
                              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                              aria-expanded={expandedResultTaskIds.has(task.id)}
                            >
                              {expandedResultTaskIds.has(task.id) ? (
                                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                              )}
                              {expandedResultTaskIds.has(task.id) ? t('scheduleCollapseResult') : t('scheduleExpandResult')}
                            </button>
                          ) : null}
                        </div>
                        <div
                          className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ds-muted ${
                            expandedResultTaskIds.has(task.id)
                              ? 'max-h-80 overflow-y-auto pr-1'
                              : 'line-clamp-5 overflow-hidden'
                          }`}
                        >
                          {task.lastMessage}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          </>
          )}
        </div>
      </main>

      {dialog ? (
        <ScheduleTaskDialog
          dialog={dialog}
          error={dialogError}
          onClose={() => setDialog(null)}
          onDraftChange={(draft) => setDialog((current) => current ? { ...current, draft } : current)}
          onPickWorkspace={() => void pickDialogWorkspace()}
          onSubmit={() => void saveDialog()}
          onOpenSettings={() => setSettingsDialogOpen(true)}
          clawChannels={clawChannels}
          defaultClawWorkspaceRoot={settings?.claw.im.workspaceRoot.trim() || ''}
          modelProviders={modelProviders}
          tasks={tasks}
          t={t}
        />
      ) : null}

      {settingsDialogOpen && schedule ? (
        <ScheduleDefaultsDialog
          schedule={schedule}
          modelProviders={modelProviders}
          onClose={() => setSettingsDialogOpen(false)}
          onSave={async (patch) => {
            await persistSchedule(patch)
            setSettingsDialogOpen(false)
          }}
          t={t}
        />
      ) : null}
    </div>
  )
}
