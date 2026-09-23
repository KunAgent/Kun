// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resetThreadClassificationRegistriesForTests,
  useThreadClassificationRegistries,
  type ThreadClassificationRegistries
} from './thread-classification-registries'
import { SHARED_BUSINESS_STORAGE_CHANGED_EVENT } from './shared-business-storage'
import { saveWriteThreadRegistry } from '../write/write-thread-registry'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('useThreadClassificationRegistries', () => {
  let storage: MemoryStorage

  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    resetThreadClassificationRegistriesForTests()
    storage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
  })

  it('re-reads registries on a shared-storage change even when the thread list is unchanged', () => {
    const seen: ThreadClassificationRegistries[] = []
    const threads: unknown[] = []
    function Harness() {
      seen.push(useThreadClassificationRegistries(threads))
      return null
    }
    root = createRoot(container)
    act(() => root!.render(createElement(Harness)))
    const before = seen.at(-1)!

    // Another client's registry edit lands through shared-storage sync.
    saveWriteThreadRegistry({ version: 1, workspaces: {} }, storage)
    act(() => {
      window.dispatchEvent(new CustomEvent(SHARED_BUSINESS_STORAGE_CHANGED_EVENT, {
        detail: { keys: ['kun.write.threadRegistry.v1'] }
      }))
    })

    const after = seen.at(-1)!
    expect(after).not.toBe(before)
    expect(after.writeRegistry).not.toBe(before.writeRegistry)
  })
})
