import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  combineWriteResourceActivities,
  writeActivityForThreadIds,
  writeDirectoryActivity,
  writeFileActivity,
  writeWorkspaceActivity,
  type WriteResourceActivityContext
} from './write-resource-activity'
import { emptyWriteThreadRegistry, markWriteThread } from './write-thread-registry'

function thread(id: string, status: NormalizedThread['status'] = 'idle', archived = false): NormalizedThread {
  return {
    id,
    title: id,
    workspace: '/workspace',
    updatedAt: '2026-09-20T00:00:00.000Z',
    model: 'test-model',
    mode: 'agent',
    status,
    archived
  }
}

function context(overrides: Partial<WriteResourceActivityContext> = {}): WriteResourceActivityContext {
  return {
    threads: [],
    activeThreadId: null,
    busy: false,
    watchTurnCompletion: {},
    awaitingUserInputThreadIds: {},
    unreadThreadIds: {},
    ...overrides
  }
}

describe('write resource activity', () => {
  it('uses the shared attention priority across multiple conversations', () => {
    const activity = writeActivityForThreadIds(['unread', 'failed', 'running', 'input'], context({
      threads: [thread('unread'), thread('failed'), thread('running', 'running'), thread('input')],
      unreadThreadIds: { unread: 'completed', failed: 'failed' },
      awaitingUserInputThreadIds: { input: true }
    }))

    expect(activity).toEqual({ activity: 'awaiting-input', count: 4 })
    expect(combineWriteResourceActivities([
      { activity: 'unread', count: 1 },
      { activity: 'failed', count: 2 }
    ])).toEqual({ activity: 'failed', count: 3 })
  })

  it('retains unread attention when thread metadata is missing and ignores archived threads', () => {
    expect(writeActivityForThreadIds(['missing'], context({
      unreadThreadIds: { missing: 'completed' }
    }))).toEqual({ activity: 'unread', count: 1 })
    expect(writeActivityForThreadIds(['archived'], context({
      threads: [thread('archived', 'idle', true)],
      unreadThreadIds: { archived: 'failed' }
    }))).toEqual({ activity: 'idle', count: 0 })
  })

  it('aggregates file, directory and workspace bindings', () => {
    let registry = markWriteThread('/workspace', 'a', emptyWriteThreadRegistry(), '/workspace/docs/a.md')
    registry = markWriteThread('/workspace', 'b', registry, '/workspace/docs/nested/b.md')
    registry = markWriteThread('/workspace', 'c', registry, '/workspace/c.md')
    const state = context({
      threads: [thread('a'), thread('b'), thread('c')],
      unreadThreadIds: { a: 'completed', b: 'failed' }
    })

    expect(writeFileActivity('/workspace', '/workspace/docs/a.md', state, registry).activity).toBe('unread')
    expect(writeDirectoryActivity('/workspace', '/workspace/docs', state, registry))
      .toEqual({ activity: 'failed', count: 2 })
    expect(writeWorkspaceActivity('/workspace', state, registry))
      .toEqual({ activity: 'failed', count: 2 })
  })
})
