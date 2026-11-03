import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertCircle, ArrowUpRight, CalendarClock, ChevronDown, GitBranch, Hammer, Share2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { systemTimeZone } from '@shared/app-settings'
import { formatPlanScheduleNextRun, planScheduleCountdown } from '../../plan/plan-scheduled-task'
import { PlanScheduledBuildDialog } from './PlanScheduledBuildDialog'
import { PlanBuildAgentPicker, usePlanBuildRoute } from './PlanBuildAgentPicker'
import { PlanBuildHandoffRow } from './PlanBuildHandoffRow'
import { scheduleExecutorForRoute, usePlanBuildSchedule } from './use-plan-build-schedule'
import { usePlanBuildAgentStore } from '../../plan/plan-build-agent-store'
import { planBuildEffortLabelKey } from '../../plan/plan-build-effort'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import type { GuiPlanToolMeta } from '../../plan/plan-tool'
import { useGuiPlanStore } from '../../plan/plan-store'
import { usePlanWorktreePreferenceStore } from '../../plan/plan-worktree-preference-store'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'

type Props = {
  disabled: boolean
  graphEnabled: boolean
  variant: 'panel' | 'card'
  planId?: string
  /** Card variant: meta of the `create_plan` result this card belongs to,
   * used to recover the plan when the plan store lost track of it. */
  planMeta?: GuiPlanToolMeta
  onBuild: (orchestration: PlanBuildOrchestration) => void
  onScheduleStateChange?: (hasActiveSchedule: boolean) => void
}

const menuItemClass = 'flex w-full items-start gap-2 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'

/**
 * Execute tray of a plan: who runs it (Agent, model, level), where (Kun:
 * Agent Worktree or current workspace; external: its own task worktree), and
 * one split button whose menu holds Graph and scheduled builds. A failed
 * handoff, a schedule and a handed-off build all stay on the card.
 */
export function PlanBuildActions({
  disabled,
  graphEnabled,
  variant,
  planId,
  planMeta,
  onBuild,
  onScheduleStateChange
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const activePlanId = useGuiPlanStore((state) => state.activePlan?.id)
  const resolvedPlanId = planId || activePlanId || ''
  const preference = usePlanWorktreePreferenceStore((state) =>
    resolvedPlanId ? state.plans[resolvedPlanId] : undefined)
  const setUsePromptWorktree = usePlanWorktreePreferenceStore((state) => state.setUsePromptWorktree)
  const { route, external, agentName } = usePlanBuildRoute(resolvedPlanId)
  const schedule = usePlanBuildSchedule({ planId: resolvedPlanId, planMeta, graphEnabled, route, agentName })
  const { scheduledTask, taskTime, hasActiveSchedule, nowMs } = schedule
  const handoff = usePlanBuildAgentStore((state) => (variant === 'card' ? state.handoffs[resolvedPlanId] : undefined))
  const failure = usePlanBuildAgentStore((state) => state.failures[resolvedPlanId])
  const clearHandoff = usePlanBuildAgentStore((state) => state.clearHandoff)
  const setFailure = usePlanBuildAgentStore((state) => state.setFailure)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = `plan-build-actions-menu-${variant}`
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuListRef = useRef<HTMLDivElement | null>(null)

  const closeMenu = useCallback((restoreFocus = true): void => {
    setMenuOpen(false)
    if (restoreFocus && menuButtonRef.current) menuButtonRef.current.focus()
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (menuListRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return
      closeMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [closeMenu, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const firstItem = menuListRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')
    firstItem?.focus()
  }, [menuOpen])

  useEffect(() => {
    onScheduleStateChange?.(hasActiveSchedule)
  }, [hasActiveSchedule, onScheduleStateChange])

  const settingsPending = Boolean(resolvedPlanId && !preference?.initialized)
  const buildDisabled = disabled || settingsPending || schedule.submitting

  useEffect(() => {
    if (menuOpen && buildDisabled) closeMenu(false)
  }, [buildDisabled, closeMenu, menuOpen])

  if (handoff) {
    return <PlanBuildHandoffRow handoff={handoff} onRebuild={() => clearHandoff(resolvedPlanId)} />
  }

  const chipClass = 'inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-[10px] border border-ds-border bg-ds-card px-2.5 text-[12.5px] font-medium text-ds-ink'
  const agentControl = resolvedPlanId ? (
    <PlanBuildAgentPicker planId={resolvedPlanId} route={route} disabled={buildDisabled} compact={variant === 'panel'} />
  ) : null
  const environment = !resolvedPlanId || !preference?.initialized ? null : external ? (
    <span data-plan-build-task-worktree className="inline-flex min-w-0 items-center gap-1.5 px-0.5 text-[12.5px] text-ds-muted"
      title={t('planBuildHintExternal', { agent: agentName })}>
      <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{t('planBuildExternalMeta')}</span>
    </span>
  ) : (
    <label data-plan-worktree-control className={chipClass}
      title={preference.usePromptWorktree ? t('planWorktreePromptHint') : t('planWorktreeCurrentWorkspaceWarning')}>
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
      <span className="sr-only">{t('planBuildEnvironment')}</span>
      <select data-plan-worktree-select
        value={preference.usePromptWorktree ? 'worktree' : 'workspace'}
        onChange={(event) => setUsePromptWorktree(resolvedPlanId, event.target.value === 'worktree')}
        className="max-w-[140px] min-w-0 shrink cursor-pointer truncate bg-transparent text-[12.5px] font-medium text-ds-ink outline-none">
        <option value="worktree">{t('planWorktreeOptionAgent')}</option>
        <option value="workspace">{t('planWorktreeOptionCurrent')}</option>
      </select>
    </label>
  )
  const buildLabel = external ? t('planBuildHandOff', { agent: agentName }) : t('planBuildStart')
  const scheduleMenuItem = scheduledTask && taskTime && hasActiveSchedule ? scheduledTask : null
  const runMenuItem = (action: () => void): void => {
    closeMenu(false)
    action()
  }
  const effortLabel = route.reasoningEffort && route.reasoningEffort !== 'auto' ? t(planBuildEffortLabelKey(route.reasoningEffort)) : ''
  const executorLabel = [agentName, route.model, effortLabel].filter(Boolean).join(' · ')

  const dialog = schedule.dialogOpen && schedule.settings ? (
    <PlanScheduledBuildDialog settings={schedule.settings} orchestration="direct" initialTask={scheduledTask}
      submitting={schedule.submitting} error={schedule.scheduleError}
      executor={scheduleExecutorForRoute(route, executorLabel)}
      onClose={() => schedule.setDialogOpen(false)} onSubmit={schedule.submitSchedule} />
  ) : null

  const splitButton = (
    <div className="relative ml-auto inline-flex shrink-0">
      <div className="inline-flex overflow-hidden rounded-[10px]">
        <button type="button" data-plan-build-direct data-plan-build-start disabled={buildDisabled} onClick={() => onBuild('direct')}
          className={`inline-flex items-center gap-1.5 bg-accent px-3.5 font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 disabled:opacity-50 ${variant === 'card' ? 'h-[38px] text-[13px]' : 'h-9 text-[12.5px]'}`}>
          {external ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0" /> : <Hammer className="h-3.5 w-3.5 shrink-0" />}
          <span className="max-w-[180px] truncate">{buildLabel}</span>
        </button>
        <button type="button" ref={menuButtonRef} data-plan-build-menu-toggle disabled={buildDisabled}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}
          aria-label={t('planBuildMoreWays')}
          onClick={() => { if (!menuOpen) setMenuOpen(true); else closeMenu() }}
          onKeyDown={(event) => { if (event.key === 'ArrowDown' && !menuOpen) { event.preventDefault(); setMenuOpen(true) } }}
          className={`inline-flex w-8 items-center justify-center border-l border-white/30 bg-accent text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 disabled:opacity-50 ${variant === 'card' ? 'h-[38px]' : 'h-9'}`}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
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
            const enabled = items.filter((item) => !item.disabled)
            if (enabled.length === 0) return
            event.preventDefault()
            const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
            const nextIndex = event.key === 'Home' ? 0
              : event.key === 'End' ? enabled.length - 1
                : event.key === 'ArrowDown' ? (current + 1) % enabled.length
                  : (current - 1 + enabled.length) % enabled.length
            enabled[nextIndex]?.focus()
          }}
          className="absolute bottom-full right-0 z-50 mb-2 w-[248px] overflow-hidden rounded-[12px] border border-ds-border bg-ds-card p-1.5 shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]">
          {graphEnabled ? (
            <button type="button" role="menuitem" data-plan-build-menu-graph disabled={buildDisabled || external}
              onClick={() => runMenuItem(() => onBuild('graph'))} className={menuItemClass}>
              <Share2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-muted" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ds-ink">{t('planBuildGraph')}</span>
                <span className="block text-[11.5px] text-ds-muted">{external ? t('planBuildGraphKunOnly') : t('planBuildGraphHint')}</span>
              </span>
            </button>
          ) : null}
          <button type="button" role="menuitem" data-plan-build-menu-schedule disabled={buildDisabled || !resolvedPlanId}
            onClick={() => runMenuItem(() => void schedule.openSchedule(scheduleMenuItem))} className={menuItemClass}>
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-muted" />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ds-ink">{t(scheduleMenuItem ? 'planScheduleBuildModify' : 'planScheduleBuild')}</span>
              <span className="block text-[11.5px] text-ds-muted">{t('planScheduleBuildMenuHint', { agent: agentName })}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )

  const failureRow = failure ? (
    <div role="alert" data-plan-build-failure={failure.agentId}
      className="flex min-w-0 items-start gap-2.5 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ds-ink">{t('planBuildHandoffFailedTitle', { agent: agentName })}</div>
        <div className="mt-0.5 break-words text-[12px] leading-5 text-ds-muted">{failure.message}</div>
      </div>
      <button type="button" onClick={() => {
        if (failure.agentId !== 'kun') useHarnessStore.setState({ settingsHarnessId: failure.agentId })
        useChatStore.getState().openSettings('agentsHarnesses')
      }}
        className="inline-flex h-8 shrink-0 items-center rounded-[9px] border border-ds-border bg-ds-card px-2.5 text-[12.5px] text-ds-ink transition hover:bg-ds-hover">
        {t('planBuildHandoffOpenSettings')}
      </button>
      <button type="button" aria-label={t('close')} onClick={() => setFailure(resolvedPlanId, null)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null

  const locale = i18n.resolvedLanguage ?? i18n.language
  const formattedTaskTime = taskTime
    ? formatPlanScheduleNextRun(taskTime, scheduledTask?.schedule.timeZone || systemTimeZone(), locale, nowMs)
    : ''
  const countdown = taskTime ? planScheduleCountdown(taskTime, nowMs) : { kind: 'due' as const }
  const countdownText = countdown.kind === 'remaining'
    ? [
        countdown.days > 0 ? t('planScheduleBuildCountdownDay', { count: countdown.days }) : '',
        countdown.hours > 0 ? t('planScheduleBuildCountdownHour', { count: countdown.hours }) : '',
        t('planScheduleBuildCountdownMinute', { count: countdown.minutes })
      ].filter(Boolean).join(' ')
    : t('planScheduleBuildDueSoon')
  const scheduledExternal = Boolean(scheduledTask?.harness)
  const scheduleStatus = scheduledTask && taskTime && hasActiveSchedule ? (
    <div data-plan-schedule-status className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft/80 text-accent">
        <CalendarClock className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="text-[11px] font-medium text-ds-muted">
          {scheduledExternal ? t('planScheduleBuildScheduledHandoff', { agent: agentName }) : t('planScheduleBuildScheduled')}
        </div>
        <div className="flex flex-wrap items-baseline gap-1 text-[13.5px] font-medium text-ds-ink">
          <span>{t('planScheduleBuildRemainingPrefix')}</span>
          <span className="font-semibold text-accent">{countdownText}</span>
          <span>{t('planScheduleBuildRemainingSuffix')}</span>
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-ds-muted">
          {t('planScheduleBuildNextRun', { time: formattedTaskTime })}
          {scheduledExternal ? ` · ${t('planScheduleBuildHandoffDetail')}` : ''}
        </div>
      </div>
      <button type="button" data-plan-build-schedule-cancel disabled={buildDisabled} onClick={() => void schedule.cancelSchedule()}
        className="inline-flex h-8 shrink-0 items-center rounded-[10px] border border-ds-border bg-transparent px-3 text-[12.5px] text-ds-ink transition hover:bg-ds-hover disabled:opacity-45">
        {t('planScheduleBuildCancel')}
      </button>
      <button type="button" data-plan-build-schedule disabled={buildDisabled}
        onClick={() => void schedule.openSchedule(scheduledTask)}
        className="inline-flex h-8 shrink-0 items-center rounded-[10px] border border-accent bg-transparent px-3 text-[12.5px] font-medium text-accent transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-45">
        {t('planScheduleBuildModify')}
      </button>
    </div>
  ) : null

  return (
    <div data-plan-build-tray={variant === 'card' ? true : undefined}
      className={variant === 'card'
        ? 'flex w-full min-w-0 flex-col gap-2.5 rounded-[16px] bg-ds-card-muted/70 p-3 dark:bg-white/[0.04]'
        : 'flex min-w-0 flex-col gap-2'}>
      {dialog}
      {failureRow}
      <div data-plan-build-actions data-plan-build-actions-variant={variant} className="flex w-full min-w-0 flex-wrap items-center gap-2">
        {agentControl}
        {environment}
        {splitButton}
      </div>
      {scheduleStatus}
    </div>
  )
}
