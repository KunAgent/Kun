import type { ActivityRow } from '@shared/activity-row'
import { getProvider } from '../agent/registry'
import { loadWorkspaceDiff, useReviewStore } from './review-store'

/**
 * External-harness plan builds (07 §10): the build turn runs on the build
 * thread inside a host-managed task worktree. The activity feed registers the
 * thread as its own unit; once the row settles we capture a fresh diff and
 * flag the thread so the workbench opens the Review panel for the user to
 * pick the integration mode (`apply-patch` / `merge-branch` / `push-pr`).
 */

const SETTLED_MAIN_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'idle', 'closed'])

const settled = (row?: ActivityRow): boolean =>
  Boolean(row && (row.lastOutcome || SETTLED_MAIN_STATES.has(row.mainState)))

const watchers = new Map<string, AbortController>()

function flagPlanBuildReview(threadId: string, workspaceId: string): void {
  useReviewStore.setState((s) => ({
    pendingPlanBuildReview: { ...s.pendingPlanBuildReview, [threadId]: workspaceId }
  }))
}

/** Consume + clear a pending review flag; returns the workspaceId or null. */
export function takePlanBuildReview(threadId: string): string | null {
  const workspaceId = useReviewStore.getState().pendingPlanBuildReview[threadId]
  if (!workspaceId) return null
  useReviewStore.setState((s) => {
    const { [threadId]: _drop, ...rest } = s.pendingPlanBuildReview
    return { pendingPlanBuildReview: rest }
  })
  return workspaceId
}

export function unwatchPlanBuildReview(threadId: string): void {
  watchers.get(threadId)?.abort()
  watchers.delete(threadId)
}

/**
 * Watch the build thread's activity row; on first settle, mark the review as
 * pending and refresh the diff so the panel opens with current contents.
 * A row that settled before we subscribed (instant failure) is flagged from
 * the initial snapshot. One-shot per thread; manual review stays available.
 */
export function watchPlanBuildReview(workspaceId: string, threadId: string): void {
  const provider = getProvider()
  const snapshot = provider.getActivitySnapshot?.bind(provider)
  const poll = provider.pollActivity?.bind(provider)
  if (!snapshot || !poll || watchers.has(threadId)) return
  const controller = new AbortController()
  watchers.set(threadId, controller)
  void (async () => {
    try {
      let { cursor, rows } = await snapshot({})
      if (settled(rows.find((row) => row.unitId === threadId))) {
        flagPlanBuildReview(threadId, workspaceId)
        await loadWorkspaceDiff(workspaceId)
        return
      }
      while (!controller.signal.aborted) {
        const response = await poll(cursor, 30_000, controller.signal)
        if (response.type === 'reset_required') {
          const next = await snapshot({})
          cursor = next.cursor
          if (settled(next.rows.find((row) => row.unitId === threadId))) {
            flagPlanBuildReview(threadId, workspaceId)
            await loadWorkspaceDiff(workspaceId)
            return
          }
          continue
        }
        cursor = response.cursor
        if (controller.signal.aborted) break
        if (response.changes.some((change) => change.unitId === threadId && settled(change.row))) {
          flagPlanBuildReview(threadId, workspaceId)
          await loadWorkspaceDiff(workspaceId)
          return
        }
      }
    } catch {
      // Aborted or runtime offline: the bound Review tab still works manually.
    } finally {
      if (watchers.get(threadId) === controller) watchers.delete(threadId)
    }
  })()
}
