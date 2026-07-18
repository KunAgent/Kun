import { describe, expect, it } from 'vitest'
import {
  computeWriteDocumentStats,
  inlineAgentPosition,
  inlineAgentPlacement,
  isInlineCompletionToggleShortcut,
  type WriteInlineAgentPosition
} from './write-workspace-view-utils'

describe('computeWriteDocumentStats', () => {
  it('counts visible markdown text instead of syntax markers', () => {
    const stats = computeWriteDocumentStats('# 标题\n\n- 第一项\n- 第二项 **加粗**\n', true)

    expect(stats).toEqual({ characterCount: 10, wordCount: 6 })
  })

  it('counts non-whitespace characters for plain text files', () => {
    const stats = computeWriteDocumentStats('Hello world\n  2026  ', false)

    expect(stats).toEqual({ characterCount: 14, wordCount: 3 })
  })

  it('does not merge words across Markdown node boundaries', () => {
    const stats = computeWriteDocumentStats('first paragraph\n\nsecond paragraph', true)

    expect(stats.wordCount).toBe(4)
  })

  it('does not split a visible word at inline Markdown mark boundaries', () => {
    const stats = computeWriteDocumentStats('inter**nation**al [foot](https://example.com)note', true)

    expect(stats).toEqual({ characterCount: 21, wordCount: 2 })
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
    defaultPrevented: false,
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
    expect(isInlineCompletionToggleShortcut(event({ defaultPrevented: true }))).toBe(false)
    expect(isInlineCompletionToggleShortcut(event({ altKey: true }))).toBe(false)
    expect(isInlineCompletionToggleShortcut(event({ code: 'Enter' }))).toBe(false)
  })
})

const action: WriteInlineAgentPosition = {
  left: 320,
  width: 300,
  anchorLeft: 400,
  anchorRight: 600,
  coordinateScale: 1,
  anchorTop: 300,
  anchorBottom: 340
}

describe('inlineAgentPosition', () => {
  it.each([
    { coordinateScale: 0.82, viewportWidth: 820 },
    { coordinateScale: 1, viewportWidth: 1000 },
    { coordinateScale: 1.25, viewportWidth: 1250 }
  ])('normalizes selection coordinates at $coordinateScale UI scale', ({ coordinateScale, viewportWidth }) => {
    const position = inlineAgentPosition({
      anchorRect: {
        left: 400 * coordinateScale,
        right: 600 * coordinateScale,
        top: 300 * coordinateScale,
        bottom: 340 * coordinateScale,
        width: 200 * coordinateScale
      }
    }, {
      compact: true,
      coordinateScale,
      viewportWidth
    })

    expect(position).toMatchObject({
      left: 380,
      width: 240,
      coordinateScale
    })
    expect(position?.anchorLeft).toBeCloseTo(400)
    expect(position?.anchorRight).toBeCloseTo(600)
    expect(position?.anchorTop).toBeCloseTo(300)
    expect(position?.anchorBottom).toBeCloseTo(340)
  })
})

describe('inlineAgentPlacement', () => {
  it.each([
    { coordinateScale: 0.82, viewportWidth: 820, viewportHeight: 656 },
    { coordinateScale: 1, viewportWidth: 1000, viewportHeight: 800 },
    { coordinateScale: 1.25, viewportWidth: 1250, viewportHeight: 1000 }
  ])('keeps placement stable at $coordinateScale UI scale', ({ coordinateScale, viewportWidth, viewportHeight }) => {
    expect(inlineAgentPlacement({ ...action, coordinateScale }, {
      menuHeight: 200,
      viewportWidth,
      viewportHeight
    })).toMatchObject({
      left: 320,
      top: 348,
      maxHeight: 200,
      origin: 'top-center'
    })
  })

  it('places the menu below a selection when it fits', () => {
    expect(inlineAgentPlacement(action, {
      menuHeight: 200,
      viewportWidth: 1000,
      viewportHeight: 800
    })).toMatchObject({
      left: 320,
      top: 348,
      maxHeight: 200,
      origin: 'top-center'
    })
  })

  it('flips above without overlapping the selection', () => {
    expect(inlineAgentPlacement(
      { ...action, anchorTop: 600, anchorBottom: 640 },
      { menuHeight: 200, viewportWidth: 1000, viewportHeight: 800 }
    )).toMatchObject({
      top: 392,
      origin: 'bottom-center'
    })
  })

  it('moves beside a tall selection when neither vertical side fits', () => {
    expect(inlineAgentPlacement(
      { ...action, anchorLeft: 250, anchorRight: 450, anchorTop: 180, anchorBottom: 620 },
      { menuHeight: 260, viewportWidth: 1000, viewportHeight: 800 }
    )).toMatchObject({
      left: 458,
      top: 270,
      origin: 'center-left'
    })
  })

  it('constrains the menu to the larger vertical gap when no side fits', () => {
    const placement = inlineAgentPlacement(
      { ...action, anchorLeft: 180, anchorRight: 820, anchorTop: 260, anchorBottom: 500 },
      { menuHeight: 420, viewportWidth: 1000, viewportHeight: 800 }
    )

    expect(placement).toMatchObject({
      top: 508,
      maxHeight: 276,
      origin: 'top-center'
    })
    expect(placement.top).toBeGreaterThan(500)
  })

  it('uses the larger constrained gap even when above is preferred', () => {
    expect(inlineAgentPlacement(
      { ...action, anchorLeft: 180, anchorRight: 820, anchorTop: 40, anchorBottom: 200 },
      {
        menuHeight: 700,
        viewportWidth: 1000,
        viewportHeight: 800,
        preferAbove: true
      }
    )).toMatchObject({
      top: 208,
      maxHeight: 576,
      origin: 'top-center'
    })
  })
})
