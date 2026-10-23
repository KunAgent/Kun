import { useTranslation } from 'react-i18next'
import type { ThreadGoal } from '../../../agent/types'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import type { TrayKind } from './tray-kind'
import { GoalTraySegment, goalStatusLabel, goalTrayTone } from './goal-tray-parts'
import { GoalTraySheet } from './goal-tray-sheet'

/*
 * Goal segment, trailing (`align: 'end'`): ◎ 目标 18 分钟 (compact: ◎ 18 分),
 * and its sheet (GoalTraySheet). The live clock lives in the segment / sheet
 * components (GoalElapsedText), never in this hook.
 *
 * Visibility follows the old goal floater: `context.showGoalFloater`
 * (showGoalMenuOption && shouldShowGoalFloater: not compact, no slash query,
 * goal panel and composer menu closed) with an active thread goal. A pending
 * ask-user request no longer hides it: the interrupt card takes the
 * composer's place and the tray stays above it.
 *
 * Actions keep the old floater's behavior:
 * - 编辑 opens the goal panel and focuses the composer (the panel edits the
 *   goal from the draft). It is left out while an approval / ask-user card
 *   holds the input slot: the composer is hidden and inert then, the panel
 *   stays closed, and an open goal panel would hide this segment;
 * - 暂停 / 继续 toggles active <-> paused (any non-active status resumes);
 * - 清除 clears the goal.
 */
export function useGoalTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const goal = (context.activeThreadGoal ?? null) as ThreadGoal | null
  if (context.showGoalFloater !== true || !goal) return null
  const busy = context.busy === true
  const interrupted = context.composerInterrupt != null
  const label = t('composerTrayGoal.segmentAria', {
    status: goalStatusLabel(goal.status, t),
    objective: clipGoalObjective(goal.objective)
  })
  return {
    id: 'goal',
    align: 'end',
    tone: goalTrayTone(goal.status),
    ariaLabel: label,
    title: label,
    renderSegment: ({ compact }) => <GoalTraySegment goal={goal} busy={busy} compact={compact} />,
    renderSheet: ({ close }) => (
      <GoalTraySheet
        goal={goal}
        busy={busy}
        onCollapse={close}
        onEdit={interrupted ? undefined : () => {
          close()
          context.setGoalPanelOpen?.(true)
          context.draft?.focusComposer?.()
        }}
        onToggleStatus={() => {
          void context.setActiveThreadGoalStatus?.(goal.status === 'active' ? 'paused' : 'active')
        }}
        onClear={() => {
          close()
          void context.clearActiveThreadGoal?.()
        }}
      />
    )
  }
}

/** One-line objective for the segment's accessible name / tooltip. */
export function clipGoalObjective(objective: string, max = 160): string {
  const flat = objective.replace(/\s+/g, ' ').trim()
  const glyphs = Array.from(flat)
  return glyphs.length > max ? `${glyphs.slice(0, max - 1).join('')}…` : flat
}
