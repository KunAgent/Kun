import { describe, expect, it } from 'vitest'
import {
  readThreadClassificationRegistries,
  resetThreadClassificationRegistriesForTests
} from './thread-classification-registries'
import {
  saveThreadWorktreeRegistry,
  THREAD_WORKTREE_REGISTRY_KEY
} from './thread-worktree-registry'
import { saveWriteThreadRegistry, WRITE_THREAD_REGISTRY_KEY } from '../write/write-thread-registry'
import type { BrowserStorageLike } from './browser-storage'

class MemoryStorage implements BrowserStorageLike {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('readThreadClassificationRegistries', () => {
  it('keeps parsed registry identities stable while storage is unchanged', () => {
    resetThreadClassificationRegistriesForTests()
    const storage = new MemoryStorage()
    const first = readThreadClassificationRegistries(storage)
    const second = readThreadClassificationRegistries(storage)
    expect(second).toBe(first)
    expect(second.threadWorktrees).toBe(first.threadWorktrees)
    expect(second.writeRegistry).toBe(first.writeRegistry)
    expect(second.designRegistry).toBe(first.designRegistry)
    expect(second.sddRegistry).toBe(first.sddRegistry)
  })

  it('re-parses only the registry whose stored value changed', () => {
    resetThreadClassificationRegistriesForTests()
    const storage = new MemoryStorage()
    const first = readThreadClassificationRegistries(storage)
    saveWriteThreadRegistry(
      {
        ...first.writeRegistry,
        workspaces: {
          '/repo/write': {
            activeThreadId: 'thread-1',
            threadIds: ['thread-1'],
            fileThreadIds: {},
            fileThreadHistoryIds: {}
          }
        }
      },
      storage
    )
    const second = readThreadClassificationRegistries(storage)
    expect(second.writeRegistry).not.toBe(first.writeRegistry)
    expect(second.threadWorktrees).toBe(first.threadWorktrees)
    expect(second.designRegistry).toBe(first.designRegistry)
    expect(second.sddRegistry).toBe(first.sddRegistry)
    expect(second).not.toBe(first)
  })

  it('sees writes made through the same storage instance', () => {
    resetThreadClassificationRegistriesForTests()
    const storage = new MemoryStorage()
    readThreadClassificationRegistries(storage)
    saveThreadWorktreeRegistry(
      {
        version: 1,
        worktrees: {
          'thread-9': {
            projectPath: '/repo/app',
            worktreePath: '/repo/app-wt-1',
            branch: 'kun/wt-1'
          }
        }
      },
      storage
    )
    const next = readThreadClassificationRegistries(storage)
    expect(next.threadWorktrees['thread-9']?.worktreePath).toBe('/repo/app-wt-1')
    expect(storage.getItem(THREAD_WORKTREE_REGISTRY_KEY)).toContain('/repo/app-wt-1')
  })

  it('returns empty registries without storage and does not poison the cache', () => {
    resetThreadClassificationRegistriesForTests()
    const empty = readThreadClassificationRegistries(null)
    expect(Object.keys(empty.threadWorktrees)).toHaveLength(0)
    const storage = new MemoryStorage()
    saveWriteThreadRegistry(
      {
        version: 1,
        workspaces: {
          '/repo/w': {
            activeThreadId: 't-1',
            threadIds: ['t-1'],
            fileThreadIds: {},
            fileThreadHistoryIds: {}
          }
        }
      },
      storage
    )
    const next = readThreadClassificationRegistries(storage)
    expect(next.writeRegistry.workspaces['/repo/w']?.threadIds).toContain('t-1')
    expect(storage.getItem(WRITE_THREAD_REGISTRY_KEY)).not.toBeNull()
  })
})
