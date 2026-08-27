import { describe, expect, it } from 'vitest'
import {
  CANVAS_CONVERSATION_EDGE_MARGIN,
  CANVAS_CONVERSATION_SAFE_INSET,
  canvasConversationLayoutKey,
  canvasConversationPanelSize,
  canvasConversationResponsiveMode,
  clampCanvasConversationLayout,
  defaultCanvasConversationLayout,
  normalizeCanvasConversationLayout
} from './design-canvas-conversation-layout'

describe('canvasConversationResponsiveMode', () => {
  it('uses a bottom sheet below the mobile breakpoint', () => {
    expect(canvasConversationResponsiveMode(500)).toBe('sheet')
    expect(canvasConversationResponsiveMode(767)).toBe('sheet')
  })

  it('uses compact between mobile and desktop', () => {
    expect(canvasConversationResponsiveMode(768)).toBe('compact')
    expect(canvasConversationResponsiveMode(1099)).toBe('compact')
  })

  it('uses desktop from 1100px', () => {
    expect(canvasConversationResponsiveMode(1100)).toBe('desktop')
    expect(canvasConversationResponsiveMode(1920)).toBe('desktop')
  })
})

describe('defaultCanvasConversationLayout', () => {
  it('places the panel left of center, clear of the canvas toolbar and window controls', () => {
    const layout = defaultCanvasConversationLayout({ width: 1600, height: 900 }, 'desktop')
    expect(layout.open).toBe(false)
    expect(layout.minimized).toBe(false)
    // The assistant launcher/panel is aligned to the left beside canvas properties,
    // leaving the right toolbar and bottom zoom controls unobstructed. It also
    // clears the macOS traffic-light window controls via the safe inset.
    expect(layout.x).toBe(CANVAS_CONVERSATION_EDGE_MARGIN + CANVAS_CONVERSATION_SAFE_INSET)
    expect(layout.y).toBeGreaterThan(CANVAS_CONVERSATION_EDGE_MARGIN)
  })

  it('pins the sheet to the bottom on mobile', () => {
    const layout = defaultCanvasConversationLayout({ width: 500, height: 800 }, 'sheet')
    expect(layout.x).toBe(0)
    expect(layout.y).toBeGreaterThan(0)
  })

  it('drops below the focused titlebar when a window-controls top inset applies', () => {
    // Height is small enough that the reserved top band shrinks the panel.
    const bounds = { width: 1600, height: 760 }
    const withoutInset = defaultCanvasConversationLayout(bounds, 'desktop')
    const withInset = defaultCanvasConversationLayout(bounds, 'desktop', 42)
    expect(withInset.y).toBe(withoutInset.y + 42)
    expect(withInset.height).toBe(withoutInset.height - 42)
  })
})

describe('clampCanvasConversationLayout', () => {
  it('keeps the panel inside the viewport with an edge margin', () => {
    const clamped = clampCanvasConversationLayout(
      { open: true, minimized: false, x: -400, y: 9000, width: 420, height: 680 },
      { width: 1200, height: 800 },
      'desktop'
    )
    expect(clamped.x).toBe(CANVAS_CONVERSATION_EDGE_MARGIN)
    expect(clamped.y).toBeLessThan(800)
    expect(clamped.y).toBeGreaterThanOrEqual(CANVAS_CONVERSATION_EDGE_MARGIN)
  })

  it('keeps the panel clear of the focused titlebar band', () => {
    const clamped = clampCanvasConversationLayout(
      { open: true, minimized: false, x: 200, y: 4, width: 420, height: 680 },
      { width: 1200, height: 800 },
      'desktop',
      42
    )
    expect(clamped.y).toBe(72 + 42)
  })

  it('forces sheet mode geometry on mobile', () => {
    const clamped = clampCanvasConversationLayout(
      { open: true, minimized: false, x: 300, y: 120, width: 420, height: 680 },
      { width: 420, height: 700 },
      'sheet'
    )
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(0)
  })
})

describe('canvasConversationPanelSize', () => {
  it('caps the desktop panel at 420px wide and 680px tall', () => {
    const size = canvasConversationPanelSize({ width: 1600, height: 900 }, 'desktop')
    expect(size.width).toBe(420)
    expect(size.height).toBe(680)
  })

  it('clamps a user-resized panel to supported desktop bounds', () => {
    const size = canvasConversationPanelSize(
      { width: 1600, height: 900 },
      'desktop',
      { width: 900, height: 240 }
    )
    expect(size.width).toBe(720)
    expect(size.height).toBe(320)
  })

  it('narrows the panel in compact mode', () => {
    const size = canvasConversationPanelSize({ width: 900, height: 800 }, 'compact')
    expect(size.width).toBeLessThanOrEqual(400)
  })

  it('uses nearly the full sheet width on mobile', () => {
    const size = canvasConversationPanelSize({ width: 400, height: 800 }, 'sheet')
    expect(size.width).toBe(400 - CANVAS_CONVERSATION_EDGE_MARGIN * 2)
    expect(size.height).toBeLessThanOrEqual(Math.round(800 * 0.72))
  })
})

describe('canvasConversationLayoutKey', () => {
  it('combines workspace and document identity and rejects blanks', () => {
    expect(canvasConversationLayoutKey('/ws', 'doc-1')).toBe('/ws::doc-1')
    expect(canvasConversationLayoutKey('  ', 'doc-1')).toBe('')
    expect(canvasConversationLayoutKey('/ws', ' ')).toBe('')
  })
})

describe('normalizeCanvasConversationLayout', () => {
  it('accepts finite coordinates and rounds them', () => {
    expect(normalizeCanvasConversationLayout({ open: true, minimized: false, x: 12.6, y: 40.2 }))
      .toEqual({ open: true, minimized: false, x: 13, y: 40, width: 420, height: 680 })
  })

  it('rejects missing or non-finite geometry', () => {
    expect(normalizeCanvasConversationLayout(null)).toBeNull()
    expect(normalizeCanvasConversationLayout({ x: 1 })).toBeNull()
    expect(normalizeCanvasConversationLayout({ x: Number.NaN, y: 2 })).toBeNull()
  })
})
