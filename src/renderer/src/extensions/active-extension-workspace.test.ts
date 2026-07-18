import { describe, expect, it } from 'vitest'
import { resolveActiveExtensionWorkspaceRoot } from './active-extension-workspace'
import { isExtensionContributionSnapshotReady } from './use-contributions'

describe('resolveActiveExtensionWorkspaceRoot', () => {
  const threads = [
    { id: 'thread-a', workspace: '/workspace/conversation-a' },
    { id: 'thread-b', workspace: '  /workspace/conversation-b  ' }
  ]

  it('uses the active Agent thread workspace ahead of the selected project', () => {
    expect(resolveActiveExtensionWorkspaceRoot('thread-a', threads, '/workspace/project')).toBe(
      '/workspace/conversation-a'
    )
  })

  it('normalizes surrounding whitespace and falls back before a thread exists', () => {
    expect(resolveActiveExtensionWorkspaceRoot('thread-b', threads, '/workspace/project')).toBe(
      '/workspace/conversation-b'
    )
    expect(resolveActiveExtensionWorkspaceRoot(null, threads, '  /workspace/project  ')).toBe(
      '/workspace/project'
    )
    expect(resolveActiveExtensionWorkspaceRoot('missing', threads, '/workspace/project')).toBe(
      '/workspace/project'
    )
  })

  it('keeps contributions hidden until the active workspace snapshot is ready', () => {
    expect(isExtensionContributionSnapshotReady({
      status: 'ready',
      workspaceRoot: '/workspace-a',
      locale: 'en'
    }, '/workspace-b', 'en')).toBe(false)
    expect(isExtensionContributionSnapshotReady({
      status: 'loading',
      workspaceRoot: '/workspace-b',
      locale: 'en'
    }, '/workspace-b', 'en')).toBe(false)
    expect(isExtensionContributionSnapshotReady({
      status: 'ready',
      workspaceRoot: '/workspace-b',
      locale: 'zh-CN'
    }, '/workspace-b', 'en')).toBe(false)
    expect(isExtensionContributionSnapshotReady({
      status: 'ready',
      workspaceRoot: '/workspace-b',
      locale: 'en'
    }, '/workspace-b', 'en')).toBe(true)
  })
})
