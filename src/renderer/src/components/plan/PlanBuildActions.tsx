import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { CalendarClock, ChevronDown, GitBranch, Hammer, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { systemTimeZone, type AppSettingsV1, type ScheduleReasoningEffort, type ScheduledTaskV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { preparePlanBuild } from '../../plan/prepare-plan-build'
import {
  activePlanScheduledTask,
  formatPlanScheduleNextRun,
  planScheduleCountdown,
  scheduledTaskTime
} from '../../plan/plan-scheduled-task'
import { PlanScheduledBuildDialog } from './PlanScheduledBuildDialog'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import { useGuiPlanStore } from '../../plan/plan-store'
import { usePlanWorktreePreferenceStore } from '../../plan/plan-worktree-preference-store'

type PlanBuildMode = 'direct' | 'scheduled' | 'graph'
type ScheduleDraft = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: 'agent'
  schedule: { kind: 'at'; atTime: string; timeZone: string }
}

type Props = {
  disabled: boolean
  graphEnabled: boolean
  variant: 'panel' | 'card'
  planId?: string
  onBuild: (orchestration: PlanBuildOrchestration) => void
  onScheduleStateChange?: (hasActiveSchedule: boolean) => void
}

export function PlanBuildActions({
  disabled,
  graphEnabled,
  variant,
  planId,
  onBuild,
  onScheduleStateChange
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const activePlanId = useGuiPlanStore((state) => state.activePlan?.id)
  const resolvedPlanId = planId || activePlanId || ''
  const preference = usePlanWorktreePreferenceStore((state) =>
    resolvedPlanId ? state.plans[resolvedPlanId] : undefined)
  const setUsePromptWorktree = usePlanWorktreePreferenceStore((state) => state.setUsePromptWorktree)
  const [selectedMode, setSelectedMode] = useState<PlanBuildMode>('direct')
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const [scheduledTask, setScheduledTask] = useState<ScheduledTaskV1 | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [scheduleError, setScheduleError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = 'plan-build-actions-menu'
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuListRef = useRef<HTMLDivElement | null>(null)
  const resolvedPlanIdRef = useRef(resolvedPlanId)
  resolvedPlanIdRef.current = resolvedPlanId

  const closeMenu = useCallback((restoreFocus = true): void => {
    setMenuOpen(false)
    if (restoreFocus && menuButtonRef.current) menuButtonRef.current.focus()
  }, [])

  useEffect(() => {
    if (!menuOpen || variant !== 'panel') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (menuListRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return
      closeMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [closeMenu, menuOpen, variant])

  useEffect(() => {
    if (!menuOpen) return
    const firstItem = menuListRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
    firstItem?.focus()
  }, [menuOpen])

  const refreshSchedule = useCallback(async (): Promise<void> => {
    if (!resolvedPlanId) {
      setScheduledTask(null)
      return
    }
    try {
      const next = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (resolvedPlanIdRef.current !== resolvedPlanId) return
      const task = activePlanScheduledTask(next.schedule.tasks, resolvedPlanId)
      setSettings(next)
      setScheduledTask(task)
      if (task && variant === 'card') setSelectedMode('scheduled')
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : String(error))
    }
  }, [resolvedPlanId, variant])

  useEffect(() => {
    void refreshSchedule()
  }, [refreshSchedule])

  useEffect(() => {
    const onFocus = (): void => { void refreshSchedule() }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshSchedule()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshSchedule])

  useEffect(() => {
    if (!scheduledTask) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [scheduledTask])

  const taskTime = scheduledTask ? scheduledTaskTime(scheduledTask) : ''
  const hasActiveSchedule = Boolean(taskTime && Date.parse(taskTime) > nowMs)

  useEffect(() => {
    onScheduleStateChange?.(hasActiveSchedule)
  }, [hasActiveSchedule, onScheduleStateChange])

  useEffect(() => {
    if (scheduledTask && !hasActiveSchedule) void refreshSchedule()
  }, [hasActiveSchedule, refreshSchedule, scheduledTask])

  useEffect(() => {
    if (!graphEnabled && selectedMode === 'graph') setSelectedMode('direct')
  }, [graphEnabled, selectedMode])

  const openSchedule = async (task: ScheduledTaskV1 | null): Promise<void> => {
    setScheduleError('')
    try {
      setSettings(await rendererRuntimeClient.getSettings({ forceRefresh: true }))
      setScheduledTask(task)
      setDialogOpen(true)
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : String(error))
    }
  }

  const submitSchedule = async (draft: ScheduleDraft): Promise<void> => {
    const planState = useGuiPlanStore.getState()
    const plan = planState.activePlan
    if (!plan || plan.id !== resolvedPlanId) return
    setSubmitting(true)
    setScheduleError('')
    try {
      if (scheduledTask) {
        const result = await window.kunGui.updateScheduleTask({
          taskId: scheduledTask.id,
          providerId: draft.providerId,
          model: draft.model,
          reasoningEffort: draft.reasoningEffort,
          schedule: draft.schedule
        })
        if (!result.ok) throw new Error(result.message)
        setScheduledTask(result.task)
      } else {
        const activeThreadId = useChatStore.getState().activeThreadId
        const selectedPreference = usePlanWorktreePreferenceStore.getState().plans[plan.id]
        const prepared = await preparePlanBuild({
          plan,
          content: planState.content,
          orchestration: 'direct',
          graphEnabled,
          usePromptWorktree: selectedPreference?.usePromptWorktree === true,
          branchPrefix: selectedPreference?.branchPrefix ?? 'codex/',
          activeThreadId,
          save: async (target, content) => {
            const result = await window.kunGui.writeWorkspaceFile({ workspaceRoot: target.workspaceRoot, path: target.relativePath, content })
            if (result.ok && useGuiPlanStore.getState().activePlan?.id === target.id) useGuiPlanStore.getState().markSaved(content)
            return result.ok
          },
          currentPlanId: () => useGuiPlanStore.getState().activePlan?.id,
          currentThreadId: () => useChatStore.getState().activeThreadId,
          getGitBranches: window.kunGui.getGitBranches
        })
        const result = await window.kunGui.createScheduleTask({
          ...draft,
          ...(activeThreadId ? { sourceThreadId: activeThreadId } : {}),
          sourcePlanId: prepared.planId,
          title: prepared.title,
          prompt: prepared.prompt,
          workspaceRoot: prepared.workspaceRoot,
          orchestration: 'direct'
        })
        if (!result.ok) throw new Error(result.message)
        setScheduledTask(result.task)
      }
      setDialogOpen(false)
      await refreshSchedule()
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const settingsPending = Boolean(resolvedPlanId && !preference?.initialized)
  const buildDisabled = disabled || settingsPending || submitting

  useEffect(() => {
    if (menuOpen && (buildDisabled || !resolvedPlanId)) closeMenu(false)
  }, [buildDisabled, closeMenu, menuOpen, resolvedPlanId])

  const graphSelected = selectedMode === 'graph'
  const worktreeControl = resolvedPlanId && preference?.initialized ? (
    variant === 'card' ? (
      <div data-plan-worktree-control className="flex min-w-[260px] flex-1 items-center gap-2.5">
        <button type="button" role="switch" aria-checked={preference.usePromptWorktree}
          aria-label={t('planWorktreeUsePrompt')}
          onClick={() => setUsePromptWorktree(resolvedPlanId, !preference.usePromptWorktree)}
          disabled={graphSelected}
          className={`relative h-5 w-9 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${preference.usePromptWorktree ? 'bg-accent' : 'bg-ds-faint'} disabled:cursor-not-allowed disabled:opacity-45`}>
          <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${preference.usePromptWorktree ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ds-ink">{t('planWorktreeUsePrompt')}</div>
          <div className={`mt-0.5 text-[11px] ${graphSelected ? 'text-amber-700 dark:text-amber-300' : 'text-ds-muted'}`}>
            {graphSelected ? t('planWorktreeGraphUnsupported') : preference.usePromptWorktree ? t('planWorktreePromptHint') : t('planWorktreeCurrentWorkspaceWarning')}
          </div>
        </div>
      </div>
    ) : (
      <label data-plan-worktree-control
        className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2 text-[12px] font-medium text-ds-ink"
        title={preference.usePromptWorktree ? t('planWorktreePromptHint') : t('planWorktreeCurrentWorkspaceWarning')}>
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
        <span className="sr-only">{t('planBuildEnvironment')}</span>
        <select data-plan-worktree-select
          value={preference.usePromptWorktree ? 'worktree' : 'workspace'}
          disabled={graphSelected}
          onChange={(event) => setUsePromptWorktree(resolvedPlanId, event.target.value === 'worktree')}
          className="max-w-[140px] min-w-0 shrink cursor-pointer truncate bg-transparent text-[12px] font-medium text-ds-ink outline-none disabled:cursor-not-allowed disabled:opacity-45">
          <option value="worktree">{t('planWorktreeOptionAgent')}</option>
          <option value="workspace">{t('planWorktreeOptionCurrent')}</option>
        </select>
      </label>
    )
  ) : null

  const dialog = dialogOpen && settings ? (
    <PlanScheduledBuildDialog settings={settings} orchestration="direct" initialTask={scheduledTask}
      submitting={submitting} error={scheduleError} onClose={() => setDialogOpen(false)} onSubmit={submitSchedule} />
  ) : null

  if (variant === 'panel') {
    const scheduleMenuItem = scheduledTask && taskTime && hasActiveSchedule ? scheduledTask : null
    const runMenuItem = (action: () => void): void => {
      closeMenu(false)
      action()
    }
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {dialog}
        <div data-plan-build-actions data-plan-build-actions-variant={variant}
          className="flex min-w-0 flex-wrap items-center gap-2">
          {worktreeControl}
          <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded-lg">
            <button type="button" data-plan-build-direct disabled={buildDisabled} onClick={() => onBuild('direct')}
              className="inline-flex h-9 items-center gap-1.5 bg-accent px-3 text-[12.5px] font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:opacity-50">
              <Hammer className="h-3.5 w-3.5" />
              <span className="truncate">{t('planBuildDirect')}</span>
            </button>
            <button type="button" ref={menuButtonRef} data-plan-build-menu-toggle disabled={buildDisabled}
              aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}
              aria-label={t('planBuildMoreWays')}
              onClick={() => { if (!menuOpen) setMenuOpen(true); else closeMenu() }}
              onKeyDown={(event) => { if (event.key === 'ArrowDown' && !menuOpen) { event.preventDefault(); setMenuOpen(true) } }}
              className="inline-flex h-9 w-8 items-center justify-center border-l border-white/25 bg-accent text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:opacity-50">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div ref={menuListRef} id={menuId} role="menu" aria-label={t('planBuildMoreWays')} data-plan-build-menu
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeMenu()
                return
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
              const items = Array.from(menuListRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])
              if (items.length === 0) return
              event.preventDefault()
              const enabled = items.filter((item) => !item.disabled)
              const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
              const nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? enabled.length - 1
                  : event.key === 'ArrowDown' ? (current + 1) % enabled.length
                    : (current - 1 + enabled.length) % enabled.length
              enabled[nextIndex]?.focus()
            }}
            className="absolute bottom-full right-0 z-50 mb-2 min-w-[200px] overflow-hidden rounded-[12px] border border-ds-border bg-ds-card p-1.5 shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
            <button type="button" role="menuitem" data-plan-build-menu-schedule disabled={buildDisabled}
              onClick={() => runMenuItem(() => void openSchedule(scheduleMenuItem))}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t(scheduleMenuItem ? 'planScheduleBuildModify' : 'planScheduleBuild')}</span>
            </button>
            {graphEnabled ? (
              <>
                <div className="my-1 h-px bg-ds-border-muted" />
                <button type="button" role="menuitem" data-plan-build-menu-graph disabled={buildDisabled}
                  onClick={() => runMenuItem(() => onBuild('graph'))}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50">
                  <Share2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{t('planBuildGraph')}</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const selectMode = (mode: PlanBuildMode): void => {
    setSelectedMode(mode)
    if (mode === 'scheduled' && !scheduledTask) void openSchedule(null)
  }
  const locale = i18n.resolvedLanguage ?? i18n.language
  const taskTimeZone = scheduledTask?.schedule.timeZone || systemTimeZone()
  const formattedTaskTime = taskTime
    ? formatPlanScheduleNextRun(taskTime, taskTimeZone, locale, nowMs)
    : ''
  const countdown = taskTime ? planScheduleCountdown(taskTime, nowMs) : { kind: 'due' as const }
  const countdownText = countdown.kind === 'remaining'
    ? [
        countdown.days > 0 ? t('planScheduleBuildCountdownDay', { count: countdown.days }) : '',
        countdown.hours > 0 ? t('planScheduleBuildCountdownHour', { count: countdown.hours }) : '',
        t('planScheduleBuildCountdownMinute', { count: countdown.minutes })
      ].filter(Boolean).join(' ')
    : t('planScheduleBuildDueSoon')

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {dialog}
      <div data-plan-build-actions data-plan-build-actions-variant={variant} className="flex w-full flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex min-w-0 items-center gap-2.5 text-[12.5px] font-medium text-ds-ink">
          <span className="shrink-0">{t('planBuildMode')}</span>
          <select data-plan-build-mode value={selectedMode} disabled={disabled}
            onChange={(event) => selectMode(event.target.value as PlanBuildMode)}
            className="h-10 min-w-[160px] rounded-xl border border-ds-border bg-ds-card px-3 text-[12.5px] text-ds-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20">
            <option value="direct">{t('planBuildDirect')}</option>
            <option value="scheduled">{t('planScheduleBuild')}</option>
            {graphEnabled ? <option value="graph">{t('planBuildGraph')}</option> : null}
          </select>
        </label>
        {worktreeControl}
        {selectedMode === 'scheduled' && scheduledTask && taskTime && hasActiveSchedule ? (
          <div data-plan-schedule-status className="ml-auto flex min-w-[330px] max-w-full items-center gap-3">
            <CalendarClock className="h-8 w-8 shrink-0 text-accent" strokeWidth={1.7} />
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium text-ds-muted">
                {t('planScheduleBuildScheduled')}
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-1 text-[14px] font-medium text-ds-ink">
                <span>{t('planScheduleBuildRemainingPrefix')}</span>
                <span className="font-semibold text-accent">{countdownText}</span>
                <span>{t('planScheduleBuildRemainingSuffix')}</span>
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-ds-muted">
                {t('planScheduleBuildNextRun', { time: formattedTaskTime })}
              </div>
            </div>
            <button type="button" data-plan-build-schedule disabled={buildDisabled}
              onClick={() => void openSchedule(scheduledTask)}
              className="inline-flex h-9 shrink-0 items-center rounded-full border border-accent bg-transparent px-3.5 text-[12.5px] font-medium text-accent transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-45">
              {t('planScheduleBuildModify')}
            </button>
          </div>
        ) : selectedMode === 'scheduled' ? (
          <button type="button" data-plan-build-schedule disabled={buildDisabled}
            onClick={() => void openSchedule(scheduledTask)}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-white transition hover:brightness-110 disabled:opacity-45">
            <CalendarClock className="h-3.5 w-3.5" />
            {t('planScheduleBuildSet')}
          </button>
        ) : (
          <button type="button" data-plan-build-start disabled={buildDisabled}
            onClick={() => onBuild(selectedMode === 'graph' ? 'graph' : 'direct')}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-45">
            {selectedMode === 'graph' ? <Share2 className="h-3.5 w-3.5" /> : <Hammer className="h-3.5 w-3.5" />}
            {t(selectedMode === 'graph' ? 'planBuildGraphStart' : 'planBuildStart')}
          </button>
        )}
      </div>
    </div>
  )
}
