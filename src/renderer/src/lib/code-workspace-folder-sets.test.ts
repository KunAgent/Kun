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
  normalizeCodeWorkspaceFolderSetsRegistry,
  readCodeWorkspaceFolderSets,
  removeWorkspaceFolderFromRegistry,
  saveCodeWorkspaceFolderSets,
  unionWorkspaceFoldersIntoRegistry,
  workspacePathsOverlap
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
})
