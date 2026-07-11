import { describe, expect, it } from 'vitest'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES,
  readWriteEditorDisplayPreferences,
  writeWriteEditorDisplayPreferences
} from './write-editor-display-preferences'

function memoryStorage(initial?: string): BrowserStorageLike & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value
    },
    setItem(_key, value) {
      this.value = value
    }
  }
}

describe('Write editor display preferences', () => {
  it('keeps current wrapping behavior and hides line numbers by default', () => {
    expect(readWriteEditorDisplayPreferences(memoryStorage())).toEqual(
      DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES
    )
  })

  it('round-trips line-number and wrapping choices', () => {
    const storage = memoryStorage()

    writeWriteEditorDisplayPreferences({ lineNumbers: true, lineWrapping: false }, storage)

    expect(readWriteEditorDisplayPreferences(storage)).toEqual({
      lineNumbers: true,
      lineWrapping: false
    })
  })

  it('recovers from malformed or partial storage', () => {
    expect(readWriteEditorDisplayPreferences(memoryStorage('{broken'))).toEqual(
      DEFAULT_WRITE_EDITOR_DISPLAY_PREFERENCES
    )
    expect(readWriteEditorDisplayPreferences(memoryStorage('{"lineNumbers":true}'))).toEqual({
      lineNumbers: true,
      lineWrapping: true
    })
  })
})
