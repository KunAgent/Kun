import type { ReactElement, ReactNode } from 'react'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { useDispatchTrayKind } from './dispatch-tray-kind'
import { useGoalTrayKind } from './goal-tray-kind'
import { useGraphTrayKind } from './graph-tray-kind'
import { useShellsTrayKind } from './shells-tray-kind'
import { useTodoTrayKind } from './todo-tray-kind'
import { useWorkersTrayKind } from './workers-tray-kind'

/**
 * Calls every tray kind hook and renders the tray. It is its own component
 * so a kind's state change (a poll result, store rows, a sheet clock) only
 * re-renders the tray, never the composer surface around it (editor,
 * toolbar, pickers, usage footer).
 *
 * The open sheet closes when a composer menu opens, when the thread changes,
 * and when an approval / ask-user card takes the input slot (a tall sheet
 * above a tall card would push the card's options out of the window).
 */
export function ComposerTrayHost({
  context,
  queue
}: {
  context: FloatingComposerRenderContext
  /** The queue section (null when nothing is queued). */
  queue: ReactNode
}): ReactElement | null {
  const {
    activeThreadId, compact, composerInterrupt, composerMenuOpen, fileMentions, goalPanelOpen, slashQuery
  } = context
  // Every kind hook runs on every render, unconditionally, in bar order.
  const graphKind = useGraphTrayKind(context)
  const todoKind = useTodoTrayKind(context)
  const workersKind = useWorkersTrayKind(context)
  const dispatchKind = useDispatchTrayKind(context)
  const shellsKind = useShellsTrayKind(context)
  const goalKind = useGoalTrayKind(context)
  const menuOpen = composerMenuOpen === true || slashQuery != null || goalPanelOpen === true ||
    fileMentions?.showMenu === true
  return (
    <ComposerActivityTray
      kinds={[graphKind, todoKind, workersKind, dispatchKind, shellsKind, goalKind]}
      compact={compact === true}
      queue={queue}
      menuOpen={menuOpen || composerInterrupt != null}
      resetKey={activeThreadId ?? null}
    />
  )
}
