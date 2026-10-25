/**
 * New task shows its blank page on click. Creating the runtime thread needs
 * several round trips (settings, project defaults, reuse lookup, create), so
 * the store first leaves the current conversation the same way selecting
 * another thread would, and the new thread activates when ready. A project
 * row's New session also points the blank page at that project.
 */
import type { ChatState } from './chat-store-types'
import { clearedThreadSelection } from './chat-store-runtime-helpers'
import { clearBusyWatchdog, resetBusyRecoveryAttempts } from './chat-store-schedulers'
import {
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { invalidateThreadSnapshot, snapshotThreadProjection } from './thread-snapshot-cache'
import { beginThreadSelection } from './thread-selection-hydration'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import {
  activeChatWorkspaceRoot,
  threadActionSharedState,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'

/**
 * An empty conversation is what New task would reuse anyway, so it stays put
 * (no flash). Anything with content, a running turn, a queue or an unfinished
 * hydration is replaced by the blank page at once.
 */
export function threadNeedsBlankPageForNewTask(state: Pick<ChatState,
  'activeThreadId' | 'busy' | 'blocks' | 'queuedMessages' | 'threadLoadingId'>): boolean {
  if (!state.activeThreadId) return false
  return state.busy || state.queuedMessages.length > 0 || state.threadLoadingId === state.activeThreadId ||
    state.blocks.some((block) => block.kind === 'user')
}

/**
 * The project a New session was asked for, when it is not the one in view.
 * The blank page then shows that project and a message typed on it lands
 * there. The pick stays renderer-local: the created thread carries it.
 */
export function newTaskWorkspaceSwitch(state: ChatState, workspaceRoot: string | undefined): string | null {
  const target = normalizeWorkspaceRoot(workspaceRoot ?? '')
  if (!target) return null
  return target === normalizeWorkspaceRoot(activeChatWorkspaceRoot(state)) ? null : target
}

export function createNewTaskLeaveActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'leaveThreadForNewTask'> {
  const { set, get, sseAbortRef } = context
  return {
    leaveThreadForNewTask: (options) => {
      const state = get()
      // Without a ready runtime New task cannot proceed; keep the conversation and its error in view.
      if (state.runtimeConnection !== 'ready') return false
      const switchTo = newTaskWorkspaceSwitch(state, options?.workspaceRoot)
      const prevId = state.activeThreadId
      const leaves = Boolean(prevId) && (threadNeedsBlankPageForNewTask(state) || switchTo !== null)
      if (!leaves && switchTo === null) return false
      const workspacePatch = switchTo === null ? {} : {
        workspaceRoot: switchTo,
        workspaceRootLocal: true,
        workspaceLabel: workspaceLabelFromPath(switchTo)
      }
      if (!leaves || !prevId) {
        // Already on a blank page: only the project it shows changes.
        set({ ...workspacePatch, error: null })
        return false
      }
      // Fence in-flight hydration/recovery of the outgoing thread like a switch does.
      beginThreadSelection(runtime, prevId, '')
      // Park the outgoing projection so returning to it is instant.
      if (threadActionSharedState.expandedHistoryThreadIds.delete(prevId)) invalidateThreadSnapshot(prevId)
      else snapshotThreadProjection(state)
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      resetBusyRecoveryAttempts()
      const watchTurnCompletion = { ...state.watchTurnCompletion }
      if (state.busy) {
        // A running turn keeps going in Kun; notify on completion as for any background thread.
        watchTurnCompletion[prevId] = true
        watchTurnCompletionNotification(prevId, Date.now(), turnCompleteNotificationSource(prevId, state))
      }
      set({ ...clearedThreadSelection(), ...workspacePatch, watchTurnCompletion, error: null })
      if (state.busy) syncTurnCompletionPoll(set, get)
      return true
    }
  }
}
