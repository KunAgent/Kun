import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'

const provider = {
  listTaskWorkspaces: vi.fn(),
  getTaskWorkspaceDiff: vi.fn(),
  getTaskWorkspaceDiffFile: vi.fn()
}

vi.mock('../agent/registry', () => ({
  getProvider: () => provider
}))

import {
  ensureThreadBinding,
  loadWorkspaceDiff,
  loadWorkspaceDiffFile,
  setReviewViewMode,
  toggleReviewFileExpanded,
  useReviewStore
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

  it('drops cached details for files that disappear on reload', async () => {
    provider.getTaskWorkspaceDiff.mockResolvedValue({
      files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }]
    })
    provider.getTaskWorkspaceDiffFile.mockResolvedValue({ path: 'a.ts', status: 'modified', binary: false, tooLarge: false })
    await loadWorkspaceDiff('tws_deadbeef')
    await loadWorkspaceDiffFile('tws_deadbeef', 'a.ts')
    provider.getTaskWorkspaceDiff.mockResolvedValue({ files: [] })
    await loadWorkspaceDiff('tws_deadbeef')
    expect(useReviewStore.getState().workspaces['tws_deadbeef'].details['a.ts']).toBeUndefined()
  })
})
