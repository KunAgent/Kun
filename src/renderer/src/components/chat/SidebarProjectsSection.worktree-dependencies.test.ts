import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import {
  sidebarThreadWorkspaceIdentityKey,
  sidebarWorktreeDiscoveryKey
} from './SidebarProjectsSection'

describe('SidebarProjectsSection worktree dependencies', () => {
  it('ignores activity-only thread changes but reacts to workspace changes', () => {
    const original = {
      id: 'thread-1',
      title: 'Thread',
      workspace: '/Users/zxy/project-a',
      model: 'reasonix',
      mode: 'agent',
      status: 'running',
      latestSeq: 10,
      updatedAt: '2026-08-21T00:00:00.000Z'
    } satisfies NormalizedThread
    const activityUpdate = {
      ...original,
      status: 'idle',
      latestSeq: 11,
      updatedAt: '2026-08-22T00:00:00.000Z'
    } satisfies NormalizedThread
    const workspaceUpdate = { ...activityUpdate, workspace: '/Users/zxy/project-b' }

    expect(sidebarThreadWorkspaceIdentityKey([activityUpdate]))
      .toBe(sidebarThreadWorkspaceIdentityKey([original]))
    expect(sidebarWorktreeDiscoveryKey(
      [activityUpdate], '/Users/zxy/project-a', ['/Users/zxy/project-a']
    )).toBe(sidebarWorktreeDiscoveryKey(
      [original], '/Users/zxy/project-a', ['/Users/zxy/project-a']
    ))
    expect(sidebarThreadWorkspaceIdentityKey([workspaceUpdate]))
      .not.toBe(sidebarThreadWorkspaceIdentityKey([original]))
  })
})
