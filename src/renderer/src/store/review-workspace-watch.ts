import type { ActivityRow } from '@shared/activity-row'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import { getProvider } from '../agent/registry'
import { loadReviewComments, loadWorkspaceDiff, useReviewStore } from './review-store'

const SETTLED_MAIN_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'idle', 'closed'])

/** Outcomes persist into later turns, so only a terminal main state has settled. */
const settlement = (row?: ActivityRow): string | null =>
  row && SETTLED_MAIN_STATES.has(row.mainState)
    ? JSON.stringify([row.turnId ?? '', row.lastOutcome ?? '', row.mainState]) : null

const watchControllers = new Map<string, AbortController>()

/**
 * Auto-refresh the diff after the bound unit reports settled work via the
 * activity feed (11 §3/§4.4): a finished worker mutates the worktree, so the
 * panel reloads instead of showing a stale patch. No-ops without an activity
 * provider surface; manual refresh stays available.
 */
export function watchReviewWorkspace(workspaceId: string, explicitBinding?: TaskWorkspaceRecord): void {
  if (watchControllers.has(workspaceId)) return
  const binding = explicitBinding ?? Object.values(useReviewStore.getState().bindings)
    .find((record) => record?.workspaceId === workspaceId)
  const unitId = binding?.unitId ?? binding?.ownerThreadId
  const provider = getProvider()
  const snapshot = provider.getActivitySnapshot?.bind(provider)
  const poll = provider.pollActivity?.bind(provider)
  if (!unitId || !snapshot || !poll) return
  const controller = new AbortController()
  watchControllers.set(workspaceId, controller)
  void (async () => {
    try {
      const initial = await snapshot({})
      let { cursor } = initial
      let observed = settlement(initial.rows?.find((row) => row.unitId === unitId))
      const changedSettlement = (row?: ActivityRow): boolean => {
        const next = settlement(row)
        const changed = next !== null && next !== observed
        observed = next
        return changed
      }
      while (!controller.signal.aborted) {
        const response = await poll(cursor, 30_000, controller.signal)
        if (response.type === 'reset_required') {
          const reset = await snapshot({})
          cursor = reset.cursor
          if (!controller.signal.aborted && changedSettlement(reset.rows?.find((row) => row.unitId === unitId))) {
            await Promise.all([loadWorkspaceDiff(workspaceId), loadReviewComments(workspaceId)])
          }
          continue
        }
        cursor = response.cursor
        if (controller.signal.aborted) break
        let refresh = false
        for (const change of response.changes) {
          if (change.unitId === unitId && changedSettlement(change.row)) refresh = true
        }
        if (refresh) {
          // New capture: fresh diff + kun re-anchored comment positions (11 §4.3).
          await Promise.all([loadWorkspaceDiff(workspaceId), loadReviewComments(workspaceId)])
        }
      }
    } catch {
      // Aborted or runtime offline: the panel's manual refresh covers this.
    } finally {
      if (watchControllers.get(workspaceId) === controller) {
        watchControllers.delete(workspaceId)
      }
    }
  })()
}

export function unwatchReviewWorkspace(workspaceId: string): void {
  watchControllers.get(workspaceId)?.abort()
  watchControllers.delete(workspaceId)
}
