import { useEffect, type ReactElement } from 'react'
import { Target, X } from 'lucide-react'
import type { ThreadGoal } from '../../agent/types'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { TrayIconButton, TrayStatusPill } from './composer-tray/tray-primitives'
import {
  GoalActionButton,
  GoalStatusToggleButton,
  goalStatusLabel,
  goalTrayTone
} from './composer-tray/goal-tray-parts'

/**
 * "设为目标" popover above the composer: shows the active goal (or the empty
 * state), lets the current draft become the goal, and pauses / resumes /
 * clears it. Outside-click and Esc close it through FloatingComposer's
 * goalPanelRef listener; every action closes it too, except "设为目标",
 * which the send path handles. An approval / ask-user card taking the input
 * slot closes it as well: the panel works on the composer draft, which is
 * hidden and inert then, and an open panel would hide the tray's goal segment.
 */
export function FloatingComposerGoalPanel({
  context
}: {
  context: FloatingComposerRenderContext
}): ReactElement | null {
  const {
    activeThreadGoal, canSetGoalPanelDraft, clearActiveThreadGoal, composerInterrupt, goalPanelOpen, goalPanelRef,
    pendingUserInputBlock, setActiveThreadGoalStatus, setGoalFromComposerInput, setGoalPanelOpen,
    showGoalMenuOption, slashQuery, t
  } = context
  const interrupted = composerInterrupt != null
  useEffect(() => {
    if (interrupted && goalPanelOpen) setGoalPanelOpen(false)
  }, [goalPanelOpen, interrupted, setGoalPanelOpen])
  if (!showGoalMenuOption || !goalPanelOpen || slashQuery != null || pendingUserInputBlock || interrupted) return null
  const goal = (activeThreadGoal ?? null) as ThreadGoal | null
  const canSetDraft = canSetGoalPanelDraft === true
  const hint = canSetDraft ? null : goal ? t('composerTrayGoal.panelHintReplace') : t('composerTrayGoal.panelHintEmpty')
  return (
    <div
      ref={goalPanelRef}
      role="group"
      aria-label={t('composerTrayGoal.label')}
      data-goal-panel
      className="ds-card-strong ds-no-drag absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[760px] -translate-x-1/2 overflow-hidden rounded-[16px] px-3 pb-3 pt-2 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_10px_28px_-8px_rgba(16,24,40,0.14)] dark:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.55)]"
    >
      <div className="flex min-h-[28px] items-center gap-2">
        <Target className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={2} aria-hidden="true" />
        <span className="shrink-0 text-[13px] font-semibold text-ds-ink">{t('composerTrayGoal.label')}</span>
        {goal ? (
          <TrayStatusPill tone={goalTrayTone(goal.status)}>{goalStatusLabel(goal.status, t)}</TrayStatusPill>
        ) : null}
        <span className="min-w-0 flex-1" />
        <TrayIconButton label={t('close')} className="-mr-1" onClick={() => setGoalPanelOpen(false)}>
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </TrayIconButton>
      </div>
      {goal ? (
        <p
          className="m-0 mt-1 line-clamp-3 text-[14px] font-semibold leading-[22px] text-ds-ink [overflow-wrap:anywhere]"
          title={goal.objective}
          data-goal-objective
        >
          {goal.objective}
        </p>
      ) : (
        <p className="m-0 mt-1 text-[14px] leading-[22px] text-ds-muted">{t('goalNoActiveTitle')}</p>
      )}
      {hint ? <p className="m-0 mt-0.5 text-[12px] leading-[18px] text-ds-faint">{hint}</p> : null}
      {canSetDraft || goal ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {canSetDraft ? (
            <GoalActionButton variant="solid" data-goal-action="set" onClick={setGoalFromComposerInput}>
              {t('goalSetCurrentInput')}
            </GoalActionButton>
          ) : null}
          {goal ? (
            <GoalStatusToggleButton
              status={goal.status}
              onToggle={() => {
                setGoalPanelOpen(false)
                void setActiveThreadGoalStatus(goal.status === 'active' ? 'paused' : 'active')
              }}
            />
          ) : null}
          {goal ? (
            <GoalActionButton
              danger
              data-goal-action="clear"
              onClick={() => {
                setGoalPanelOpen(false)
                void clearActiveThreadGoal()
              }}
            >
              {t('goalActionClear')}
            </GoalActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
