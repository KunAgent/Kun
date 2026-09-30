import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'

const provider = {
  listTaskWorkspaces: vi.fn(),
  getTaskWorkspaceDiff: vi.fn(),
  getTaskWorkspaceDiffFile: vi.fn(),
  getActivitySnapshot: vi.fn(),
  pollActivity: vi.fn(),
  listReviewComments: vi.fn(),
  createReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  sendReview: vi.fn()
}

vi.mock('../agent/registry', () => ({
  getProvider: () => provider
}))

import {
  createReviewDraft,
  ensureThreadBinding,
  flushReviewDrafts,
  loadReviewComments,
  loadWorkspaceDiff,
  loadWorkspaceDiffFile,
  pendingReviewComments,
  resolveReviewComment,
  sendReviewBatch,
  setReviewViewMode,
  toggleReviewFileExpanded,
  unwatchReviewWorkspace,
  updateReviewDraftBody,
  useReviewStore,
  watchReviewWorkspace
} from './review-store'

function record(overrides: Partial<TaskWorkspaceRecord> = {}): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_deadbeef',
    ownerThreadId: 'thread-1',
    isolation: 'worktree',
    sourceRoot: '/repo',
    path: '/repo/.worktrees/tws_deadbeef',
    state: 'ready',
    changedFiles: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useReviewStore.setState({ bindings: {}, workspaces: {} })
})

describe('review-store', () => {
  it('resolves the newest live workspace bound to a thread', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({
      records: [
        record({ workspaceId: 'tws_old00000', updatedAt: '2026-01-01T00:00:00Z' }),
        record({ workspaceId: 'tws_new00000', updatedAt: '2026-01-02T00:00:00Z' }),
        record({ workspaceId: 'tws_gone0000', state: 'removed', updatedAt: '2026-01-03T00:00:00Z' })
      ]
    })
    await ensureThreadBinding('thread-1')
    expect(provider.listTaskWorkspaces).toHaveBeenCalledWith({ boundThreadId: 'thread-1' })
    expect(useReviewStore.getState().bindings['thread-1']?.workspaceId).toBe('tws_new00000')
  })

  it('returns null for unbound threads and re-checks on the next call', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [] })
    await ensureThreadBinding('t-x')
    await ensureThreadBinding('t-x')
    expect(useReviewStore.getState().bindings['t-x']).toBeNull()
    expect(provider.listTaskWorkspaces).toHaveBeenCalledTimes(2)
    provider.listTaskWorkspaces.mockResolvedValue({ records: [record()] })
    await ensureThreadBinding('t-x')
    expect(useReviewStore.getState().bindings['t-x']?.workspaceId).toBe('tws_deadbeef')
  })

  it('loads the diff list and defaults expanded state per file', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [
        { path: 'a.ts', status: 'modified', insertions: 2, deletions: 1, binary: false, tooLarge: false },
        { path: 'big.ts', status: 'modified', insertions: 6000, deletions: 0, binary: false, tooLarge: true }
      ],
      headRevision: 'abc123'
    })
    await loadWorkspaceDiff('tws_deadbeef')
    const ws = useReviewStore.getState().workspaces['tws_deadbeef']
    expect(ws.files).toHaveLength(2)
    expect(ws.headRevision).toBe('abc123')
    expect(ws.expandedPaths['a.ts']).toBe(true)
    expect(ws.expandedPaths['big.ts']).toBe(false)
  })

  it('lazy-loads a file detail once and reports errors', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }]
    })
    provider.getTaskWorkspaceDiffFile.mockResolvedValue({
      path: 'a.ts', status: 'modified', insertions: 1, deletions: 0,
      binary: false, tooLarge: false, patch: 'p', oldText: 'o', newText: 'n'
    })
    await loadWorkspaceDiff('tws_deadbeef')
    await loadWorkspaceDiffFile('tws_deadbeef', 'a.ts')
    await loadWorkspaceDiffFile('tws_deadbeef', 'a.ts')
    expect(provider.getTaskWorkspaceDiffFile).toHaveBeenCalledTimes(1)
    const entry = useReviewStore.getState().workspaces['tws_deadbeef'].details['a.ts']
    expect(entry.detail?.newText).toBe('n')

    provider.getTaskWorkspaceDiffFile.mockRejectedValue(new Error('boom'))
    await loadWorkspaceDiffFile('tws_deadbeef', 'missing.ts')
    const failed = useReviewStore.getState().workspaces['tws_deadbeef'].details['missing.ts']
    expect(failed.error).toBe('boom')
  })

  it('toggles expansion and view mode', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }]
    })
    await loadWorkspaceDiff('tws_deadbeef')
    toggleReviewFileExpanded('tws_deadbeef', 'a.ts')
    expect(useReviewStore.getState().workspaces['tws_deadbeef'].expandedPaths['a.ts']).toBe(false)
    setReviewViewMode('tws_deadbeef', 'split')
    expect(useReviewStore.getState().workspaces['tws_deadbeef'].viewMode).toBe('split')
  })

  it('invalidates every cached detail after a fresh capture reload', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }]
    })
    provider.getTaskWorkspaceDiffFile.mockResolvedValue({ path: 'a.ts', status: 'modified', binary: false, tooLarge: false })
    await loadWorkspaceDiff('tws_deadbeef')
    await loadWorkspaceDiffFile('tws_deadbeef', 'a.ts')
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'a.ts', status: 'modified', insertions: 2, deletions: 0, binary: false, tooLarge: false }]
    })
    await loadWorkspaceDiff('tws_deadbeef')
    const ws = useReviewStore.getState().workspaces['tws_deadbeef']
    expect(ws.details['a.ts']).toBeUndefined()
    expect(ws.expandedPaths['a.ts']).toBe(true)
  })

  it('defaults a file over 5000 changed lines to collapsed', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'huge.ts', status: 'modified', insertions: 4000, deletions: 1500, binary: false, tooLarge: false }]
    })
    await loadWorkspaceDiff('tws_deadbeef')
    expect(useReviewStore.getState().workspaces['tws_deadbeef'].expandedPaths['huge.ts']).toBe(false)
  })

  it('auto-refreshes the diff when the bound unit reports settled work', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [record({ unitId: 'w-9' })] })
    await ensureThreadBinding('thread-1')
    provider.getActivitySnapshot.mockResolvedValue({ cursor: 'c1', rows: [] })
    provider.pollActivity
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c2',
        changes: [{ unitId: 'other', row: { mainState: 'done' } as ActivityRow }]
      })
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c3',
        changes: [{ unitId: 'w-9', row: { mainState: 'working' } as ActivityRow }]
      })
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c4',
        changes: [{ unitId: 'w-9', row: { mainState: 'done', lastOutcome: 'completed' } as ActivityRow }]
      })
      .mockImplementation((_cursor, _wait, signal) => new Promise((_r, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
    provider.getTaskWorkspaceDiff.mockResolvedValue({ files: [] })
    watchReviewWorkspace('tws_deadbeef')
    await vi.waitFor(() => {
      expect(provider.getTaskWorkspaceDiff).toHaveBeenCalledTimes(1)
      expect(provider.getTaskWorkspaceDiff).toHaveBeenCalledWith('tws_deadbeef')
    })
    unwatchReviewWorkspace('tws_deadbeef')
    expect(provider.getTaskWorkspaceDiff).toHaveBeenCalledTimes(1)
  })

  it('skips the watch without an activity surface', async () => {
    provider.listTaskWorkspaces.mockResolvedValue({ records: [record()] })
    await ensureThreadBinding('thread-1')
    provider.getActivitySnapshot.mockResolvedValue(undefined)
    watchReviewWorkspace('tws_deadbeef')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(provider.pollActivity).not.toHaveBeenCalled()
    unwatchReviewWorkspace('tws_deadbeef')
  })

  it('ignores capture metadata and old outcomes while work is running', async () => {
    const row = (turnId: string, mainState: ActivityRow['mainState'], updatedAt: string) => ({
      unitId: 'worker', turnId, mainState, lastOutcome: 'completed', updatedAt
    } as ActivityRow)
    provider.getActivitySnapshot.mockResolvedValue({ cursor: 'c0', rows: [row('old', 'done', '0')] })
    const events = [
      row('old', 'done', 'capture-only'),
      row('new', 'working', 'started'),
      row('new', 'working', 'tool-output'),
      row('new', 'done', 'finished'),
      row('new', 'done', 'captured'),
      row('new', 'done', 'review-updated')
    ]
    for (const [index, event] of events.entries()) {
      provider.pollActivity.mockResolvedValueOnce({ type: 'activity', cursor: `c${index + 1}`,
        changes: [{ unitId: 'worker', row: event }] })
    }
    provider.pollActivity.mockImplementation((_cursor, _wait, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    provider.getTaskWorkspaceDiff.mockResolvedValue({ files: [] })
    provider.listReviewComments.mockResolvedValue({ comments: [], requests: [] })
    watchReviewWorkspace('tws_deadbeef', record({ unitId: 'worker' }))
    await vi.waitFor(() => expect(provider.pollActivity).toHaveBeenCalledTimes(events.length + 1))
    unwatchReviewWorkspace('tws_deadbeef')
    expect(provider.getTaskWorkspaceDiff).toHaveBeenCalledTimes(1)
  })

  it('watches an explicit workspace without a cached thread binding', async () => {
    provider.getActivitySnapshot.mockResolvedValue({ cursor: 'c1', rows: [] })
    provider.pollActivity
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c2',
        changes: [{ unitId: 'w-explicit', row: { mainState: 'done' } as ActivityRow }]
      })
      .mockImplementation((_cursor, _wait, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
    provider.getTaskWorkspaceDiff.mockResolvedValue({ files: [] })
    provider.listReviewComments.mockResolvedValue({ comments: [], requests: [] })
    watchReviewWorkspace('tws_deadbeef', record({ unitId: 'w-explicit' }))
    await vi.waitFor(() => expect(provider.getTaskWorkspaceDiff).toHaveBeenCalledWith('tws_deadbeef'))
    unwatchReviewWorkspace('tws_deadbeef')
    expect(useReviewStore.getState().bindings).toEqual({})
  })
})

const WS = 'tws_deadbeef'
const draftInput = {
  path: 'a.ts',
  side: 'new' as const,
  line: 3,
  anchor: { lineText: 'const x = 1', before: ['b'], after: ['a'] }
}

const syncedComment = (over: Record<string, unknown> = {}) => ({
  commentId: 'rvc_synced01',
  workspaceId: WS,
  ...draftInput,
  body: 'rename',
  state: 'draft',
  outdated: false,
  author: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over
})

describe('review comments', () => {
  it('creates a draft locally and syncs it on flush', async () => {
    provider.createReviewComment.mockResolvedValue({ comment: syncedComment({ body: 'rename this' }) })
    const id = createReviewDraft(WS, { ...draftInput, body: 'rename this' })
    expect(id).toMatch(/^local_/)
    expect(useReviewStore.getState().workspaces[WS].comments[0].state).toBe('draft')
    await flushReviewDrafts(WS)
    expect(provider.createReviewComment).toHaveBeenCalledWith(WS, expect.objectContaining({
      path: 'a.ts',
      side: 'new',
      line: 3
    }))
    const ws = useReviewStore.getState().workspaces[WS]
    expect(ws.comments[0].commentId).toBe('rvc_synced01')
    expect(ws.dirtyComments).toEqual({})
  })

  it('debounced edits patch the synced comment once', async () => {
    provider.listReviewComments.mockResolvedValue({ comments: [syncedComment()], requests: [] })
    await loadReviewComments(WS)
    updateReviewDraftBody(WS, 'rvc_synced01', 'first')
    updateReviewDraftBody(WS, 'rvc_synced01', 'final text')
    await flushReviewDrafts(WS)
    expect(provider.updateReviewComment).toHaveBeenCalledTimes(1)
    expect(provider.updateReviewComment).toHaveBeenCalledWith(WS, 'rvc_synced01', {
      body: 'final text',
      state: 'draft'
    })
  })

  it('keeps unsynced drafts across reloads and retries after reconnect', async () => {
    provider.createReviewComment.mockRejectedValueOnce(new Error('offline'))
    const id = createReviewDraft(WS, { ...draftInput, body: 'x' })
    await flushReviewDrafts(WS)
    expect(useReviewStore.getState().workspaces[WS].dirtyComments[id]).toBe('create')

    provider.listReviewComments.mockResolvedValue({ comments: [], requests: [] })
    await loadReviewComments(WS)
    // Unsynced local draft survives the server merge.
    expect(useReviewStore.getState().workspaces[WS].comments).toHaveLength(1)

    provider.createReviewComment.mockResolvedValueOnce({ comment: syncedComment({ body: 'x' }) })
    await flushReviewDrafts(WS)
    expect(provider.createReviewComment).toHaveBeenCalledTimes(2)
    expect(useReviewStore.getState().workspaces[WS].comments[0].commentId).toBe('rvc_synced01')
  })

  it('resolve marks synced comments and drops never-synced local drafts', async () => {
    provider.listReviewComments.mockResolvedValue({ comments: [syncedComment()], requests: [] })
    await loadReviewComments(WS)
    const localId = createReviewDraft(WS, { ...draftInput })
    resolveReviewComment(WS, localId)
    expect(useReviewStore.getState().workspaces[WS].comments.some((c) => c.commentId === localId))
      .toBe(false)

    resolveReviewComment(WS, 'rvc_synced01')
    await flushReviewDrafts(WS)
    expect(provider.updateReviewComment).toHaveBeenCalledWith(WS, 'rvc_synced01', {
      body: 'rename',
      state: 'resolved'
    })
  })

  it('sends all unresolved comments and records the round', async () => {
    provider.listReviewComments.mockResolvedValue({
      comments: [
        syncedComment(),
        syncedComment({ commentId: 'rvc_sent0001', state: 'sent' }),
        syncedComment({ commentId: 'rvc_done0001', state: 'resolved' })
      ],
      requests: []
    })
    await loadReviewComments(WS)
    provider.sendReview.mockResolvedValue({
      request: {
        requestId: 'rvq_1',
        round: 1,
        target: { kind: 'manager' },
        commentIds: ['rvc_synced01', 'rvc_sent0001'],
        sentAt: '2026-01-02T00:00:00Z'
      },
      composerContext: { kind: 'review_request', title: 'Review comments round 1', body: 'x' }
    })
    const response = await sendReviewBatch(WS, { kind: 'manager' }, 'handle these')
    expect(provider.sendReview).toHaveBeenCalledTimes(1)
    expect(provider.sendReview.mock.calls[0][0]).toBe(WS)
    expect(provider.sendReview.mock.calls[0][1]).toEqual({
      commentIds: ['rvc_synced01', 'rvc_sent0001'],
      target: { kind: 'manager' },
      clientRequestId: expect.any(String),
      note: 'handle these'
    })
    expect(response?.request.round).toBe(1)
    const ws = useReviewStore.getState().workspaces[WS]
    expect(ws.comments.find((c) => c.commentId === 'rvc_synced01')?.state).toBe('sent')
    expect(ws.comments.find((c) => c.commentId === 'rvc_done0001')?.state).toBe('resolved')
    expect(ws.lastSent).toMatchObject({ round: 1, targetKind: 'manager' })
    expect(ws.requests).toHaveLength(1)
  })

  it('deduplicates a double click and retains the submission identity after an uncertain failure', async () => {
    provider.listReviewComments.mockResolvedValue({ comments: [syncedComment()], requests: [] })
    await loadReviewComments(WS)
    provider.sendReview.mockRejectedValueOnce(new Error('connection lost'))
    const first = sendReviewBatch(WS, { kind: 'worker', workerId: 'w1' }, 'retry safely')
    const duplicate = sendReviewBatch(WS, { kind: 'worker', workerId: 'w1' }, 'retry safely')
    expect(first).toBe(duplicate)
    await Promise.all([first, duplicate])
    const original = provider.sendReview.mock.calls[0][1].clientRequestId
    provider.sendReview.mockResolvedValueOnce({ request: {
      requestId: 'rvq_retry', round: 1, target: { kind: 'worker', workerId: 'w1' },
      commentIds: ['rvc_synced01'], sentAt: '2026-01-02T00:00:00Z'
    } })
    await sendReviewBatch(WS, { kind: 'worker', workerId: 'w1' }, 'retry safely')
    expect(provider.sendReview).toHaveBeenCalledTimes(2)
    expect(provider.sendReview.mock.calls[1][1].clientRequestId).toBe(original)
  })

  it('reports send errors on the workspace', async () => {
    provider.listReviewComments.mockResolvedValue({ comments: [syncedComment()], requests: [] })
    await loadReviewComments(WS)
    provider.sendReview.mockRejectedValue(new Error('worker under user control'))
    const response = await sendReviewBatch(WS, { kind: 'worker', workerId: 'w1' })
    expect(response).toBeNull()
    expect(useReviewStore.getState().workspaces[WS].sendError).toBe('worker under user control')
    expect(pendingReviewComments(WS)).toHaveLength(1)
  })
})
