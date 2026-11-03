import { describe, expect, it } from 'vitest'
import {
  HTML_ELEMENT_PICK_MAX_CHAIN,
  buildHtmlElementPickScript,
  buildHtmlElementResolveScript,
  htmlElementCandidateLabel,
  htmlElementPickPathLabels,
  htmlElementPickResolvedStillMatches,
  htmlElementSelectionCanDrillToHit,
  normalizeHtmlElementPickResult,
  resolveHtmlElementPickSelection,
  type HtmlElementPickCandidate,
  type HtmlElementPickRect
} from './html-element-pick'

const rect = (width = 120, height = 32, left = 10, top = 20): HtmlElementPickRect => ({
  left,
  top,
  width,
  height
})

function candidate(
  tagName: string,
  overrides: Partial<HtmlElementPickCandidate> = {}
): HtmlElementPickCandidate {
  return {
    tagName,
    selector: `${tagName}-selector`,
    selectorIsUnique: true,
    rect: rect(),
    text: '',
    html: `<${tagName}></${tagName}>`,
    editableText: false,
    ...overrides
  }
}

function chainOf(chain: HtmlElementPickCandidate[], viewport = { width: 1280, height: 800 }) {
  return {
    hitTagName: chain[0]?.tagName ?? '',
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    chain
  }
}

describe('resolveHtmlElementPickSelection', () => {
  it('promotes a click on an icon inside a button to the whole button', () => {
    const button = candidate('button', { text: '接管', selector: '#primary-action' })
    const selection = resolveHtmlElementPickSelection(chainOf([
      candidate('svg', { selector: 'svg-path' }),
      candidate('span', { text: '接管' }),
      button,
      candidate('div', { rect: rect(600, 400) })
    ]))

    expect(selection?.element.selector).toBe('#primary-action')
    expect(htmlElementCandidateLabel(selection!.element)).toBe('Button · 接管')
    expect(htmlElementSelectionCanDrillToHit(selection!)).toBe(true)
  })

  it('keeps plain text selectable when no component ancestor exists', () => {
    const paragraph = candidate('p', { text: '本轮记录', editableText: true })
    const selection = resolveHtmlElementPickSelection(chainOf([
      paragraph,
      candidate('div', { rect: rect(600, 400) }),
      candidate('main', { rect: rect(1200, 700) })
    ]))

    expect(selection?.element.tagName).toBe('p')
    expect(htmlElementCandidateLabel(selection!.element)).toBe('Text · 本轮记录')
    expect(htmlElementSelectionCanDrillToHit(selection!)).toBe(false)
  })

  it('treats ARIA roles and source ids as components', () => {
    const roleSelection = resolveHtmlElementPickSelection(chainOf([
      candidate('div', { role: 'button', ariaLabel: '停止', text: '停止' })
    ]))
    expect(htmlElementCandidateLabel(roleSelection!.element)).toBe('Button · 停止')

    const sourceSelection = resolveHtmlElementPickSelection(chainOf([
      candidate('div', { sourceId: 'src-42', selector: '[data-kun-source-id="src-42"]' })
    ]))
    expect(sourceSelection?.element.sourceId).toBe('src-42')
  })

  it('ignores page-sized layout containers as component roots', () => {
    const selection = resolveHtmlElementPickSelection(chainOf([
      candidate('span', { text: '标题' }),
      candidate('div', {
        selector: 'body-wrapper',
        rect: rect(1280, 800, 0, 0)
      }),
      candidate('section', { rect: rect(1260, 780, 10, 10) })
    ]))

    expect(selection?.element.tagName).toBe('span')
    expect(selection?.ancestors).toHaveLength(0)
  })

  it('records ancestors inner-to-outer and drops invisible ones', () => {
    const selection = resolveHtmlElementPickSelection(chainOf([
      candidate('button', { text: '立即派发' }),
      candidate('div', { rect: rect(0, 0) }),
      candidate('section', { rect: rect(320, 180) }),
      candidate('div', { rect: rect(640, 400) })
    ]))

    expect(selection?.ancestors.map((entry) => entry.tagName)).toEqual(['section', 'div'])
  })
})

describe('htmlElementPickPathLabels', () => {
  it('renders a short outer-to-inner path', () => {
    const selection = resolveHtmlElementPickSelection(chainOf([
      candidate('button', { text: '接管' }),
      candidate('div', { role: 'group' })
    ]))
    expect(htmlElementPickPathLabels(selection!)).toEqual(['Div', 'Button'])
  })

  it('collapses long paths in the middle', () => {
    const selection = resolveHtmlElementPickSelection(chainOf([
      candidate('button', { text: '接管' }),
      candidate('div'),
      candidate('section'),
      candidate('article'),
      candidate('main')
    ]))
    expect(htmlElementPickPathLabels(selection!)).toEqual(['Main', '…', 'Div', 'Button'])
  })
})

describe('normalizeHtmlElementPickResult', () => {
  it('rejects payloads without a usable chain', () => {
    expect(normalizeHtmlElementPickResult(null)).toBeNull()
    expect(normalizeHtmlElementPickResult({ ok: true })).toBeNull()
    expect(normalizeHtmlElementPickResult({ ok: true, chain: [] })).toBeNull()
    expect(normalizeHtmlElementPickResult({ ok: true, chain: [{ tagName: 'button' }] })).toBeNull()
  })

  it('bounds text, html and chain length', () => {
    const long = 'x'.repeat(5000)
    const result = normalizeHtmlElementPickResult({
      hitTagName: 'BUTTON',
      viewportWidth: 1280,
      viewportHeight: 800,
      chain: Array.from({ length: 40 }, (_, index) => ({
        tagName: 'BUTTON',
        selector: `button:nth-of-type(${index + 1})`,
        selectorIsUnique: true,
        rect: { left: 1, top: 2, width: 30, height: 30 },
        text: long,
        html: long,
        editableText: true
      }))
    })

    expect(result?.hitTagName).toBe('button')
    expect(result?.chain).toHaveLength(HTML_ELEMENT_PICK_MAX_CHAIN)
    expect(result?.chain[0].text.length).toBeLessThanOrEqual(300)
    expect(result?.chain[0].html.length).toBeLessThanOrEqual(1200)
  })

  it('drops candidates with broken rects instead of rendering a ghost box', () => {
    const result = normalizeHtmlElementPickResult({
      chain: [
        {
          tagName: 'button',
          selector: 'button',
          rect: { left: Number.NaN, top: 0, width: 10, height: 10 }
        },
        {
          tagName: 'a',
          selector: 'a',
          rect: { left: 0, top: 0, width: 10, height: 10 }
        }
      ]
    })

    expect(result?.chain.map((entry) => entry.tagName)).toEqual(['a'])
  })

  it('keeps component metadata used by the composer chip', () => {
    const result = normalizeHtmlElementPickResult({
      chain: [{
        tagName: 'button',
        selector: '[data-kun-source-id="save"]',
        selectorIsUnique: true,
        rect: { left: 0, top: 0, width: 80, height: 30 },
        text: '  保存  ',
        html: '<button>保存</button>',
        editableText: true,
        componentName: 'PrimaryButton',
        sourceId: 'save',
        role: 'button',
        ariaLabel: '保存'
      }]
    })

    expect(result?.chain[0]).toMatchObject({
      componentName: 'PrimaryButton',
      sourceId: 'save',
      role: 'button',
      text: '保存'
    })
  })
})

describe('pick scripts', () => {
  it('queries the guest document at the scaled canvas point', () => {
    const script = buildHtmlElementPickScript({ x: 12.4, y: 33.6 })
    expect(script).toContain('document.elementFromPoint(12, 34)')
    expect(script).toContain('data-kun-source-id')
    expect(script).toContain("input[type='password']".replace(/'/g, '"'))
  })

  it('escapes selectors when re-resolving after a reload', () => {
    const script = buildHtmlElementResolveScript('button[data-x="a\\b"]')
    expect(script).toContain(JSON.stringify('button[data-x="a\\b"]'))
  })
})

describe('htmlElementPickResolvedStillMatches', () => {
  it('requires the same selector and tag', () => {
    const previous = candidate('button', { selector: '#save' })
    expect(htmlElementPickResolvedStillMatches(previous, chainOf([
      candidate('button', { selector: '#save' })
    ]))).toBe(true)
    expect(htmlElementPickResolvedStillMatches(previous, chainOf([
      candidate('a', { selector: '#save' })
    ]))).toBe(false)
    expect(htmlElementPickResolvedStillMatches(previous, chainOf([
      candidate('button', { selector: '#cancel' })
    ]))).toBe(false)
  })

  it('rejects an element that collapsed to zero size', () => {
    const previous = candidate('button', { selector: '#save' })
    expect(htmlElementPickResolvedStillMatches(previous, chainOf([
      candidate('button', { selector: '#save', rect: rect(0, 0) })
    ]))).toBe(false)
  })
})
