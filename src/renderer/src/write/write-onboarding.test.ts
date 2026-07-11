import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  readWriteOnboardingComplete,
  writeWriteOnboardingComplete
} from './write-onboarding'

function memoryStorage(initial: string | null = null): BrowserStorageLike & { value: string | null } {
  return {
    value: initial,
    getItem() {
      return this.value
    },
    setItem(_key, value) {
      this.value = value
    }
  }
}

describe('Write onboarding persistence', () => {
  it('starts incomplete and persists completion', () => {
    const storage = memoryStorage()

    expect(readWriteOnboardingComplete(storage)).toBe(false)
    writeWriteOnboardingComplete(storage)
    expect(readWriteOnboardingComplete(storage)).toBe(true)
  })

  it('does not treat unknown stored values as complete', () => {
    expect(readWriteOnboardingComplete(memoryStorage('true'))).toBe(false)
  })
})
