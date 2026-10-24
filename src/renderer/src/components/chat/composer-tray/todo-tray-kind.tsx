import { useMemo } from 'react'
import { List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadTodoList } from '../../../agent/types'
import { useGraphStore } from '../../../graph/graph-store'
import { graphRunOwnsThreadProgress } from '../composer-graph-preview'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import type { TrayKind } from './tray-kind'
import { TrayProgressRing, TraySegmentContent } from './tray-primitives'
import { getTodoProgress, todoRingTone, todoSegmentTone } from './todo-progress'
import { TodoTraySheet } from './todo-tray-sheet'

/*
 * Todo / plan checklist segment: progress ring (completed / total), the
 * current step's text and `current/total`; compact keeps the ring and the
 * count. The sheet (TodoTraySheet) lists the checklist around the current step.
 *
 * Visibility is the composer's `showTodoProgress`: the Code chat route, a
 * non-compact composer, the active thread's checklist, and at least one item
 * not completed. Menus and interrupt cards only close the sheet (the tray
 * handles that); the segment stays.
 *
 * Graph demotion: a Graph run compiles the plan into its own node set and no
 * checklist-to-node mapping exists, so while a run owns the thread (and the
 * Graph surface can report progress, `showGraphProgress`) a legacy checklist
 * is only the plan outline: list icon + "计划大纲 · N 步", marked
 * `data-todo-plan-outline="true"` for the Graph plan-progress smoke.
 */
export function useTodoTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const todos = (context.activeThreadTodos ?? null) as ThreadTodoList | null
  const visible = context.showTodoProgress === true && todos != null && todos.items.length > 0
  const graphGate = visible && context.showGraphProgress === true && todos.revision === undefined
  const listThreadId = todos?.threadId ?? null
  const graphOwnsProgress = useGraphStore((state) => (
    graphGate && graphRunOwnsThreadProgress(state.runs, listThreadId, state.selectedRunId)
  ))
  const live = context.busy === true

  return useMemo<TrayKind | null>(() => {
    if (!visible || !todos) return null
    const progress = getTodoProgress(todos.items)
    const total = progress.total
    const renderSheet: TrayKind['renderSheet'] = ({ close, compact }) => (
      <TodoTraySheet todos={todos} outline={graphOwnsProgress} live={live} compact={compact} onClose={close} />
    )

    if (graphOwnsProgress) {
      const steps = t('composerTrayTodo.outlineSteps', { count: total })
      return {
        id: 'todo',
        align: 'start',
        tone: 'default',
        ariaLabel: t('todoPlanOutlineAria', { total }),
        renderSegment: ({ compact }) => (
          <TraySegmentContent
            icon={<List className="h-3.5 w-3.5" strokeWidth={2} />}
            label={t('composerTrayTodo.outlineLabel')}
            count={steps}
            compact={compact}
          />
        ),
        renderSheet,
        segmentAttributes: { 'data-todo-plan-outline': 'true' }
      }
    }

    const currentItem = todos.items[progress.current - 1]
    const step = currentItem?.content ?? ''
    const count = `${progress.current}/${total}`
    return {
      id: 'todo',
      align: 'start',
      tone: todoSegmentTone(currentItem),
      ariaLabel: t('composerTrayTodo.segmentAria', { step, current: progress.current, total }),
      title: step,
      renderSegment: ({ compact }) => (
        <TraySegmentContent
          icon={(
            <TrayProgressRing
              value={total > 0 ? progress.completed / total : 0}
              tone={todoRingTone(currentItem, progress.allComplete)}
            />
          )}
          label={<span className="block max-w-[220px] truncate" data-todo-step>{step}</span>}
          count={count}
          compact={compact}
        />
      ),
      renderSheet
    }
  }, [graphOwnsProgress, live, t, todos, visible])
}
