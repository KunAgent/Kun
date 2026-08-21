import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from './browser-storage'
import {
  MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES,
  THREAD_RIGHT_PANEL_EXPANSION_KEY,
  emptyThreadRightPanelExpansionRegistry,
  forgetThreadRightPanelExpansion,
  forgetStoredThreadRightPanelExpansion,
  normalizeThreadRightPanelExpansionRegistry,
  readThreadRightPanelExpansionRegistry,
  rememberThreadRightPanelExpansion,
  saveThreadRightPanelExpansionRegistry,
  threadRightPanelExpanded
} from './thread-right-panel-expansion'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('thread right-panel expansion registry', () => {
  it('round-trips expanded and collapsed preferences', () => {
    const storage = new MemoryStorage()
    let registry = rememberThreadRightPanelExpansion(
      'thread-open',
      true,
      emptyThreadRightPanelExpansionRegistry()
    )
    registry = rememberThreadRightPanelExpansion('thread-closed', false, registry)
    saveThreadRightPanelExpansionRegistry(registry, storage)

    const restored = readThreadRightPanelExpansionRegistry(storage)
    expect(threadRightPanelExpanded('thread-open', restored)).toBe(true)
    expect(threadRightPanelExpanded('thread-closed', restored)).toBe(false)
    expect(threadRightPanelExpanded('thread-unknown', restored)).toBe(false)
  })

  it('fails closed for invalid versions, malformed JSON, and invalid entries', () => {
    expect(normalizeThreadRightPanelExpansionRegistry({
      version: 1,
      threads: { ' thread-a ': true, '': true, invalid: 'yes' }
    })).toEqual({ version: 1, threads: { 'thread-a': true } })
    expect(normalizeThreadRightPanelExpansionRegistry({
      version: 2,
      threads: { 'thread-a': true }
    })).toEqual(emptyThreadRightPanelExpansionRegistry())

    const storage = new MemoryStorage()
    storage.setItem(THREAD_RIGHT_PANEL_EXPANSION_KEY, '{bad json')
    expect(readThreadRightPanelExpansionRegistry(storage)).toEqual(
      emptyThreadRightPanelExpansionRegistry()
    )
  })

  it('retains only the most recently updated 500 entries', () => {
    let registry = emptyThreadRightPanelExpansionRegistry()
    for (let index = 0; index < MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES + 5; index += 1) {
      registry = rememberThreadRightPanelExpansion(`thread-${index}`, index % 2 === 0, registry)
    }

    expect(Object.keys(registry.threads)).toHaveLength(MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES)
    expect(registry.threads['thread-0']).toBeUndefined()
    expect(registry.threads[`thread-${MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES + 4}`]).toBe(true)
  })

  it('refreshes an updated thread before trimming the oldest entry', () => {
    let registry = emptyThreadRightPanelExpansionRegistry()
    for (let index = 0; index < MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES; index += 1) {
      registry = rememberThreadRightPanelExpansion(`thread-${index}`, false, registry)
    }
    registry = rememberThreadRightPanelExpansion('thread-0', true, registry)
    registry = rememberThreadRightPanelExpansion('thread-new', true, registry)

    expect(Object.keys(registry.threads)).toHaveLength(MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES)
    expect(registry.threads['thread-0']).toBe(true)
    expect(registry.threads['thread-1']).toBeUndefined()
  })

  it('forgets a deleted thread without changing other preferences', () => {
    let registry = rememberThreadRightPanelExpansion(
      'thread-a',
      true,
      emptyThreadRightPanelExpansionRegistry()
    )
    registry = rememberThreadRightPanelExpansion('thread-b', false, registry)

    expect(forgetThreadRightPanelExpansion('thread-a', registry)).toEqual({
      version: 1,
      threads: { 'thread-b': false }
    })

    const storage = new MemoryStorage()
    saveThreadRightPanelExpansionRegistry(registry, storage)
    forgetStoredThreadRightPanelExpansion('thread-a', storage)
    expect(readThreadRightPanelExpansionRegistry(storage)).toEqual({
      version: 1,
      threads: { 'thread-b': false }
    })
  })
})
