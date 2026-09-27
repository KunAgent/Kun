import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import {
  clearThreadWorkspacePrep,
  markThreadWorkspacePreparing,
  markThreadWorkspacePrepFailed,
  receiveTaskWorkspaceRecord,
  receiveTaskWorkspaceThreadEvent,
  threadWorkspacePreparing,
  useTaskWorkspaceStore
} from './task-workspace-store'

function record(state: TaskWorkspaceRecord['state']): TaskWorkspaceRecord {
  return {
    workspaceId: 'ws_1',
    ownerThreadId: 'thr_1',
    sourceRoot: '/repo',
    isolation: 'worktree',
    state,
    ...(state === 'ready' ? { path: '/repo/.kun-worktrees/t' } : {}),
    ...(state === 'failed' ? { lastError: 'boom' } : {})
  } as TaskWorkspaceRecord
}

beforeEach(() => {
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})

describe('task workspace prep tracking', () => {
  it('marks a thread preparing until the ready event lands', () => {
    markThreadWorkspacePreparing('thr_1', '')
    expect(threadWorkspacePreparing('thr_1')).toBe(true)
    receiveTaskWorkspaceThreadEvent({
      threadId: 'thr_1',
      workspaceId: 'ws_1',
      state: 'setting-up',
      progress: { message: 'fetching' }
    })
    expect(threadWorkspacePreparing('thr_1')).toBe(true)
    receiveTaskWorkspaceThreadEvent({
      threadId: 'thr_1',
      workspaceId: 'ws_1',
      state: 'ready',
      workspace: { path: '/repo/.kun-worktrees/t' }
    })
    expect(threadWorkspacePreparing('thr_1')).toBe(false)
    expect(useTaskWorkspaceStore.getState().prepByThread['thr_1']?.path).toBe(
      '/repo/.kun-worktrees/t'
    )
  })

  it('carries the failed state + error for the retry affordance', () => {
    markThreadWorkspacePreparing('thr_1', '')
    markThreadWorkspacePrepFailed('thr_1', 'git failed')
    expect(threadWorkspacePreparing('thr_1')).toBe(false)
    const entry = useTaskWorkspaceStore.getState().prepByThread['thr_1']
    expect(entry?.state).toBe('failed')
    expect(entry?.error).toBe('git failed')
  })

  it('ignores stale events for a superseded workspace once finished', () => {
    receiveTaskWorkspaceRecord(record('ready'))
    receiveTaskWorkspaceThreadEvent({
      threadId: 'thr_1',
      workspaceId: 'ws_stale',
      state: 'creating'
    })
    expect(useTaskWorkspaceStore.getState().prepByThread['thr_1']?.workspaceId).toBe('ws_1')
  })

  it('clears prep state on demand', () => {
    markThreadWorkspacePreparing('thr_1', '')
    clearThreadWorkspacePrep('thr_1')
    expect(threadWorkspacePreparing('thr_1')).toBe(false)
  })

  it('treats unrelated threads as not preparing', () => {
    expect(threadWorkspacePreparing(null)).toBe(false)
    expect(threadWorkspacePreparing('thr_other')).toBe(false)
  })
})
