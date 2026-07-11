import { describe, expect, it } from 'vitest'
import { isWriteFocusModeShortcut } from './write-focus-mode'

describe('isWriteFocusModeShortcut', () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    code: 'KeyF',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...overrides
  }) as KeyboardEvent

  it('accepts Ctrl/Command + Shift + F once', () => {
    expect(isWriteFocusModeShortcut(event())).toBe(true)
    expect(isWriteFocusModeShortcut(event({ ctrlKey: false, metaKey: true }))).toBe(true)
  })

  it('rejects incomplete, repeated, composing, and Alt-modified shortcuts', () => {
    expect(isWriteFocusModeShortcut(event({ shiftKey: false }))).toBe(false)
    expect(isWriteFocusModeShortcut(event({ repeat: true }))).toBe(false)
    expect(isWriteFocusModeShortcut(event({ isComposing: true }))).toBe(false)
    expect(isWriteFocusModeShortcut(event({ altKey: true }))).toBe(false)
  })
})
