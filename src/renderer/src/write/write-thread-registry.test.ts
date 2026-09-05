import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  MAX_WRITE_THREAD_IDS_PER_RESOURCE,
  MAX_WRITE_THREAD_IDS_PER_WORKSPACE,
  MAX_WRITE_THREAD_REGISTRY_WORKSPACES,
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  emptyWriteThreadRegistry,
  forgetWriteFileThreads,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  moveWriteFileThreads,
  normalizeWriteThreadRegistry,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeThreadIdsForFile,
  writeWorkspaceForThreadId
} from './write-thread-registry'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, workspace: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-05-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    workspace
  }
}

describe('write-thread-registry', () => {
  it('saves and restores write thread records by workspace', () => {
    const storage = new MemoryStorage()
    const registry = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    saveWriteThreadRegistry(registry, storage)

    const restored = readWriteThreadRegistry(storage)
    expect(isWriteThreadId('thread-1', restored)).toBe(true)
    expect(activeWriteThreadForWorkspace('/Users/zxy/workspace', [thread('thread-1', '/Users/zxy/workspace')], restored)?.id).toBe('thread-1')
  })

  it('migrates the former single file binding into one history entry', () => {
    const registry = normalizeWriteThreadRegistry({
      version: 1,
      workspaces: {
        '/Users/zxy/workspace': {
          activeThreadId: 'thread-1',
          threadIds: ['thread-1'],
          fileThreadIds: { '/Users/zxy/workspace/draft.md': 'thread-1' }
        }
      }
    })

    expect(writeThreadIdsForFile(
      '/Users/zxy/workspace',
      '/Users/zxy/workspace/draft.md',
      registry
    )).toEqual(['thread-1'])
  })

  it('keeps the newest marked write thread active', () => {
    const first = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    const second = markWriteThread('/Users/zxy/workspace', 'thread-2', first)

    expect(second.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-2')
    expect(second.workspaces['/Users/zxy/workspace'].threadIds).toEqual(['thread-2', 'thread-1'])
  })

  it('keeps independent conversations for files in the same workspace', () => {
    const workspace = '/Users/zxy/workspace'
    const first = markWriteThread(
      workspace,
      'thread-a',
      emptyWriteThreadRegistry(),
      `${workspace}/draft-a.md`
    )
    const registry = markWriteThread(
      workspace,
      'thread-b',
      first,
      `${workspace}/draft-b.md`
    )
    const threads = [
      thread('thread-a', workspace),
      thread('thread-b', workspace)
    ]

    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/draft-a.md`
    )?.id).toBe('thread-a')
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/draft-b.md`
    )?.id).toBe('thread-b')
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/new-file.md`
    )).toBeNull()
  })

  it('keeps ordered conversation history for one file and promotes the next thread on delete', () => {
    const workspace = '/Users/zxy/workspace'
    const filePath = `${workspace}/draft.md`
    let registry = emptyWriteThreadRegistry()
    registry = markWriteThread(workspace, 'thread-1', registry, filePath)
    registry = markWriteThread(workspace, 'thread-2', registry, filePath)
    registry = markWriteThread(workspace, 'thread-3', registry, filePath)

    expect(writeThreadIdsForFile(workspace, filePath, registry)).toEqual([
      'thread-3',
      'thread-2',
      'thread-1'
    ])

    const deleted = forgetWriteThread('thread-3', registry)
    expect(writeThreadIdsForFile(workspace, filePath, deleted)).toEqual(['thread-2', 'thread-1'])
    expect(deleted.workspaces[workspace].fileThreadIds[filePath]).toBe('thread-2')
  })

  it('caps one file history without reducing the workspace-wide history cap', () => {
    const workspace = '/Users/zxy/workspace'
    const filePath = `${workspace}/draft.md`
    let registry = emptyWriteThreadRegistry()
    for (let index = 0; index < MAX_WRITE_THREAD_IDS_PER_RESOURCE + 3; index += 1) {
      registry = markWriteThread(workspace, `thread-${index}`, registry, filePath)
    }

    const ids = writeThreadIdsForFile(workspace, filePath, registry)
    expect(ids).toHaveLength(MAX_WRITE_THREAD_IDS_PER_RESOURCE)
    expect(ids[0]).toBe(`thread-${MAX_WRITE_THREAD_IDS_PER_RESOURCE + 2}`)
    expect(ids).not.toContain('thread-0')
    expect(registry.workspaces[workspace].threadIds)
      .toHaveLength(MAX_WRITE_THREAD_IDS_PER_RESOURCE + 3)
  })

  it('does not assign a legacy workspace conversation to an arbitrary file', () => {
    const workspace = '/Users/zxy/workspace'
    const registry = markWriteThread(workspace, 'legacy-thread', emptyWriteThreadRegistry())
    const threads = [thread('legacy-thread', workspace)]

    expect(activeWriteThreadForWorkspace(workspace, threads, registry)?.id).toBe('legacy-thread')
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/draft.md`
    )).toBeNull()
  })

  it('keeps case-sensitive POSIX file paths separate', () => {
    const workspace = '/Users/zxy/workspace'
    const registry = markWriteThread(
      workspace,
      'thread-lower',
      markWriteThread(
        workspace,
        'thread-upper',
        emptyWriteThreadRegistry(),
        `${workspace}/Foo.md`
      ),
      `${workspace}/foo.md`
    )
    const threads = [
      thread('thread-upper', workspace),
      thread('thread-lower', workspace)
    ]

    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/Foo.md`
    )?.id).toBe('thread-upper')
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      registry,
      `${workspace}/foo.md`
    )?.id).toBe('thread-lower')
  })

  it('moves directory mappings on rename and removes them on delete', () => {
    const workspace = '/Users/zxy/workspace'
    const original = markWriteThread(
      workspace,
      'thread-a',
      emptyWriteThreadRegistry(),
      `${workspace}/drafts/chapter.md`
    )
    const moved = moveWriteFileThreads(
      workspace,
      `${workspace}/drafts`,
      `${workspace}/archive`,
      original
    )
    const threads = [thread('thread-a', workspace)]

    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      moved,
      `${workspace}/archive/chapter.md`
    )?.id).toBe('thread-a')
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      moved,
      `${workspace}/drafts/chapter.md`
    )).toBeNull()

    const removed = forgetWriteFileThreads(workspace, `${workspace}/archive`, moved)
    expect(activeWriteThreadForWorkspace(
      workspace,
      threads,
      removed,
      `${workspace}/archive/chapter.md`
    )).toBeNull()
    expect(isWriteThreadId('thread-a', removed)).toBe(true)
  })

  it('caps remembered write thread ids per workspace', () => {
    let registry = emptyWriteThreadRegistry()
    for (let index = 0; index < MAX_WRITE_THREAD_IDS_PER_WORKSPACE + 5; index += 1) {
      registry = markWriteThread('/Users/zxy/write', `thread-${index}`, registry)
    }

    const record = registry.workspaces['/Users/zxy/write']
    expect(record.activeThreadId).toBe(`thread-${MAX_WRITE_THREAD_IDS_PER_WORKSPACE + 4}`)
    expect(record.threadIds).toHaveLength(MAX_WRITE_THREAD_IDS_PER_WORKSPACE)
    expect(record.threadIds).not.toContain('thread-0')
    expect(record.threadIds).not.toContain('thread-4')
    expect(record.threadIds).toContain('thread-5')
  })

  it('caps remembered write workspaces while keeping recently marked workspaces', () => {
    let registry = emptyWriteThreadRegistry()
    for (let index = 0; index < MAX_WRITE_THREAD_REGISTRY_WORKSPACES; index += 1) {
      registry = markWriteThread(`/Users/zxy/write-${index}`, `thread-${index}`, registry)
    }

    registry = markWriteThread('/Users/zxy/write-0', 'thread-refreshed', registry)
    registry = markWriteThread(
      `/Users/zxy/write-${MAX_WRITE_THREAD_REGISTRY_WORKSPACES}`,
      'thread-new',
      registry
    )

    expect(Object.keys(registry.workspaces)).toHaveLength(MAX_WRITE_THREAD_REGISTRY_WORKSPACES)
    expect(registry.workspaces['/Users/zxy/write-1']).toBeUndefined()
    expect(registry.workspaces['/Users/zxy/write-0']?.activeThreadId).toBe('thread-refreshed')
    expect(registry.workspaces[`/Users/zxy/write-${MAX_WRITE_THREAD_REGISTRY_WORKSPACES}`]?.activeThreadId).toBe(
      'thread-new'
    )
  })

  it('preserves associations across partial runtime pages and forgets explicitly deleted threads', () => {
    const workspace = '/Users/zxy/workspace'
    const registry = markWriteThread(
      workspace,
      'thread-2',
      markWriteThread(workspace, 'thread-1', emptyWriteThreadRegistry(), `${workspace}/a.md`),
      `${workspace}/b.md`
    )
    const pruned = pruneWriteThreadRegistry([thread('thread-1', '/Users/zxy/workspace')], registry)

    expect(isWriteThreadId('thread-2', pruned)).toBe(true)
    expect(pruned.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-2')
    expect(pruned.workspaces[workspace].fileThreadIds).toEqual({
      '/Users/zxy/workspace/a.md': 'thread-1',
      '/Users/zxy/workspace/b.md': 'thread-2'
    })
    const withoutThread2 = forgetWriteThread('thread-2', pruned)
    expect(withoutThread2.workspaces[workspace].fileThreadIds)
      .toEqual({ '/Users/zxy/workspace/a.md': 'thread-1' })
    expect(forgetWriteThread('thread-1', withoutThread2).workspaces[workspace]).toBeUndefined()
  })

  it('hydrates leaked write assistant threads from configured write workspaces', () => {
    const leaked = {
      ...thread('write-thread', '/Users/zxy/.deepseekgui/write_workspace'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }
    const normalCodeThread = {
      ...thread('code-thread', '/Users/zxy/.deepseekgui/write_workspace'),
      title: 'Explain this project'
    }
    const sameTitleElsewhere = {
      ...thread('elsewhere', '/Users/zxy/code/project'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }

    const registry = hydrateWriteThreadRegistry(
      [leaked, normalCodeThread, sameTitleElsewhere],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('write-thread', registry)).toBe(true)
    expect(isWriteThreadId('code-thread', registry)).toBe(false)
    expect(isWriteThreadId('elsewhere', registry)).toBe(false)
  })

  it('uses explicit surface metadata before legacy title inference', () => {
    const workspace = '/Users/zxy/.deepseekgui/write_workspace'
    const registry = hydrateWriteThreadRegistry(
      [
        {
          ...thread('owned-write', '/Users/zxy/code/project'),
          title: 'Renamed by the user',
          agentSurface: 'write'
        },
        {
          ...thread('title-collision', workspace),
          title: WRITE_ASSISTANT_THREAD_TITLE,
          agentSurface: 'code'
        }
      ],
      [workspace],
      markWriteThread(workspace, 'title-collision', emptyWriteThreadRegistry())
    )

    expect(isWriteThreadId('owned-write', registry)).toBe(true)
    expect(isWriteThreadId('title-collision', registry)).toBe(false)
  })

  it('hydrates legacy tilde write assistant threads under the configured absolute workspace', () => {
    const legacyThread = {
      ...thread('legacy-write-thread', '~/.deepseekgui/write_workspace'),
      title: WRITE_ASSISTANT_THREAD_TITLE
    }

    const registry = hydrateWriteThreadRegistry(
      [legacyThread],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('legacy-write-thread', registry)).toBe(true)
    expect(registry.workspaces['/Users/zxy/.deepseekgui/write_workspace'].threadIds).toEqual([
      'legacy-write-thread'
    ])
    expect(
      activeWriteThreadForWorkspace(
        '/Users/zxy/.deepseekgui/write_workspace',
        [legacyThread],
        registry
      )?.id
    ).toBe('legacy-write-thread')
  })

  it('hydrates Reasonix write-context threads even when the session list reports the default workspace', () => {
    const leaked = {
      ...thread('reasonix-write-thread', '/Users/zxy/.deepseekgui/default_workspace'),
      title: '[写作上下文] 交互限制：当前 GUI 无法提交 request_user_input'
    }

    const registry = hydrateWriteThreadRegistry(
      [leaked],
      ['/Users/zxy/.deepseekgui/write_workspace'],
      emptyWriteThreadRegistry()
    )

    expect(isWriteThreadId('reasonix-write-thread', registry)).toBe(true)
    expect(writeWorkspaceForThreadId('reasonix-write-thread', registry)).toBe('/Users/zxy/.deepseekgui/write_workspace')
    expect(
      activeWriteThreadForWorkspace(
        '/Users/zxy/.deepseekgui/write_workspace',
        [leaked],
        registry
      )?.id
    ).toBe('reasonix-write-thread')
  })

  it('preserves the active write thread while adding newly inferred thread ids', () => {
    const existing = markWriteThread('/Users/zxy/write', 'existing-thread', emptyWriteThreadRegistry())
    const registry = hydrateWriteThreadRegistry(
      [
        {
          ...thread('newer-thread', '/Users/zxy/write'),
          title: WRITE_ASSISTANT_THREAD_TITLE,
          updatedAt: '2026-05-25T00:00:00.000Z'
        }
      ],
      ['/Users/zxy/write'],
      existing
    )

    expect(registry.workspaces['/Users/zxy/write'].activeThreadId).toBe('existing-thread')
    expect(registry.workspaces['/Users/zxy/write'].threadIds).toEqual([
      'existing-thread',
      'newer-thread'
    ])
  })

  it('does not reopen archived write threads as active workspace conversations', () => {
    const registry = markWriteThread('/Users/zxy/write', 'archived-thread', emptyWriteThreadRegistry())
    const archivedThread = {
      ...thread('archived-thread', '/Users/zxy/write'),
      archived: true
    }

    expect(activeWriteThreadForWorkspace('/Users/zxy/write', [archivedThread], registry)).toBeNull()
  })
})
