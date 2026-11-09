import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock3, Plus, SlidersHorizontal } from 'lucide-react'
import {
  DEFAULT_SCHEDULE_MODEL, DEFAULT_SCHEDULE_REASONING_EFFORT, normalizeScheduleSettings,
  type AppSettingsV1, type ScheduleRuntimeStatus, type ScheduleSettingsV1, type ScheduledTaskV1,
  type mergeScheduleSettings
} from '@shared/app-settings'
import type { ScheduleTasksBulkInput } from '@shared/schedule-task-bulk'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { expandHomePathForSettingsUse } from '../../lib/settings-home-paths'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { ScheduleDefaultsDialog } from './ScheduleDefaultsDialog'
import { ScheduleTaskDialog } from './ScheduleTaskDialog'
import { ScheduleTaskBrowser } from './ScheduleTaskBrowser'
import { createScheduleRefreshCoordinator } from './schedule-refresh-coordinator'
import { SessionDaemonsView } from './SessionDaemonsView'
import {
  EMPTY_SCHEDULE_TASKS, configuredScheduleImChannels, newScheduledTask, nowIso,
  preferredScheduleProviderId, resolveScheduleModelSelection, resolveScheduleReasoningSelection,
  scheduleModelProfileForSelection, scheduleModelProviderOptions, validateScheduledTaskDraft,
  type TaskDialogState
} from './schedule-task-support'

export {
  dateTimeLocalValueFromIso, filterScheduledTasks, isoFromDateTimeLocalValue, newScheduledTask,
  preferredScheduleImChannel, resolveScheduleModelSelection, scheduleImChannelOptionLabel,
  scheduleImProviderLabel, scheduleModelProviderOptions, scheduleTaskSummary,
  scheduledTaskClawLabel, scheduledTaskLastThreadId, scheduledTaskResultIsExpandable,
  validateScheduledTaskDraft
} from './schedule-task-support'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread?: (threadId: string) => void
  onConnectWeixin?: () => void
}

export function ScheduleTasksView({ leftSidebarCollapsed, onToggleLeftSidebar, onOpenThread, onConnectWeixin }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [status, setStatus] = useState<ScheduleRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const mutationPending = useRef(false)
  const [scheduleSection, setScheduleSection] = useState<'tasks' | 'daemons'>('tasks')
  const mainRef = useRef<HTMLElement | null>(null)
  const sectionScrollTop = useRef({ tasks: 0, daemons: 0 })
  const [dialog, setDialog] = useState<TaskDialogState | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const refreshCoordinator = useRef(createScheduleRefreshCoordinator()).current
  const switchScheduleSection = (next: 'tasks' | 'daemons'): void => {
    if (mainRef.current) sectionScrollTop.current[scheduleSection] = mainRef.current.scrollTop
    setScheduleSection(next)
  }
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = sectionScrollTop.current[scheduleSection]
  }, [scheduleSection])

  const load = useCallback(async (): Promise<void> => {
    const ticket = refreshCoordinator.beginRefresh()
    if (ticket === null) return
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        rendererRuntimeClient.getSettings({ forceRefresh: true }),
        typeof window.kunGui?.getScheduleStatus === 'function' ? window.kunGui.getScheduleStatus() : Promise.resolve(null)
      ])
      if (!refreshCoordinator.isCurrent(ticket)) return
      setSettings(nextSettings)
      setStatus(nextStatus)
      setError(null)
    } catch (cause) {
      if (refreshCoordinator.isCurrent(ticket)) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (refreshCoordinator.isCurrent(ticket)) setLoading(false)
    }
  }, [refreshCoordinator])
  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 5_000)
    return () => { window.clearInterval(id); refreshCoordinator.invalidate() }
  }, [load, refreshCoordinator])

  const schedule = settings ? normalizeScheduleSettings(settings.schedule) : null
  const tasks = schedule?.tasks ?? EMPTY_SCHEDULE_TASKS
  const clawChannels = settings?.claw.channels ?? []
  const modelProviders = useMemo(() => settings ? scheduleModelProviderOptions(settings) : [], [settings])
  const beginMutation = (): number => {
    if (mutationPending.current) throw new Error(t('saving'))
    mutationPending.current = true
    setPending(true)
    return refreshCoordinator.beginMutation()
  }
  const endMutation = (): void => {
    refreshCoordinator.endMutation()
    mutationPending.current = false
    setPending(false)
  }
  const persistSchedule = async (patch: Parameters<typeof mergeScheduleSettings>[1]): Promise<ScheduleSettingsV1> => {
    if (!settings) throw new Error('Settings are not loaded')
    const ticket = beginMutation()
    try {
      // Only send the changed section; defaults and daemons must not overwrite one another.
      const saved = await rendererRuntimeClient.setSettings({ schedule: patch })
      if (refreshCoordinator.isCurrent(ticket)) setSettings(saved)
      return normalizeScheduleSettings(saved.schedule)
    } finally { endMutation() }
  }
  const bulkTasks = async (input: ScheduleTasksBulkInput): Promise<void> => {
    if (typeof window.kunGui?.bulkScheduleTasks !== 'function') throw new Error(t('scheduleActionsUnavailable'))
    const ticket = beginMutation()
    try {
      const result = await window.kunGui.bulkScheduleTasks(input)
      if (!result.ok) throw new Error(result.message)
      if (refreshCoordinator.isCurrent(ticket)) setSettings((current) => current ? {
        ...current, schedule: { ...current.schedule, tasks: result.tasks,
          enabled: input.action === 'enable' ? true : current.schedule.enabled }
      } : current)
    } finally { endMutation() }
    await load()
  }
  const runTask = async (taskId: string): Promise<void> => {
    if (typeof window.kunGui?.runScheduleTask !== 'function') throw new Error(t('scheduleActionsUnavailable'))
    const result = await window.kunGui.runScheduleTask(taskId)
    if (!result.ok) throw new Error(result.message)
    await load()
  }

  const resolveDialogWorkspaceRoot = useCallback((workspaceRoot?: string): string => {
    const explicit = workspaceRoot?.trim() || ''
    return explicit || schedule?.defaultWorkspaceRoot.trim() || settings?.workspaceRoot.trim() || ''
  }, [schedule?.defaultWorkspaceRoot, settings?.workspaceRoot])
  const openCreateDialog = (): void => {
    const workspaceRoot = resolveDialogWorkspaceRoot()
    const selection = settings ? resolveScheduleModelSelection(modelProviders,
      preferredScheduleProviderId(settings, modelProviders, schedule?.providerId), schedule?.model || DEFAULT_SCHEDULE_MODEL
    ) : { providerId: '', model: DEFAULT_SCHEDULE_MODEL }
    const selectedProvider = modelProviders.find((provider) => provider.providerId === selection.providerId) ?? null
    const profile = scheduleModelProfileForSelection(selectedProvider, selection.model)
    setDialog({ mode: 'create', draft: newScheduledTask(workspaceRoot, {
      providerId: selection.providerId, model: selection.model,
      reasoningEffort: resolveScheduleReasoningSelection(DEFAULT_SCHEDULE_REASONING_EFFORT, profile)
    }) })
    setDialogError(null)
  }
  const openEditDialog = (task: ScheduledTaskV1): void => {
    const selection = resolveScheduleModelSelection(modelProviders, task.providerId, task.model)
    const provider = modelProviders.find((item) => item.providerId === selection.providerId) ?? null
    const profile = scheduleModelProfileForSelection(provider, selection.model)
    setDialog({ mode: 'edit', taskId: task.id, draft: {
      ...task, providerId: selection.providerId, model: selection.model,
      reasoningEffort: resolveScheduleReasoningSelection(task.reasoningEffort, profile),
      workspaceRoot: resolveDialogWorkspaceRoot(task.workspaceRoot), schedule: { ...task.schedule }
    } })
    setDialogError(null)
  }
  const pickDialogWorkspace = async (): Promise<void> => {
    if (!dialog) return
    try {
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') throw new Error(t('workspacePickerUnavailable'))
      const picked = await window.kunGui.pickWorkspaceDirectory(
        expandHomePathForSettingsUse(resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot)) || undefined
      )
      if (picked.canceled || !picked.path) return
      setDialog((current) => current ? { ...current, draft: { ...current.draft, workspaceRoot: picked.path! } } : current)
      setDialogError(null)
    } catch (cause) { setDialogError(formatWorkspacePickerError(cause)) }
  }
  const saveDialog = async (): Promise<void> => {
    if (!dialog || !schedule || !settings || mutationPending.current) return
    const validation = validateScheduledTaskDraft(dialog.draft, t)
    if (validation) { setDialogError(validation); return }
    const now = nowIso()
    const workspaceRoot = expandHomePathForSettingsUse(resolveDialogWorkspaceRoot(dialog.draft.workspaceRoot))
    const clawChannelId = dialog.draft.clawChannelId.trim()
    const selection = resolveScheduleModelSelection(modelProviders, dialog.draft.providerId, dialog.draft.model)
    const provider = modelProviders.find((item) => item.providerId === selection.providerId) ?? null
    const profile = scheduleModelProfileForSelection(provider, selection.model)
    const task = {
      ...dialog.draft, title: dialog.draft.title.trim(), prompt: dialog.draft.prompt, workspaceRoot,
      clawChannelId: configuredScheduleImChannels(clawChannels).some((channel) => channel.id === clawChannelId) ? clawChannelId : '',
      providerId: selection.providerId, model: selection.model,
      reasoningEffort: resolveScheduleReasoningSelection(dialog.draft.reasoningEffort, profile),
      mode: 'agent' as const, updatedAt: now, nextRunAt: ''
    }
    try {
      if (dialog.mode === 'create') await persistSchedule({ enabled: true, tasks: [...schedule.tasks, { ...task, createdAt: now }] })
      else await persistSchedule({ tasks: schedule.tasks.map((item) => item.id === dialog.taskId ? task : item) })
      setDialog(null)
      setDialogError(null)
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const toggleKeepAwake = async (value: boolean): Promise<void> => {
    setOperationError(null)
    try { await persistSchedule({ keepAwake: value }) }
    catch (cause) { setOperationError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
              <SidebarTitlebarToggleButton onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')} />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">{t('schedule')}</h1>
            </div>
          </div>
        </header>
      </div>
      <main ref={mainRef} className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 md:px-8">
        <div className={`mx-auto flex w-full flex-col gap-5 ${scheduleSection === 'tasks' ? 'max-w-[1440px]' : 'max-w-[880px]'}`}>
          <nav className="flex items-center gap-6 border-b border-ds-border-muted" aria-label={t('schedule')}>
            {(['tasks', 'daemons'] as const).map((section) => (
              <button key={section} type="button" onClick={() => switchScheduleSection(section)}
                aria-pressed={scheduleSection === section}
                className={`-mb-px border-b-2 pb-3 pt-1 text-[13px] font-semibold ${scheduleSection === section ? 'border-ds-ink text-ds-ink' : 'border-transparent text-ds-muted hover:text-ds-ink'}`}>
                {t(section === 'tasks' ? 'scheduleTabTasks' : 'scheduleTabDaemons')}
              </button>
            ))}
          </nav>
          {error || operationError ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-800 dark:text-red-100">{operationError || error}</div> : null}
          {scheduleSection === 'daemons' ? (
            schedule ? <SessionDaemonsView schedule={schedule} clawChannels={clawChannels}
              defaultWorkspaceRoot={settings?.claw.im.workspaceRoot.trim() || ''} onPatchSchedule={persistSchedule}
              onOpenThread={onOpenThread} onConnectWeixin={onConnectWeixin} />
              : <div className="py-20 text-center text-[14px] text-ds-muted">{t('loading')}</div>
          ) : <>
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div><h2 className="mb-2 flex items-center gap-3 text-[24px] font-semibold tracking-tight text-ds-ink">{t('schedule')}
                <span className="text-[13px] font-normal tracking-normal text-ds-muted">{t('scheduleTaskCount', { total: tasks.length })}</span></h2>
                <p className="text-[13px] text-ds-muted">{t('scheduleBrowseSubtitle')}</p></div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={pending || !schedule} onClick={() => setSettingsDialogOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink hover:bg-ds-hover disabled:opacity-50">
                  <SlidersHorizontal size={16} />{t('scheduleDefaultsTitle')}</button>
                <button type="button" disabled={pending || !schedule} onClick={openCreateDialog}
                  className="inline-flex items-center gap-2 rounded-lg bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg hover:opacity-90 disabled:opacity-50">
                  <Plus size={16} />{t('scheduleNewTask')}</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-subtle px-4 py-3 text-[12px] text-ds-muted">
              <span className="flex items-center gap-2"><Clock3 size={16} />{t('scheduleAwakeNotice')}</span>
              <label className="flex items-center gap-2">{t('scheduleKeepAwake')}
                <input type="checkbox" checked={Boolean(schedule?.keepAwake)} disabled={pending || !schedule}
                  onChange={(event) => void toggleKeepAwake(event.target.checked)} className="h-4 w-4 accent-accent" /></label>
            </div>
            {loading ? <div className="py-20 text-center text-[14px] text-ds-muted">{t('loading')}</div> : (
              <ScheduleTaskBrowser tasks={tasks} status={status} clawChannels={clawChannels} modelProviders={modelProviders}
                pending={pending} onBulk={bulkTasks} onRun={runTask} onEdit={openEditDialog} onOpenThread={onOpenThread} />
            )}
          </>}
        </div>
      </main>
      {dialog ? <ScheduleTaskDialog dialog={dialog} error={dialogError}
        onClose={() => { if (!mutationPending.current) setDialog(null) }}
        onDraftChange={(draft) => setDialog((current) => current ? { ...current, draft } : current)}
        onPickWorkspace={() => void pickDialogWorkspace()} onSubmit={() => void saveDialog()}
        onOpenSettings={() => setSettingsDialogOpen(true)} clawChannels={clawChannels}
        defaultClawWorkspaceRoot={settings?.claw.im.workspaceRoot.trim() || ''} modelProviders={modelProviders} tasks={tasks} t={t} /> : null}
      {settingsDialogOpen && schedule ? <ScheduleDefaultsDialog schedule={schedule} modelProviders={modelProviders}
        onClose={() => { if (!mutationPending.current) setSettingsDialogOpen(false) }} onSave={async (patch) => {
          await persistSchedule(patch)
          setSettingsDialogOpen(false)
        }} t={t} /> : null}
    </div>
  )
}
