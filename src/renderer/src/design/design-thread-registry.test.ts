import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  activeDesignThreadForWorkspace,
  designDocKey,
  emptyDesignThreadRegistry,
  forgetDesignThread,
  isDesignThreadId,
  markDesignThread,
  readDesignThreadRegistry,
  saveDesignThreadRegistry
} from './design-thread-registry'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, workspace = '/Users/zxy/project'): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-01T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace
  }
}

describe('design-thread-registry', () => {
  it('saves and restores design thread records by workspace and design document', () => {
    const storage = new MemoryStorage()
    const registry = markDesignThread(
      '/Users/zxy/project',
      'login',
      'thread-design-1',
      emptyDesignThreadRegistry()
    )
    saveDesignThreadRegistry(registry, storage)

    const restored = readDesignThreadRegistry(storage)

    expect(isDesignThreadId('thread-design-1', restored)).toBe(true)
    expect(
      activeDesignThreadForWorkspace(
        '/Users/zxy/project',
        'login',
        [thread('thread-design-1')],
        restored
      )?.id
    ).toBe('thread-design-1')
  })

  it('keeps design documents in the same workspace scoped to separate conversations', () => {
    const registry = markDesignThread(
      '/Users/zxy/project',
      'settings',
      'thread-settings',
      markDesignThread(
        '/Users/zxy/project',
        'login',
        'thread-login',
        emptyDesignThreadRegistry()
      )
    )

    expect(registry.workspaces[designDocKey('/Users/zxy/project', 'login')]?.threadIds)
      .toEqual(['thread-login'])
    expect(registry.workspaces[designDocKey('/Users/zxy/project', 'settings')]?.threadIds)
      .toEqual(['thread-settings'])
  })

  it('forgets deleted design threads across scopes and falls back to the next remembered thread', () => {
    const registry = markDesignThread(
      '/Users/zxy/project',
      'login',
      'thread-newer',
      markDesignThread(
        '/Users/zxy/project',
        'login',
        'thread-older',
        markDesignThread(
          '/Users/zxy/project',
          'settings',
          'thread-newer',
          emptyDesignThreadRegistry()
        )
      )
    )

    const next = forgetDesignThread('thread-newer', registry)

    expect(isDesignThreadId('thread-newer', next)).toBe(false)
    expect(next.workspaces[designDocKey('/Users/zxy/project', 'settings')]).toBeUndefined()
    expect(next.workspaces[designDocKey('/Users/zxy/project', 'login')]?.activeThreadId)
      .toBe('thread-older')
    expect(next.workspaces[designDocKey('/Users/zxy/project', 'login')]?.threadIds)
      .toEqual(['thread-older'])
  })
})
