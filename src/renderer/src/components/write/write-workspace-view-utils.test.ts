import { describe, expect, it } from 'vitest'
import { computeWriteDocumentStats, isInlineCompletionToggleShortcut } from './write-workspace-view-utils'

describe('computeWriteDocumentStats', () => {
  it('counts visible markdown text instead of syntax markers', () => {
    const stats = computeWriteDocumentStats('# 标题\n\n- 第一项\n- 第二项 **加粗**\n', true)

    expect(stats).toEqual({ characterCount: 10 })
  })

  it('counts non-whitespace characters for plain text files', () => {
    const stats = computeWriteDocumentStats('Hello world\n  2026  ', false)

    expect(stats).toEqual({ characterCount: 14 })
  })
})

describe('isInlineCompletionToggleShortcut', () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    code: 'Space',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...overrides
  }) as KeyboardEvent

  it('accepts Ctrl/Command + Shift + Space once', () => {
    expect(isInlineCompletionToggleShortcut(event())).toBe(true)
    expect(isInlineCompletionToggleShortcut(event({ ctrlKey: false, metaKey: true }))).toBe(true)
  })

  it('rejects incomplete, repeated, composing, and Alt-modified shortcuts', () => {
    expect(isInlineCompletionToggleShortcut(event({ shiftKey: false }))).toBe(false)
    expect(isInlineCompletionToggleShortcut(event({ repeat: true }))).toBe(false)
    expect(isInlineCompletionToggleShortcut(event({ isComposing: true }))).toBe(false)
    expect(isInlineCompletionToggleShortcut(event({ altKey: true }))).toBe(false)
  })
})
