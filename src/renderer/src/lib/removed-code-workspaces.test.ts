import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptyRemovedCodeWorkspacesRegistry,
  effectiveCodeWorkspaceRoot,
  filterRemovedCodeWorkspaceRoots,
  isCodeWorkspaceRemoved,
  normalizeRemovedCodeWorkspacesRegistry,
  readRemovedCodeWorkspaces,
  rememberRemovedCodeWorkspace,
  removedWorkspaceIdentityKeys,
  restoreRemovedCodeWorkspace,
  saveRemovedCodeWorkspaces,
  type RemovedCodeWorkspacesRegistry
} from './removed-code-workspaces'
import type { BrowserStorageLike } from './browser-storage'

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

import { vi } from 'vitest'

describe('removed code workspaces registry', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    withWindowStorage(storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes paths and dedupes by identity key', () => {
    const registry = normalizeRemovedCodeWorkspacesRegistry({
      version: 1,
      removed: [
        {
          projectPath: '/Users/zxy/Code/Project-A/',
          aliases: ['/users/zxy/code/project-a', '/Users/zxy/.kun/worktrees/ab/Project-A'],
          removedAt: '2026-08-28T00:00:00.000Z'
        },
        {
          // Same identity as the first entry; must be dropped.
          projectPath: '/users/zxy/code/project-a',
          aliases: [],
          removedAt: '2026-08-28T01:00:00.000Z'
        },
        { projectPath: '', aliases: [], removedAt: '' },
        null
      ]
    })

    expect(registry.removed).toHaveLength(1)
    expect(registry.removed[0]?.projectPath).toBe('/Users/zxy/Code/Project-A')
    expect(registry.removed[0]?.aliases).toEqual([
      '/Users/zxy/.kun/worktrees/ab/Project-A'
    ])
  })

  it('falls back to an empty registry for corrupt storage payloads', () => {
    storage.setItem('kun.removedCodeWorkspaces.v1', '{not json')
    expect(readRemovedCodeWorkspaces()).toEqual(emptyRemovedCodeWorkspacesRegistry())
    storage.setItem('kun.removedCodeWorkspaces.v1', JSON.stringify({ nope: true }))
    expect(readRemovedCodeWorkspaces()).toEqual(emptyRemovedCodeWorkspacesRegistry())
  })

  it('persists a project with aliases and keeps removal idempotent', () => {
    const first = rememberRemovedCodeWorkspace({
      projectPath: '/Users/zxy/Code/Kun',
      aliases: ['/Users/zxy/Code/Kun.worktrees/tui']
    })
    expect(first.removed).toHaveLength(1)

    const second = rememberRemovedCodeWorkspace({
      projectPath: '/users/zxy/code/kun',
      aliases: ['/Users/zxy/.kun/worktrees/zz/Kun']
    })
    expect(second.removed).toHaveLength(1)
    const record = second.removed[0]
    expect(record?.projectPath).toBe('/users/zxy/code/kun')
    const aliasKeys = new Set(record?.aliases.map((alias) => alias.toLowerCase()))
    expect(aliasKeys).toContain('/users/zxy/code/kun.worktrees/tui')
    expect(aliasKeys).toContain('/users/zxy/.kun/worktrees/zz/kun')

    expect(readRemovedCodeWorkspaces().removed).toHaveLength(1)
  })

  it('reports removal for primary paths and aliases only', () => {
    let registry: RemovedCodeWorkspacesRegistry = rememberRemovedCodeWorkspace({
      projectPath: '/Users/zxy/Code/A',
      aliases: ['/Users/zxy/.kun/worktrees/x/A']
    })

    expect(isCodeWorkspaceRemoved('/Users/zxy/Code/A', registry)).toBe(true)
    expect(isCodeWorkspaceRemoved('/Users/zxy/.kun/worktrees/x/A', registry)).toBe(true)
    expect(isCodeWorkspaceRemoved('/Users/zxy/Code/B', registry)).toBe(false)
    expect(isCodeWorkspaceRemoved('   ', registry)).toBe(false)

    registry = restoreRemovedCodeWorkspace('/Users/zxy/.kun/worktrees/x/A', registry)
    expect(isCodeWorkspaceRemoved('/Users/zxy/Code/A', registry)).toBe(false)
  })

  it('restores by primary path without touching other records', () => {
    let registry = rememberRemovedCodeWorkspace({ projectPath: '/Users/zxy/Code/A' })
    registry = rememberRemovedCodeWorkspace({ projectPath: '/Users/zxy/Code/B' }, registry)

    registry = restoreRemovedCodeWorkspace('/users/zxy/code/a', registry)

    expect(registry.removed.map((record) => record.projectPath)).toEqual(['/Users/zxy/Code/B'])
    expect(isCodeWorkspaceRemoved('/Users/zxy/Code/B', registry)).toBe(true)
  })

  it('filters candidate roots by removed project identity', () => {
    const registry = rememberRemovedCodeWorkspace({
      projectPath: '/Users/zxy/Code/A',
      aliases: ['/Users/zxy/.kun/worktrees/x/A']
    })

    expect(
      filterRemovedCodeWorkspaceRoots(
        [
          '/Users/zxy/Code/A',
          '/Users/zxy/.kun/worktrees/x/A',
          '/Users/zxy/Code/B',
          '/Users/zxy/Code/B',
          ''
        ],
        registry
      )
    ).toEqual(['/Users/zxy/Code/B'])
  })

  it('returns every project and alias identity and hides alias current roots', () => {
    const registry = rememberRemovedCodeWorkspace({
      projectPath: '/Users/zxy/Code/A',
      aliases: ['/Users/zxy/Code/A.worktrees/feature']
    })

    expect(removedWorkspaceIdentityKeys(registry)).toEqual(new Set([
      '/users/zxy/code/a',
      '/users/zxy/code/a.worktrees/feature'
    ]))
    expect(effectiveCodeWorkspaceRoot(
      '/Users/zxy/Code/A.worktrees/feature',
      registry
    )).toBe('')
    expect(effectiveCodeWorkspaceRoot('/Users/zxy/Code/B', registry))
      .toBe('/Users/zxy/Code/B')
  })

  it('keeps an explicitly restored project removed-record free across reloads', () => {
    rememberRemovedCodeWorkspace({ projectPath: '/Users/zxy/Code/A' })
    restoreRemovedCodeWorkspace('/Users/zxy/Code/A')
    expect(readRemovedCodeWorkspaces().removed).toHaveLength(0)
  })

  it('degrades to an empty registry when storage is unavailable', () => {
    withWindowStorage(null)
    expect(readRemovedCodeWorkspaces()).toEqual(emptyRemovedCodeWorkspacesRegistry())
    expect(
      saveRemovedCodeWorkspaces({ version: 1, removed: [] })
    ).toEqual(emptyRemovedCodeWorkspacesRegistry())
  })
})
