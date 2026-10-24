import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadGoal } from '../../../agent/types'
import { TraySheetHeader, TrayStatusPill } from './tray-primitives'
import { GoalElapsedText } from './goal-tray-elapsed'
import {
  GoalActionButton,
  GoalStatusToggleButton,
  formatGoalTokens,
  goalStatusLabel,
  goalTrayTone
} from './goal-tray-parts'

/**
 * Goal sheet: "目标 · 进行中" header with a collapse chevron, then one raised
 * card holding the objective, its actions (编辑 / 暂停·继续 / 清除) and the
 * goal's own counters (elapsed, tokens used, token budget when set).
 * Without `onEdit` (an interrupt card holds the input slot) 编辑 is left out.
 */
export function GoalTraySheet({
  goal,
  busy,
  onEdit,
  onToggleStatus,
  onClear,
  onCollapse
}: {
  goal: ThreadGoal
  busy: boolean
  onEdit?: () => void
  onToggleStatus: () => void
  onClear: () => void
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const budget = typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0 ? goal.tokenBudget : null
  const tokensUsed = Number.isFinite(goal.tokensUsed) ? Math.max(0, goal.tokensUsed) : 0
  const showTokens = tokensUsed > 0 || budget != null
  return (
    <div data-goal-sheet={goal.status}>
      <TraySheetHeader
        title={t('composerTrayGoal.label')}
        summary={(
          <TrayStatusPill tone={goalTrayTone(goal.status)}>
            {goalStatusLabel(goal.status, t)}
          </TrayStatusPill>
        )}
        onCollapse={onCollapse}
      />
      <div className="mx-1 mt-0.5 rounded-[12px] bg-ds-card px-3.5 py-3 [box-shadow:var(--ds-composer-chip-shadow)]">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <p
            className="m-0 min-w-[12rem] flex-1 text-[14px] font-semibold leading-[22px] text-ds-ink [overflow-wrap:anywhere]"
            data-goal-objective
          >
            {goal.objective}
          </p>
          <span className="-my-0.5 flex shrink-0 items-center gap-1">
            {onEdit ? (
              <GoalActionButton data-goal-action="edit" title={t('goalActionEdit')} onClick={onEdit}>
                {t('composerTrayGoal.edit')}
              </GoalActionButton>
            ) : null}
            <GoalStatusToggleButton status={goal.status} onToggle={onToggleStatus} />
            <GoalActionButton danger data-goal-action="clear" onClick={onClear}>
              {t('goalActionClear')}
            </GoalActionButton>
          </span>
        </div>
        <dl className="m-0 mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] leading-[17px] text-ds-muted" data-goal-meter>
          <GoalMeter label={t('composerTrayGoal.elapsed')}>
            <GoalElapsedText goal={goal} busy={busy} />
          </GoalMeter>
          {showTokens ? (
            <GoalMeter label={budget != null ? t('composerTrayGoal.tokensOfBudget') : t('composerTrayGoal.tokens')}>
              <span className="tabular-nums">
                {budget != null
                  ? `${formatGoalTokens(tokensUsed)} / ${formatGoalTokens(budget)}`
                  : formatGoalTokens(tokensUsed)}
              </span>
            </GoalMeter>
          ) : null}
        </dl>
      </div>
    </div>
  )
}

/** One counter: bold value over a muted caption (the caption is the term). */
function GoalMeter({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt>{label}</dt>
      <dd className="m-0 text-[14px] font-semibold leading-5 text-ds-ink">{children}</dd>
    </div>
  )
}
