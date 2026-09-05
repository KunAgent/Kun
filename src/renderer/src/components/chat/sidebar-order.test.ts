import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_ORDER_STORAGE_KEY,
  normalizeSidebarOrderRegistry,
  readSidebarOrderRegistry,
  reconcileSidebarThreadOrder,
  reconcileSidebarWorkspaceOrder,
  reorderSidebarThreadIds,
  reorderSidebarWorkspacePaths,
  saveSidebarOrderRegistry,
  setSidebarThreadOrder,
  setSidebarWorkspaceOrder,
  sidebarDropPosition
} from './sidebar-order'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sidebar order registry', () => {
  it('falls back to an empty registry for malformed or unsupported storage', () => {
    const storage = createMemoryStorage()
    storage.setItem(SIDEBAR_ORDER_STORAGE_KEY, '{not-json')
    vi.stubGlobal('localStorage', storage)

    expect(readSidebarOrderRegistry()).toEqual({
      version: 1,
      workspacePaths: [],
      threadIdsByScope: {}
    })
    expect(normalizeSidebarOrderRegistry({ version: 2, workspacePaths: ['/tmp/a'] })).toEqual({
      version: 1,
      workspacePaths: [],
      threadIdsByScope: {}
    })
  })

  it('persists compact workspace and per-scope thread orders', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const withWorkspaces = setSidebarWorkspaceOrder(readSidebarOrderRegistry(), [
      '/Users/zxy/project-a/',
      '/Users/zxy/project-a',
      '/Users/zxy/project-b'
    ])
    const registry = setSidebarThreadOrder(withWorkspaces, '/Users/zxy/project-a', [
      'thread-b',
      'thread-b',
      'thread-a'
    ])

    saveSidebarOrderRegistry(registry)

    expect(readSidebarOrderRegistry()).toEqual({
      version: 1,
      workspacePaths: ['/Users/zxy/project-a', '/Users/zxy/project-b'],
      threadIdsByScope: {
        '/users/zxy/project-a': ['thread-b', 'thread-a']
      }
    })
  })
})

describe('sidebar order reconciliation', () => {
  it('keeps saved workspaces first, drops missing entries, and appends new entries', () => {
    expect(reconcileSidebarWorkspaceOrder(
      ['/Users/zxy/project-a', '/Users/zxy/project-c', '/Users/zxy/project-b'],
      ['/Users/zxy/missing', '/Users/zxy/project-b', '/Users/zxy/project-a']
    )).toEqual(['/Users/zxy/project-b', '/Users/zxy/project-a', '/Users/zxy/project-c'])
  })

  it('keeps saved threads first and inserts unsaved threads beside their nearest neighbor', () => {
    const threads = [{ id: 'new' }, { id: 'saved-a' }, { id: 'saved-b' }]

    expect(reconcileSidebarThreadOrder(threads, ['removed', 'saved-b', 'saved-a']))
      .toEqual([{ id: 'saved-b' }, { id: 'new' }, { id: 'saved-a' }])
  })

  it('inserts a freshly created thread at the top beside saved older threads', () => {
    const threads = [
      { id: 'new' },
      { id: 'heatmap' },
      { id: 'old-1' },
      { id: 'old-2' },
      { id: 'old-3' },
      { id: 'old-4' }
    ]

    expect(reconcileSidebarThreadOrder(threads, ['old-1', 'old-2', 'old-3', 'old-4']))
      .toEqual([
        { id: 'new' },
        { id: 'heatmap' },
        { id: 'old-1' },
        { id: 'old-2' },
        { id: 'old-3' },
        { id: 'old-4' }
      ])
  })
})

describe('sidebar item moves', () => {
  it('moves workspaces before and after a target', () => {
    expect(reorderSidebarWorkspacePaths({
      workspacePaths: ['/Users/zxy/a', '/Users/zxy/b', '/Users/zxy/c'],
      sourcePath: '/Users/zxy/c',
      targetPath: '/Users/zxy/a',
      position: 'before'
    })).toEqual(['/Users/zxy/c', '/Users/zxy/a', '/Users/zxy/b'])

    expect(reorderSidebarWorkspacePaths({
      workspacePaths: ['/Users/zxy/a', '/Users/zxy/b', '/Users/zxy/c'],
      sourcePath: '/Users/zxy/a',
      targetPath: '/Users/zxy/b',
      position: 'after'
    })).toEqual(['/Users/zxy/b', '/Users/zxy/a', '/Users/zxy/c'])
  })

  it('moves visible threads without disturbing hidden entries', () => {
    expect(reorderSidebarThreadIds({
      threadIds: ['visible-a', 'hidden', 'visible-b', 'tail'],
      sourceId: 'visible-b',
      targetId: 'visible-a',
      position: 'before'
    })).toEqual(['visible-b', 'visible-a', 'hidden', 'tail'])
  })

  it('chooses insertion position from the target midpoint', () => {
    expect(sidebarDropPosition(109, 100, 20)).toBe('before')
    expect(sidebarDropPosition(110, 100, 20)).toBe('after')
  })
})
