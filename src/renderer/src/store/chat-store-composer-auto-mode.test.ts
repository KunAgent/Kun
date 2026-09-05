import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeComposerPlanMode,
  readThreadComposerMode,
  rememberThreadComposerMode
} from './chat-store-helpers'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

afterEach(() => vi.unstubAllGlobals())

describe('GUI-only Automatic composer mode', () => {
  it('normalizes and persists Automatic independently from runtime thread mode', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    expect(normalizeComposerPlanMode('auto')).toBe('auto')
    rememberThreadComposerMode('thread-auto', 'auto')
    expect(readThreadComposerMode('thread-auto')).toBe('auto')
    expect(normalizeComposerPlanMode('graph')).toBeNull()
  })
})
