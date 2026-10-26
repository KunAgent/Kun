import { describe, expect, it } from 'vitest'
import {
  buildHtmlElementMapScript,
  hitTestHtmlElementMap,
  htmlElementBoxLabel,
  htmlElementMapBreadcrumb,
  htmlElementMapChain,
  htmlElementMapFirstChild,
  htmlElementMapLayersAt,
  htmlElementMapParent,
  htmlElementMapSibling,
  measureHtmlElementBoxes,
  normalizeHtmlElementMap
} from './html-element-map'

function raw(boxes: Record<string, unknown>[]): unknown {
  return { ok: true, token: 7, viewportWidth: 1000, viewportHeight: 800, boxes }
}

// page(shell) > card A (strong button inside), card B
const PAGE = { parent: -1, depth: 1, x: 0, y: 0, w: 1000, h: 800, tagName: 'div', shell: true }
const SECTION = { parent: 0, depth: 2, x: 20, y: 100, w: 600, h: 300, tagName: 'section' }
const CARD_A = { parent: 1, depth: 3, x: 30, y: 110, w: 280, h: 280, tagName: 'div', text: 'A' }
const BUTTON = { parent: 2, depth: 4, x: 50, y: 330, w: 100, h: 32, tagName: 'button', strong: true, text: 'Start' }
const CARD_B = { parent: 1, depth: 3, x: 330, y: 110, w: 280, h: 280, tagName: 'div', text: 'B' }

function map() {
  const result = normalizeHtmlElementMap(raw([PAGE, SECTION, CARD_A, BUTTON, CARD_B]))
  if (!result || result === 'unchanged') throw new Error('map expected')
  return result
}

describe('normalizeHtmlElementMap', () => {
  it('rejects failed payloads and reports unchanged pages', () => {
    expect(normalizeHtmlElementMap(null)).toBeNull()
    expect(normalizeHtmlElementMap({ ok: false })).toBeNull()
    expect(normalizeHtmlElementMap({ ok: true, unchanged: true, token: 3 })).toBe('unchanged')
  })

  it('keeps array positions as ids even when an entry is invalid', () => {
    const result = normalizeHtmlElementMap(raw([PAGE, { tagName: '' }, CARD_A]))
    expect(result).not.toBe('unchanged')
    const boxes = (result as { boxes: { id: number; w: number }[] }).boxes
    expect(boxes.map((box) => box.id)).toEqual([0, 1, 2])
    expect(boxes[1].w).toBe(0)
  })
})

describe('hitTestHtmlElementMap', () => {
  it('picks the deepest box under the pointer', () => {
    expect(hitTestHtmlElementMap(map(), { x: 60, y: 340 })?.tagName).toBe('button')
    expect(hitTestHtmlElementMap(map(), { x: 40, y: 120 })?.text).toBe('A')
    expect(hitTestHtmlElementMap(map(), { x: 340, y: 120 })?.text).toBe('B')
  })

  it('falls back to the shell only when nothing else is under the pointer', () => {
    expect(hitTestHtmlElementMap(map(), { x: 800, y: 700 })?.shell).toBe(true)
    expect(hitTestHtmlElementMap(map(), { x: 25, y: 105 })?.tagName).toBe('section')
  })

  it('never hits a box that has no area', () => {
    expect(hitTestHtmlElementMap(map(), { x: 5000, y: 5000 })).toBeNull()
  })
})

describe('element map navigation', () => {
  it('walks parent, child and sibling links', () => {
    const m = map()
    expect(htmlElementMapParent(m, 3)?.text).toBe('A')
    expect(htmlElementMapParent(m, 0)).toBeNull()
    expect(htmlElementMapFirstChild(m, 2)?.tagName).toBe('button')
    expect(htmlElementMapFirstChild(m, 3)).toBeNull()
    expect(htmlElementMapSibling(m, 2, 1)?.text).toBe('B')
    expect(htmlElementMapSibling(m, 4, 1)?.text).toBe('A')
    expect(htmlElementMapSibling(m, 4, -1)?.text).toBe('A')
    expect(htmlElementMapSibling(m, 3, 1)).toBeNull()
  })

  it('lists layers innermost first and builds a breadcrumb without the shell', () => {
    const m = map()
    expect(htmlElementMapLayersAt(m, { x: 60, y: 340 }).map((box) => box.id)).toEqual([3, 2, 1, 0])
    expect(htmlElementMapChain(m, 3).map((box) => box.id)).toEqual([3, 2, 1, 0])
    expect(htmlElementMapBreadcrumb(m, 3).map((crumb) => crumb.label)).toEqual(['Section', 'Div', 'Button'])
  })

  it('labels a box by its name and text', () => {
    expect(htmlElementBoxLabel(map().boxes[3])).toBe('Button · Start')
  })

  it('survives a parent cycle in a malformed payload', () => {
    const m = normalizeHtmlElementMap(raw([
      { ...CARD_A, parent: 1 }, { ...CARD_B, parent: 0 }
    ])) as ReturnType<typeof map>
    expect(htmlElementMapChain(m, 0).map((box) => box.id)).toEqual([0, 1])
  })
})

describe('measureHtmlElementBoxes', () => {
  it('measures the gap between separated boxes', () => {
    const lines = measureHtmlElementBoxes(
      { x: 30, y: 110, w: 280, h: 280 }, { x: 330, y: 110, w: 280, h: 280 }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ value: 20, y1: 250, y2: 250, x1: 310, x2: 330 })
  })

  it('measures all four insets when the target contains the selection', () => {
    const lines = measureHtmlElementBoxes(
      { x: 50, y: 330, w: 100, h: 32 }, { x: 30, y: 110, w: 280, h: 280 }
    )
    expect(lines.map((line) => line.value).sort((a, b) => a - b)).toEqual([20, 28, 160, 220])
  })

  it('draws nothing for touching boxes', () => {
    expect(measureHtmlElementBoxes({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toEqual([])
  })
})

describe('buildHtmlElementMapScript', () => {
  it('is syntactically valid and only skips unchanged pages when asked', () => {
    expect(() => new Function(`return ${buildHtmlElementMapScript(true)}`)).not.toThrow()
    expect(buildHtmlElementMapScript(true)).toContain('if (true && !state.dirty)')
    expect(buildHtmlElementMapScript(false)).toContain('if (false && !state.dirty)')
  })
})
