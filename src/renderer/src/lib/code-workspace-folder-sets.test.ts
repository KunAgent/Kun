import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserStorageLike } from './browser-storage'
import {
  addWorkspaceFolderToRegistry,
  additionalWorkspacesEqual,
  additionalWorkspacesForThread,
  CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY,
  emptyCodeWorkspaceFolderSetsRegistry,
  extraRootsForPrimary,
  forgetCodeWorkspaceFolderSet,
  MAX_ADDITIONAL_WORKSPACES,
  MAX_CODE_WORKSPACE_FOLDER_SETS,
  codeWorkspaceProjectDisplayName,
  codeWorkspaceProjectFolderCount,
  isMultiRootWorktreeBlocked,
  normalizeCodeWorkspaceFolderSetsRegistry,
  readCodeWorkspaceFolderSets,
  removeWorkspaceFolderFromRegistry,
  saveCodeWorkspaceFolderSets,
  saveWorkspaceProject,
  unionWorkspaceFoldersIntoRegistry,
  workspacePathsOverlap,
  workspaceProjectFallbackName
} from './code-workspace-folder-sets'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function withWindowStorage(storage: BrowserStorageLike | null): void {
  vi.stubGlobal('window', storage ? { localStorage: storage } : {})
}

describe('code workspace folder sets', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    withWindowStorage(storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes paths, drops empty extras, and dedupes by identity', () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [
        {
          primary: '/Users/zxy/Code/frontend/',
          extraRoots: [
            '/Users/zxy/Code/backend/',
            '/users/zxy/code/backend',
            '/Users/zxy/Code/frontend',
            '/Users/zxy/Code/frontend/src',
            ''
          ]
        },
        {
          primary: '/users/zxy/code/frontend',
          extraRoots: ['/Users/zxy/Code/other']
        }
      ]
    })
    expect(registry.sets).toHaveLength(1)
    expect(registry.sets[0]).toEqual({
      primary: '/Users/zxy/Code/frontend',
      extraRoots: ['/Users/zxy/Code/backend']
    })
  })

  it('falls back to an empty registry for corrupt storage payloads', () => {
    storage.setItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY, '{not json')
    expect(readCodeWorkspaceFolderSets(storage)).toEqual(emptyCodeWorkspaceFolderSetsRegistry())
    storage.setItem(CODE_WORKSPACE_FOLDER_SETS_STORAGE_KEY, JSON.stringify({ nope: true }))
    expect(readCodeWorkspaceFolderSets(storage)).toEqual(emptyCodeWorkspaceFolderSetsRegistry())
  })

  it('rejects nested, duplicate, primary, and overflowing extra folders', () => {
    const empty = emptyCodeWorkspaceFolderSetsRegistry()
    expect(addWorkspaceFolderToRegistry('', '/Users/zxy/Code/extra', empty).error).toBe('missing-primary')
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '', empty).error).toBe('missing-folder')
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/app/', empty).error).toBe('same-as-primary')
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/app/src', empty).error).toBe('nested')

    const added = addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api', empty)
    expect(added.error).toBeUndefined()
    expect(added.extraRoots).toEqual(['/Users/zxy/Code/api'])
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api/', added.registry).error).toBe('duplicate')
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api/src', added.registry).error).toBe('nested')

    let registry = empty
    for (let index = 0; index < MAX_ADDITIONAL_WORKSPACES; index += 1) {
      const next = addWorkspaceFolderToRegistry('/Users/zxy/Code/app', `/Users/zxy/Code/extra-${index}`, registry)
      expect(next.error).toBeUndefined()
      registry = next.registry
    }
    expect(addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/overflow', registry).error).toBe('limit')
  })

  it('removes extras and drops empty folder sets', () => {
    const added = addWorkspaceFolderToRegistry(
      '/Users/zxy/Code/app',
      '/Users/zxy/Code/api',
      emptyCodeWorkspaceFolderSetsRegistry()
    )
    const removed = removeWorkspaceFolderFromRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api/', added.registry)
    expect(removed.extraRoots).toEqual([])
    expect(removed.registry.sets).toEqual([])
  })

  it('forgets a project folder set without touching unrelated projects', () => {
    const first = addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api', emptyCodeWorkspaceFolderSetsRegistry())
    const second = addWorkspaceFolderToRegistry('/Users/zxy/Code/other', '/Users/zxy/Code/shared', first.registry)
    const forgotten = forgetCodeWorkspaceFolderSet('/Users/zxy/Code/app/', second.registry)
    expect(extraRootsForPrimary('/Users/zxy/Code/app', forgotten)).toEqual([])
    expect(extraRootsForPrimary('/Users/zxy/Code/other', forgotten)).toEqual(['/Users/zxy/Code/shared'])
    expect(extraRootsForPrimary('/Users/zxy/Code/app', null as never)).toEqual([])
  })

  it('unions TUI extras into the project set without removing GUI extras', () => {
    const added = addWorkspaceFolderToRegistry(
      '/Users/zxy/Code/app',
      '/Users/zxy/Code/api',
      emptyCodeWorkspaceFolderSetsRegistry()
    )
    const merged = unionWorkspaceFoldersIntoRegistry(
      '/Users/zxy/Code/app',
      ['/Users/zxy/Code/api', '/Users/zxy/Code/docs', '/Users/zxy/Code/app/src'],
      added.registry
    )
    expect(merged.changed).toBe(true)
    expect(merged.extraRoots).toEqual(['/Users/zxy/Code/api', '/Users/zxy/Code/docs'])
  })

  it('compares additional workspace lists by identity and strips the thread workspace', () => {
    expect(workspacePathsOverlap('/tmp/app', '/tmp/app/src')).toBe(true)
    expect(workspacePathsOverlap('/tmp/app', '/tmp/api')).toBe(false)
    expect(additionalWorkspacesEqual(['/tmp/API/'], ['/tmp/api'])).toBe(true)
    expect(additionalWorkspacesEqual(['/tmp/api'], ['/tmp/docs'])).toBe(false)
    expect(additionalWorkspacesForThread('/tmp/api', ['/tmp/api/', '/tmp/docs'])).toEqual(['/tmp/docs'])
  })

  it('round-trips through localStorage', () => {
    const added = addWorkspaceFolderToRegistry(
      '/Users/zxy/Code/frontend',
      '/Users/zxy/Code/backend',
      emptyCodeWorkspaceFolderSetsRegistry()
    )
    saveCodeWorkspaceFolderSets(added.registry, storage)
    expect(readCodeWorkspaceFolderSets(storage).sets).toEqual([{
      primary: '/Users/zxy/Code/frontend',
      extraRoots: ['/Users/zxy/Code/backend']
    }])
  })

  it('keeps named projects without extra folders and migrates their names', () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [
        { primary: '/Users/zxy/Code/app/', extraRoots: [], displayName: '  Storefront  ' },
        { primary: '/Users/zxy/Code/legacy', extraRoots: [] },
        { primary: '/Users/zxy/Code/api', extraRoots: ['/Users/zxy/Code/shared'] }
      ]
    })
    expect(registry.sets).toEqual([
      { primary: '/Users/zxy/Code/app', extraRoots: [], displayName: 'Storefront' },
      { primary: '/Users/zxy/Code/api', extraRoots: ['/Users/zxy/Code/shared'] }
    ])
    expect(codeWorkspaceProjectDisplayName(registry, '/Users/zxy/Code/app')).toBe('Storefront')
    expect(codeWorkspaceProjectDisplayName(registry, '/Users/zxy/Code/api')).toBe('api')
    expect(workspaceProjectFallbackName('/Users/zxy/Code/app/')).toBe('app')
    expect(codeWorkspaceProjectFolderCount(registry, '/Users/zxy/Code/api')).toBe(2)
    expect(codeWorkspaceProjectFolderCount(registry, '/Users/zxy/Code/unknown')).toBe(1)
  })

  it('never truncates legacy over-limit registries or over-limit extras', () => {
    const sets = Array.from({ length: MAX_CODE_WORKSPACE_FOLDER_SETS + 2 }, (_, index) => ({
      primary: `/Users/zxy/Code/project-${index}`,
      extraRoots: [] as string[],
      displayName: `Project ${index}`
    }))
    const extras = Array.from({ length: MAX_ADDITIONAL_WORKSPACES + 3 }, (_, index) => `/Users/zxy/Code/extra-${index}`)
    sets[0]!.extraRoots = extras
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({ version: 1, sets })
    expect(registry.sets).toHaveLength(MAX_CODE_WORKSPACE_FOLDER_SETS + 2)
    expect(registry.sets[0]!.extraRoots).toHaveLength(MAX_ADDITIONAL_WORKSPACES + 3)
  })

  it('fails instead of evicting a project when the project limit is reached', () => {
    let registry = emptyCodeWorkspaceFolderSetsRegistry()
    for (let index = 0; index < MAX_CODE_WORKSPACE_FOLDER_SETS; index += 1) {
      const saved = saveWorkspaceProject(registry, {
        mode: 'create',
        displayName: `Project ${index}`,
        primary: `/Users/zxy/Code/project-${index}`,
        extraRoots: []
      })
      expect(saved.error).toBeUndefined()
      registry = saved.registry
    }
    const before = registry.sets.map((set) => set.primary)
    const overflow = addWorkspaceFolderToRegistry('/Users/zxy/Code/overflow', '/Users/zxy/Code/extra', registry)
    expect(overflow.error).toBe('project-limit')
    expect(overflow.registry.sets.map((set) => set.primary)).toEqual(before)
    expect(saveWorkspaceProject(registry, {
      mode: 'create',
      displayName: 'Overflow',
      primary: '/Users/zxy/Code/overflow',
      extraRoots: []
    }).error).toBe('project-limit')
  })

  it('validates project drafts and keeps the primary fixed on manage', () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [{ primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/api'], displayName: 'Storefront' }]
    })
    expect(saveWorkspaceProject(registry, {
      mode: 'create', displayName: '  ', primary: '/Users/zxy/Code/new', extraRoots: []
    }).error).toBe('missing-name')
    expect(saveWorkspaceProject(registry, {
      mode: 'create', displayName: 'New', primary: '/Users/zxy/Code/app', extraRoots: []
    }).error).toBe('duplicate-primary')
    expect(saveWorkspaceProject(registry, {
      mode: 'create', displayName: 'New', primary: '/Users/zxy/Code/new', extraRoots: ['/Users/zxy/Code/new/src']
    }).error).toBe('nested')
    expect(saveWorkspaceProject(registry, {
      mode: 'create', displayName: 'New', primary: '/Users/zxy/Code/new', extraRoots: ['/Users/zxy/Code/new/']
    }).error).toBe('same-as-primary')
    expect(saveWorkspaceProject(registry, {
      mode: 'create', displayName: 'New', primary: '/Users/zxy/Code/new',
      extraRoots: ['/Users/zxy/Code/docs', '/Users/zxy/Code/docs/']
    }).error).toBe('duplicate')

    const renamed = saveWorkspaceProject(registry, {
      mode: 'manage', displayName: 'Renamed', primary: '/Users/zxy/Code/app/', extraRoots: ['/Users/zxy/Code/docs']
    })
    expect(renamed.error).toBeUndefined()
    expect(renamed.registry.sets).toEqual([
      { primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/docs'], displayName: 'Renamed' }
    ])
    expect(saveWorkspaceProject(registry, {
      mode: 'manage', displayName: 'Ghost', primary: '/Users/zxy/Code/ghost', extraRoots: []
    }).error).toBe('missing-primary')
  })

  it('removing the last extra keeps a named project', () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [{ primary: '/Users/zxy/Code/app', extraRoots: ['/Users/zxy/Code/api'], displayName: 'Storefront' }]
    })
    const removed = removeWorkspaceFolderFromRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api', registry)
    expect(removed.registry.sets).toEqual([
      { primary: '/Users/zxy/Code/app', extraRoots: [], displayName: 'Storefront' }
    ])
  })

  it('preserves a project name when extras are added through the picker', () => {
    const registry = normalizeCodeWorkspaceFolderSetsRegistry({
      version: 1,
      sets: [{ primary: '/Users/zxy/Code/app', extraRoots: [], displayName: 'Storefront' }]
    })
    const added = addWorkspaceFolderToRegistry('/Users/zxy/Code/app', '/Users/zxy/Code/api', registry)
    expect(added.registry.sets[0]).toEqual({
      primary: '/Users/zxy/Code/app',
      extraRoots: ['/Users/zxy/Code/api'],
      displayName: 'Storefront'
    })
  })

  it('blocks multi-root worktree creation without disabling isolation', () => {
    expect(isMultiRootWorktreeBlocked(0, 'worktree')).toBe(false)
    expect(isMultiRootWorktreeBlocked(2, 'local')).toBe(false)
    expect(isMultiRootWorktreeBlocked(2, undefined)).toBe(false)
    expect(isMultiRootWorktreeBlocked(1, 'worktree')).toBe(true)
  })
})
