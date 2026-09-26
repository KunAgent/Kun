import { create } from 'zustand'
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
        // Drop cached details for files that vanished from the new list.
        details: Object.fromEntries(
          Object.entries(current?.details ?? {})
            .filter(([path]) => files.some((f) => f.path === path))
        )
      })
      // Files over the lazy threshold stay collapsed; others default open.
      next[workspaceId].expandedPaths = Object.fromEntries(
        files.map((f) => [f.path, current?.expandedPaths[f.path] ?? !f.tooLarge])
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
