import { create } from 'zustand'
import type { ReviewRevision } from '@shared/review-revision'
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
  TaskWorkspaceIntegrateMode,
  TaskWorkspaceIntegratePreview,
  TaskWorkspaceIntegrateResponse,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import { getProvider } from '../agent/registry'
import i18n from '../i18n'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { finishReviewSendAttempt, rejectReviewSendAttempt, reviewSendAttempt } from './review-send-attempt'

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
  revision?: ReviewRevision
  loaded?: boolean
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
  /** Read-only integrate availability for the primary action (11 §7.1). */
  integratePreview?: TaskWorkspaceIntegratePreview
  integratePreviewLoaded?: boolean
  actionPending?: 'integrate' | 'discard' | 'cleanup'
  actionError?: string
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
  /**
   * threadId → workspaceId for an external-harness plan build whose worker
   * turn just settled (07 §10). The workbench consumes the flag to open the
   * Review panel so the user can choose the integration mode.
   */
  pendingPlanBuildReview: Record<string, string>
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
  workspaces: {},
  pendingPlanBuildReview: {}
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

const diffGenerations = new Map<string, number>()

export async function loadWorkspaceDiff(workspaceId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.getTaskWorkspaceDiff) return
  const request = (diffGenerations.get(workspaceId) ?? 0) + 1
  diffGenerations.set(workspaceId, request)
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { loading: true, error: undefined })
  }))
  try {
    const { files, headRevision, revision } = await provider.getTaskWorkspaceDiff(workspaceId)
    if (diffGenerations.get(workspaceId) !== request) return
    useReviewStore.setState((s) => {
      const current = s.workspaces[workspaceId]
      const next = patchWorkspace(s.workspaces, workspaceId, {
        files,
        loading: false,
        loaded: true,
        headRevision,
        revision,
        integratePreview: undefined,
        integratePreviewLoaded: false,
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
    if (diffGenerations.get(workspaceId) !== request) return
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

export { watchReviewWorkspace, unwatchReviewWorkspace } from './review-workspace-watch'

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

const reviewSends = new Map<string, Promise<SendReviewResponse | null>>()

export function sendReviewBatch(
  workspaceId: string, target: ReviewSendTarget, note?: string
): Promise<SendReviewResponse | null> {
  const pending = reviewSends.get(workspaceId)
  if (pending) return pending
  const request = performReviewSend(workspaceId, target, note).finally(() => reviewSends.delete(workspaceId))
  reviewSends.set(workspaceId, request)
  return request
}

async function performReviewSend(
  workspaceId: string,
  target: ReviewSendTarget,
  note?: string
): Promise<SendReviewResponse | null> {
  const provider = getProvider()
  if (!provider.sendReview) return null
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { sending: true, sendError: undefined })
  }))
  try {
    await flushReviewDrafts(workspaceId)
    const pending = pendingReviewComments(workspaceId)
    const current = useReviewStore.getState().workspaces[workspaceId]
    if (pending.some((comment) => isLocalCommentId(comment.commentId)) || Object.keys(current?.dirtyComments ?? {}).length) {
      throw new Error(i18n.t('common:reviewSaveBeforeSend'))
    }
    const ids = pending.map((comment) => comment.commentId)
    if (!ids.length && !note?.trim()) return null
    const attempt = reviewSendAttempt(workspaceId, pending, target, note, current?.revision)
    const language = typeof navigator !== 'undefined' ? navigator.language : undefined
    const response = await provider.sendReview(workspaceId, {
      commentIds: ids,
      target,
      ...attempt,
      ...(note ? { note } : {})
    }, language)
    finishReviewSendAttempt(workspaceId)
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
          requests: [...ws.requests.filter((entry) => entry.requestId !== response.request.requestId), response.request],
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
    const stale = rejectReviewSendAttempt(workspaceId, error)
    if (stale) void Promise.all([loadWorkspaceDiff(workspaceId), loadReviewComments(workspaceId)])
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        sending: false,
        sendError: stale ? i18n.t('common:reviewVersionChanged') : formatRuntimeError(error)
      })
    }))
    return null
  } finally {
    useReviewStore.setState((s) => ({ workspaces: patchWorkspace(s.workspaces, workspaceId, { sending: false }) }))
  }
}

// ---------------------------------------------------------------------------
// Integrate / discard / cleanup (docs/ade/11 §7): user-initiated lifecycle
// actions behind the review panel's single primary action.
// ---------------------------------------------------------------------------

/** Every thread binding pointing at this workspace shows its latest record. */
function patchBindingRecords(
  bindings: ReviewStoreState['bindings'],
  workspaceId: string,
  record: TaskWorkspaceRecord | null
): ReviewStoreState['bindings'] {
  let changed = false
  const next = { ...bindings }
  for (const [threadId, bound] of Object.entries(next)) {
    if (bound?.workspaceId === workspaceId) {
      next[threadId] = record && record.state !== 'removed' ? record : null
      changed = true
    }
  }
  return changed ? next : bindings
}

export async function loadIntegratePreview(workspaceId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.getTaskWorkspaceIntegratePreview) return
  try {
    const { preview } = await provider.getTaskWorkspaceIntegratePreview(workspaceId)
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        integratePreview: preview,
        integratePreviewLoaded: true
      })
    }))
  } catch {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, { integratePreviewLoaded: true })
    }))
  }
}

/**
 * Apply-patch or merge-branch integration. Returns the response so the
 * caller can open the result dialog; state/binding refresh happens here so
 * every client sees the same record.
 */
export async function integrateWorkspace(
  workspaceId: string,
  mode: TaskWorkspaceIntegrateMode
): Promise<TaskWorkspaceIntegrateResponse | null> {
  const provider = getProvider()
  if (!provider.integrateTaskWorkspace) return null
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, {
      actionPending: 'integrate',
      actionError: undefined
    })
  }))
  try {
    const token = useReviewStore.getState().workspaces[workspaceId]?.integratePreview?.previewToken
    const response = token
      ? await provider.integrateTaskWorkspace(workspaceId, mode, token)
      : await provider.integrateTaskWorkspace(workspaceId, mode)
    useReviewStore.setState((s) => ({
      bindings: patchBindingRecords(s.bindings, workspaceId, response.record),
      workspaces: patchWorkspace(s.workspaces, workspaceId, { actionPending: undefined })
    }))
    // The diff the user was reviewing just became the source checkout.
    void loadIntegratePreview(workspaceId)
    return response
  } catch (error) {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        actionPending: undefined,
        actionError: error instanceof Error ? error.message : String(error)
      })
    }))
    return null
  }
}

export async function discardWorkspace(
  workspaceId: string
): Promise<TaskWorkspaceRecord | null> {
  const provider = getProvider()
  if (!provider.discardTaskWorkspace) return null
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, {
      actionPending: 'discard',
      actionError: undefined
    })
  }))
  try {
    const { record } = await provider.discardTaskWorkspace(workspaceId)
    useReviewStore.setState((s) => ({
      bindings: patchBindingRecords(s.bindings, workspaceId, record),
      workspaces: patchWorkspace(s.workspaces, workspaceId, { actionPending: undefined })
    }))
    return record
  } catch (error) {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, {
        actionPending: undefined,
        actionError: error instanceof Error ? error.message : String(error)
      })
    }))
    return null
  }
}

/** Non-force worktree removal offered after a successful integrate. */
export async function cleanupWorkspace(workspaceId: string): Promise<TaskWorkspaceRecord | null> {
  const provider = getProvider()
  if (!provider.cleanupTaskWorkspace) return null
  useReviewStore.setState((s) => ({
    workspaces: patchWorkspace(s.workspaces, workspaceId, { actionPending: 'cleanup' })
  }))
  try {
    const { record } = await provider.cleanupTaskWorkspace(workspaceId)
    useReviewStore.setState((s) => ({
      bindings: patchBindingRecords(s.bindings, workspaceId, record),
      workspaces: patchWorkspace(s.workspaces, workspaceId, { actionPending: undefined })
    }))
    return record
  } catch {
    useReviewStore.setState((s) => ({
      workspaces: patchWorkspace(s.workspaces, workspaceId, { actionPending: undefined })
    }))
    return null
  }
}
