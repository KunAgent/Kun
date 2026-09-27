import { create } from 'zustand'
import type { ActivityRow } from '@shared/activity-row'
import type {
  CreateReviewCommentInput,
  ReviewComment,
  ReviewSendRecord,
  ReviewSendTarget,
  SendReviewResponse
} from '@shared/review-comment'
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
  /** Kun-persisted comments + send history for this workspace (11 §4). */
  comments: ReviewComment[]
  requests: ReviewSendRecord[]
  commentsLoaded: boolean
  /** commentId → pending server op; drafts stay local until synced. */
  dirtyComments: Record<string, 'create' | 'update'>
  sending: boolean
  sendError?: string
  lastSent?: { round: number; targetKind: ReviewSendTarget['kind']; outcomeRef?: string }
}

const emptyWorkspaceReview = (): WorkspaceReview => ({
  files: [],
  loading: false,
  expandedPaths: {},
  viewMode: 'unified',
  details: {},
  comments: [],
  requests: [],
  commentsLoaded: false,
  dirtyComments: {},
  sending: false
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

/* ------------------------------------------------------------------ */
/* Review comments (11 §4): local-first drafts debounced into kun.     */
/* ------------------------------------------------------------------ */

const REVIEW_SYNC_DELAY_MS = 1_000
let localCommentSeq = 0
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

const isLocalCommentId = (id: string): boolean => id.startsWith('local_')

const patchComment = (
  comments: ReviewComment[],
  commentId: string,
  patch: Partial<ReviewComment>
): ReviewComment[] =>
  comments.map((c) => (c.commentId === commentId ? { ...c, ...patch } : c))

/** Merge the server file with unsynced local drafts/edits (offline-safe). */
function mergeComments(
  server: ReviewComment[],
  local: ReviewComment[],
  dirty: Record<string, 'create' | 'update'>
): ReviewComment[] {
  const merged = server.map((comment) => {
    const unsynced = dirty[comment.commentId] ? local.find((c) => c.commentId === comment.commentId) : undefined
    return unsynced ?? comment
  })
  for (const comment of local) {
    if (isLocalCommentId(comment.commentId)) merged.push(comment)
  }
  return merged
}

export function loadReviewComments(workspaceId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.listReviewComments) return Promise.resolve()
  return provider.listReviewComments(workspaceId)
    .then((file) => {
      useReviewStore.setState((s) => {
        const current = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
        return {
          workspaces: patchWorkspace(s.workspaces, workspaceId, {
            comments: mergeComments(file.comments, current.comments, current.dirtyComments),
            requests: file.requests,
            commentsLoaded: true
          })
        }
      })
      // Connectivity restored — retry anything still pending.
      if (Object.keys(useReviewStore.getState().workspaces[workspaceId]?.dirtyComments ?? {}).length) {
        scheduleReviewSync(workspaceId)
      }
    })
    .catch(() => undefined)
}

export type ReviewDraftInput = Omit<CreateReviewCommentInput, 'body'> & { body?: string }

/** New comment at a diff line; starts as an unsynced draft (11 §4.2). */
export function createReviewDraft(workspaceId: string, input: ReviewDraftInput): string {
  const now = new Date().toISOString()
  const commentId = `local_${(++localCommentSeq).toString(36)}${Date.now().toString(36)}`
  const draft: ReviewComment = {
    commentId,
    workspaceId,
    ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
    path: input.path,
    side: input.side,
    line: input.line,
    anchor: input.anchor,
    body: input.body ?? '',
    state: 'draft',
    outdated: false,
    author: 'user',
    createdAt: now,
    updatedAt: now
  }
  useReviewStore.setState((s) => {
    const current = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
    return {
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        comments: [...current.comments, draft],
        dirtyComments: { ...current.dirtyComments, [commentId]: 'create' }
      })
    }
  })
  scheduleReviewSync(workspaceId)
  return commentId
}

/** Draft body edits write locally first; kun sync is debounced. */
export function updateReviewDraftBody(
  workspaceId: string,
  commentId: string,
  body: string
): void {
  useReviewStore.setState((s) => {
    const current = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
    return {
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        comments: patchComment(current.comments, commentId, {
          body,
          updatedAt: new Date().toISOString()
        }),
        dirtyComments: {
          ...current.dirtyComments,
          [commentId]: current.dirtyComments[commentId]
            ?? (isLocalCommentId(commentId) ? 'create' : 'update')
        }
      })
    }
  })
  scheduleReviewSync(workspaceId)
}

export function resolveReviewComment(workspaceId: string, commentId: string): void {
  useReviewStore.setState((s) => {
    const current = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
    const target = current.comments.find((c) => c.commentId === commentId)
    if (!target) return {}
    if (isLocalCommentId(commentId)) {
      // Never synced: a resolved empty draft carries no value — drop it.
      const { [commentId]: _drop, ...dirty } = current.dirtyComments
      return {
        workspaces: patchWorkspace(s.workspaces, workspaceId, {
          comments: current.comments.filter((c) => c.commentId !== commentId),
          dirtyComments: dirty
        })
      }
    }
    return {
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        comments: patchComment(current.comments, commentId, {
          state: 'resolved',
          updatedAt: new Date().toISOString()
        }),
        dirtyComments: { ...current.dirtyComments, [commentId]: 'update' }
      })
    }
  })
  scheduleReviewSync(workspaceId)
}

/** Cancels a local-only draft; synced comments use resolveReviewComment. */
export function discardReviewDraft(workspaceId: string, commentId: string): void {
  useReviewStore.setState((s) => {
    const current = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
    const { [commentId]: _drop, ...dirty } = current.dirtyComments
    return {
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        comments: isLocalCommentId(commentId)
          ? current.comments.filter((c) => c.commentId !== commentId)
          : current.comments,
        dirtyComments: dirty
      })
    }
  })
}

function scheduleReviewSync(workspaceId: string): void {
  const existing = syncTimers.get(workspaceId)
  if (existing) clearTimeout(existing)
  syncTimers.set(workspaceId, setTimeout(() => {
    syncTimers.delete(workspaceId)
    void flushReviewDrafts(workspaceId)
  }, REVIEW_SYNC_DELAY_MS))
}

/**
 * Push dirty drafts/edits into kun. Failed ops stay dirty so a later
 * flush — e.g. after reconnect — retries them (11 §4.2 offline).
 */
export async function flushReviewDrafts(workspaceId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.createReviewComment || !provider.updateReviewComment) return
  const pending = Object.entries(
    useReviewStore.getState().workspaces[workspaceId]?.dirtyComments ?? {}
  )
  for (const [commentId, op] of pending) {
    const current = useReviewStore.getState().workspaces[workspaceId]
    const comment = current?.comments.find((c) => c.commentId === commentId)
    if (!comment || !current?.dirtyComments[commentId]) continue
    // Empty drafts stay local — the contract requires a non-empty body.
    if ((op === 'create' || isLocalCommentId(commentId)) && !comment.body.trim()) continue
    try {
      if (op === 'create' || isLocalCommentId(commentId)) {
        const { comment: saved } = await provider.createReviewComment(workspaceId, {
          ...(comment.dispatchId ? { dispatchId: comment.dispatchId } : {}),
          path: comment.path,
          side: comment.side,
          line: comment.line,
          anchor: comment.anchor,
          body: comment.body
        })
        useReviewStore.setState((s) => {
          const ws = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
          const latest = ws.comments.find((c) => c.commentId === commentId)
          const { [commentId]: _done, ...dirty } = ws.dirtyComments
          return {
            workspaces: patchWorkspace(s.workspaces, workspaceId, {
              comments: ws.comments.map((c) =>
                c.commentId === commentId ? { ...saved, body: c.body } : c),
              // Edits typed while the create was in flight re-dirty the saved id.
              dirtyComments: !latest || latest.body === saved.body
                ? dirty
                : { ...dirty, [saved.commentId]: 'update' }
            })
          }
        })
      } else {
        await provider.updateReviewComment(workspaceId, commentId, {
          body: comment.body,
          state: comment.state
        })
        useReviewStore.setState((s) => {
          const ws = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
          const { [commentId]: _done, ...dirty } = ws.dirtyComments
          return {
            workspaces: patchWorkspace(s.workspaces, workspaceId, { dirtyComments: dirty })
          }
        })
      }
    } catch {
      // Offline / runtime busy: the dirty marker stays for the next flush.
    }
  }
}

/** Unresolved (draft + previously sent) comments — the next batch (11 §4.4). */
export function pendingReviewComments(workspaceId: string): ReviewComment[] {
  const ws = useReviewStore.getState().workspaces[workspaceId]
  return (ws?.comments ?? []).filter((c) => c.state !== 'resolved')
}

export async function sendReviewBatch(
  workspaceId: string,
  target: ReviewSendTarget,
  note?: string
): Promise<SendReviewResponse | null> {
  const provider = getProvider()
  if (!provider.sendReview) return null
  await flushReviewDrafts(workspaceId)
  const ids = pendingReviewComments(workspaceId)
    .filter((c) => !isLocalCommentId(c.commentId))
    .map((c) => c.commentId)
  if (!ids.length) return null
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { sending: true, sendError: undefined })
  }))
  try {
    const language = typeof navigator !== 'undefined' ? navigator.language : undefined
    const response = await provider.sendReview(workspaceId, {
      commentIds: ids,
      target,
      ...(note ? { note } : {})
    }, language)
    const sentAt = new Date().toISOString()
    useReviewStore.setState((s) => {
      const ws = s.workspaces[workspaceId] ?? emptyWorkspaceReview()
      const sentIds = new Set(response.request.commentIds)
      return {
        workspaces: patchWorkspace(s.workspaces, workspaceId, {
          sending: false,
          comments: ws.comments.map((c) =>
            sentIds.has(c.commentId)
              ? { ...c, state: 'sent' as const, sentInRequestId: response.request.requestId, updatedAt: sentAt }
              : c),
          requests: [...ws.requests, response.request],
          lastSent: {
            round: response.request.round,
            targetKind: target.kind,
            ...(response.request.outcomeRef ? { outcomeRef: response.request.outcomeRef } : {})
          }
        })
      }
    })
    return response
  } catch (error) {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        sending: false,
        sendError: error instanceof Error ? error.message : String(error)
      })
    }))
    return null
  }
}
