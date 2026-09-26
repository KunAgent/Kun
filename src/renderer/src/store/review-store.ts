import { create } from 'zustand'
import type { ActivityRow } from '@shared/activity-row'
import type {
  TaskWorkspaceDiffFile,
  TaskWorkspaceDiffFileResponse,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import { getProvider } from '../agent/registry'

/**
 * Review-panel state (docs/ade/11 §3): which task workspace binds to each
 * thread, the per-workspace diff file list, lazily loaded per-file content,
 * and collapse / unified-vs-split view state. Fetches go through the active
 * provider so tests can substitute them.
 */
export type ReviewViewMode = 'unified' | 'split'

/** Files with more changed lines than this start collapsed (11 §3 perf). */
export const REVIEW_LARGE_FILE_LINES = 5_000

export type ReviewFileEntry = {
  detail?: TaskWorkspaceDiffFileResponse
  loading: boolean
  error?: string
}

export type WorkspaceReview = {
  files: TaskWorkspaceDiffFile[]
  headRevision?: string
  loading: boolean
  error?: string
  expandedPaths: Record<string, boolean>
  viewMode: ReviewViewMode
  details: Record<string, ReviewFileEntry>
}

const emptyWorkspaceReview = (): WorkspaceReview => ({
  files: [],
  loading: false,
  expandedPaths: {},
  viewMode: 'unified',
  details: {}
})

export type ReviewStoreState = {
  /** threadId → bound workspace (`null` once looked up and absent). */
  bindings: Record<string, TaskWorkspaceRecord | null | undefined>
  workspaces: Record<string, WorkspaceReview>
}

const patchWorkspace = (
  workspaces: Record<string, WorkspaceReview>,
  workspaceId: string,
  patch: Partial<WorkspaceReview>
): Record<string, WorkspaceReview> => ({
  ...workspaces,
  [workspaceId]: { ...(workspaces[workspaceId] ?? emptyWorkspaceReview()), ...patch }
})

export const useReviewStore = create<ReviewStoreState>(() => ({
  bindings: {},
  workspaces: {}
}))

/** Latest record for a thread; `null` results are re-checked on each call. */
export async function ensureThreadBinding(threadId: string): Promise<void> {
  const cached = useReviewStore.getState().bindings[threadId]
  if (cached !== undefined && cached !== null) return
  const provider = getProvider()
  if (!provider.listTaskWorkspaces) return
  try {
    const { records } = await provider.listTaskWorkspaces({ boundThreadId: threadId })
    const bound = records
      .filter((r) => !['removed', 'orphaned', 'failed'].includes(r.state))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    useReviewStore.setState((s) => ({
      bindings: { ...s.bindings, [threadId]: bound }
    }))
  } catch {
    useReviewStore.setState((s) => ({
      bindings: { ...s.bindings, [threadId]: null }
    }))
  }
}

export async function loadWorkspaceDiff(workspaceId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.getTaskWorkspaceDiff) return
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { loading: true, error: undefined })
  }))
  try {
    const { files, headRevision } = await provider.getTaskWorkspaceDiff(workspaceId)
    useReviewStore.setState((s) => {
      const current = s.workspaces[workspaceId]
      const next = patchWorkspace(s.workspaces, workspaceId, {
        files,
        loading: false,
        ...(headRevision ? { headRevision } : {}),
        // A fresh capture invalidates every cached per-file payload; blocks
        // still expanded refetch lazily on render.
        details: {}
      })
      // Files over the lazy/large threshold default to collapsed (11 §3).
      next[workspaceId].expandedPaths = Object.fromEntries(
        files.map((f) => [f.path, current?.expandedPaths[f.path]
          ?? (!f.tooLarge && f.insertions + f.deletions <= REVIEW_LARGE_FILE_LINES)])
      )
      return { workspaces: next }
    })
  } catch (error) {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }))
  }
}

export async function loadWorkspaceDiffFile(
  workspaceId: string,
  path: string
): Promise<void> {
  const provider = getProvider()
  if (!provider.getTaskWorkspaceDiffFile) return
  const entry = useReviewStore.getState().workspaces[workspaceId]?.details[path]
  if (entry?.loading || entry?.detail) return
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, {
      details: {
        ...s.workspaces[workspaceId]?.details,
        [path]: { loading: true }
      }
    })
  }))
  try {
    const detail = await provider.getTaskWorkspaceDiffFile(workspaceId, path)
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        details: { ...s.workspaces[workspaceId]?.details, [path]: { loading: false, detail } }
      })
    }))
  } catch (error) {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        details: {
          ...s.workspaces[workspaceId]?.details,
          [path]: { loading: false, error: error instanceof Error ? error.message : String(error) }
        }
      })
    }))
  }
}

export function toggleReviewFileExpanded(workspaceId: string, path: string): void {
  useReviewStore.setState((s) => {
    const current = s.workspaces[workspaceId]
    return {
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        expandedPaths: {
          ...current?.expandedPaths,
          [path]: !(current?.expandedPaths[path] ?? true)
        }
      })
    }
  })
}

export function setReviewViewMode(workspaceId: string, viewMode: ReviewViewMode): void {
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { viewMode })
  }))
}

const SETTLED_MAIN_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'idle', 'closed'])

/** A row settles when the unit finished work (last outcome) or went quiet. */
const settled = (row?: ActivityRow): boolean =>
  Boolean(row && (row.lastOutcome || SETTLED_MAIN_STATES.has(row.mainState)))

const watchControllers = new Map<string, AbortController>()

/**
 * Auto-refresh the diff after the bound unit reports settled work via the
 * activity feed (11 §3/§4.4): a finished worker mutates the worktree, so the
 * panel reloads instead of showing a stale patch. No-ops without an activity
 * provider surface; manual refresh stays available.
 */
export function watchReviewWorkspace(workspaceId: string): void {
  if (watchControllers.has(workspaceId)) return
  const binding = Object.values(useReviewStore.getState().bindings)
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
      let { cursor } = await snapshot({})
      while (!controller.signal.aborted) {
        const response = await poll(cursor, 30_000, controller.signal)
        if (response.type === 'reset_required') {
          cursor = (await snapshot({})).cursor
          continue
        }
        cursor = response.cursor
        if (controller.signal.aborted) break
        if (response.changes.some((change) => change.unitId === unitId && settled(change.row))) {
          await loadWorkspaceDiff(workspaceId)
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
