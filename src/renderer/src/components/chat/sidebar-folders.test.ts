import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_FOLDERS_STORAGE_KEY,
  createSidebarFolder,
  deleteSidebarFolder,
  emptySidebarFolderRegistry,
  moveThreadToSidebarFolder,
  normalizeSidebarFolderRegistry,
  readSidebarFolderRegistry,
  removeSidebarThreadAssignments,
  renameSidebarFolder,
  saveSidebarFolderRegistry,
  sidebarFolderDescendantThreadIds,
  sidebarFolderIdForThread,
  sidebarFolderNameExists,
  sidebarFolderThreadCount,
  sidebarFoldersForWorkspace
} from './sidebar-folders'

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

describe('sidebar virtual folder registry', () => {
  it('falls back safely and removes duplicate folder and thread assignments', () => {
    expect(normalizeSidebarFolderRegistry({ version: 2 })).toEqual(emptySidebarFolderRegistry())
    expect(normalizeSidebarFolderRegistry({
      version: 1,
      foldersByScope: {
        '/tmp/app': [
          { id: 'one', name: 'One', threadIds: ['thread-a', 'thread-a'] },
          { id: 'two', name: 'Two', threadIds: ['thread-a', 'thread-b'] },
          { id: 'two', name: 'Duplicate id', threadIds: ['thread-c'] },
          { id: '', name: 'Missing id', threadIds: [] }
        ]
      }
    })).toEqual({
      version: 1,
      foldersByScope: {
        '/tmp/app': [
          { id: 'one', name: 'One', parentId: null, threadIds: ['thread-a'] },
          { id: 'two', name: 'Two', parentId: null, threadIds: ['thread-b'] }
        ]
      }
    })
  })

  it('persists folders by normalized workspace scope', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const registry = createSidebarFolder(
      readSidebarFolderRegistry(),
      '/Users/zxy/project-a/',
      { id: 'folder-one', name: 'Research' }
    )

    saveSidebarFolderRegistry(registry)

    expect(storage.getItem(SIDEBAR_FOLDERS_STORAGE_KEY)).toBeTruthy()
    expect(sidebarFoldersForWorkspace(readSidebarFolderRegistry(), '/Users/zxy/project-a')).toEqual([
      { id: 'folder-one', name: 'Research', parentId: null, threadIds: [] }
    ])
  })

  it('creates, renames, and deletes folders without deleting their threads', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'folder-one', name: 'Research' }
    )
    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-a', 'folder-one')
    registry = renameSidebarFolder(registry, '/tmp/app', 'folder-one', 'References')

    expect(sidebarFoldersForWorkspace(registry, '/tmp/app')).toEqual([
      { id: 'folder-one', name: 'References', parentId: null, threadIds: ['thread-a'] }
    ])

    registry = deleteSidebarFolder(registry, '/tmp/app', 'folder-one')
    expect(sidebarFoldersForWorkspace(registry, '/tmp/app')).toEqual([])
    expect(sidebarFolderIdForThread(sidebarFoldersForWorkspace(registry, '/tmp/app'), 'thread-a')).toBeNull()
  })

  it('keeps names unique within a workspace', () => {
    const registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'folder-one', name: 'Research' }
    )
    const duplicate = createSidebarFolder(
      registry,
      '/tmp/app',
      { id: 'folder-two', name: 'research' }
    )

    expect(sidebarFoldersForWorkspace(duplicate, '/tmp/app')).toHaveLength(1)
    expect(sidebarFolderNameExists(
      sidebarFoldersForWorkspace(duplicate, '/tmp/app'),
      'RESEARCH'
    )).toBe(true)
  })

  it('moves a thread between folders, around a target, and back to the project root', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'folder-one', name: 'One' }
    )
    registry = createSidebarFolder(registry, '/tmp/app', { id: 'folder-two', name: 'Two' })
    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-a', 'folder-one')
    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-b', 'folder-two')
    registry = moveThreadToSidebarFolder(
      registry,
      '/tmp/app',
      'thread-a',
      'folder-two',
      'thread-b',
      'before'
    )

    expect(sidebarFoldersForWorkspace(registry, '/tmp/app')).toEqual([
      { id: 'folder-one', name: 'One', parentId: null, threadIds: [] },
      { id: 'folder-two', name: 'Two', parentId: null, threadIds: ['thread-a', 'thread-b'] }
    ])

    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-a', null)
    expect(sidebarFolderIdForThread(
      sidebarFoldersForWorkspace(registry, '/tmp/app'),
      'thread-a'
    )).toBeNull()
  })

  it('reorders from the currently displayed folder order after an attention promotion', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'folder', name: 'Folder' }
    )
    for (const threadId of ['thread-a', 'thread-b', 'thread-c']) {
      registry = moveThreadToSidebarFolder(registry, '/tmp/app', threadId, 'folder')
    }
    registry = moveThreadToSidebarFolder(
      registry,
      '/tmp/app',
      'thread-a',
      'folder',
      'thread-b',
      'after',
      ['thread-c', 'thread-a', 'thread-b']
    )

    expect(sidebarFoldersForWorkspace(registry, '/tmp/app')[0]?.threadIds).toEqual([
      'thread-c',
      'thread-b',
      'thread-a'
    ])
  })

  it('creates nested folders with sibling-scoped names and promotes children when deleting a parent', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'parent', name: 'Research' }
    )
    registry = createSidebarFolder(
      registry,
      '/tmp/app',
      { id: 'child', name: 'Research', parentId: 'parent' }
    )
    registry = createSidebarFolder(
      registry,
      '/tmp/app',
      { id: 'grandchild', name: 'Notes', parentId: 'child' }
    )
    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-a', 'child')
    registry = moveThreadToSidebarFolder(registry, '/tmp/app', 'thread-b', 'grandchild')

    let folders = sidebarFoldersForWorkspace(registry, '/tmp/app')
    expect(sidebarFolderNameExists(folders, 'Research', undefined, 'parent')).toBe(true)
    expect(sidebarFolderDescendantThreadIds(folders, 'parent')).toEqual(['thread-a', 'thread-b'])
    expect(sidebarFolderThreadCount(folders, 'parent')).toBe(2)
    expect(folders).toEqual([
      { id: 'parent', name: 'Research', parentId: null, threadIds: [] },
      { id: 'child', name: 'Research', parentId: 'parent', threadIds: ['thread-a'] },
      { id: 'grandchild', name: 'Notes', parentId: 'child', threadIds: ['thread-b'] }
    ])

    registry = deleteSidebarFolder(registry, '/tmp/app', 'child')
    folders = sidebarFoldersForWorkspace(registry, '/tmp/app')
    expect(folders).toEqual([
      { id: 'parent', name: 'Research', parentId: null, threadIds: [] },
      { id: 'grandchild', name: 'Notes', parentId: 'parent', threadIds: ['thread-b'] }
    ])
  })

  it('renames promoted child folders when deletion would create sibling collisions', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/app',
      { id: 'existing', name: 'Notes' }
    )
    registry = createSidebarFolder(
      registry,
      '/tmp/app',
      { id: 'parent', name: 'Research' }
    )
    registry = createSidebarFolder(
      registry,
      '/tmp/app',
      { id: 'child', name: 'notes', parentId: 'parent' }
    )

    registry = deleteSidebarFolder(registry, '/tmp/app', 'parent')

    expect(sidebarFoldersForWorkspace(registry, '/tmp/app')).toEqual([
      { id: 'existing', name: 'Notes', parentId: null, threadIds: [] },
      { id: 'child', name: 'notes (2)', parentId: null, threadIds: [] }
    ])
  })

  it('repairs missing and cyclic parent references while preserving v1 folders', () => {
    expect(normalizeSidebarFolderRegistry({
      version: 1,
      foldersByScope: {
        '/tmp/app': [
          { id: 'legacy', name: 'Legacy', threadIds: [] },
          { id: 'orphan', name: 'Orphan', parentId: 'missing', threadIds: [] },
          { id: 'cycle-a', name: 'A', parentId: 'cycle-b', threadIds: [] },
          { id: 'cycle-b', name: 'B', parentId: 'cycle-a', threadIds: [] }
        ]
      }
    }).foldersByScope['/tmp/app']).toEqual([
      { id: 'legacy', name: 'Legacy', parentId: null, threadIds: [] },
      { id: 'orphan', name: 'Orphan', parentId: null, threadIds: [] },
      { id: 'cycle-a', name: 'A', parentId: null, threadIds: [] },
      { id: 'cycle-b', name: 'B', parentId: null, threadIds: [] }
    ])
  })

  it('removes stale assignments across every workspace', () => {
    let registry = createSidebarFolder(
      emptySidebarFolderRegistry(),
      '/tmp/a',
      { id: 'folder-a', name: 'A' }
    )
    registry = createSidebarFolder(registry, '/tmp/b', { id: 'folder-b', name: 'B' })
    registry = moveThreadToSidebarFolder(registry, '/tmp/a', 'thread-a', 'folder-a')
    registry = moveThreadToSidebarFolder(registry, '/tmp/b', 'thread-b', 'folder-b')

    registry = removeSidebarThreadAssignments(registry, ['thread-a', 'thread-b'])

    expect(sidebarFoldersForWorkspace(registry, '/tmp/a')[0]?.threadIds).toEqual([])
    expect(sidebarFoldersForWorkspace(registry, '/tmp/b')[0]?.threadIds).toEqual([])
  })
})
