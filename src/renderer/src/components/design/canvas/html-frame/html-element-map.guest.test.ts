// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { buildHtmlElementMapScript, normalizeHtmlElementMap } from './html-element-map'
import { buildHtmlElementBoxPickScript, normalizeHtmlElementPickResult } from './html-element-pick'

// jsdom has no layout: every element states its box as data-rect="x,y,w,h".
const realRect = Element.prototype.getBoundingClientRect
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  delete (window as unknown as Record<string, unknown>).__kunPickMap
  document.body.innerHTML = ''
})

function mount(html: string): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const [x, y, w, h] = (this.getAttribute('data-rect') ?? '0,0,0,0').split(',').map(Number)
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) } as DOMRect
  }
  document.body.innerHTML = html
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
}

function run(onlyIfDirty = false): ReturnType<typeof normalizeHtmlElementMap> {
  return normalizeHtmlElementMap(new Function(`return ${buildHtmlElementMapScript(onlyIfDirty)}`)())
}

const PAGE = `
<div data-rect="0,0,1000,800" id="page" style="background:#fafafa">
  <div data-rect="20,100,600,300" style="background:#eee">
    <div data-rect="20,100,600,300"><!-- same-size wrapper -->
      <div data-rect="30,110,280,280" style="background:#fff" id="a">
        Card A
        <button data-rect="50,330,100,32"><span data-rect="60,336,40,16">Start</span></button>
      </div>
    </div>
  </div>
  <input type="password" data-rect="700,100,200,30" value="secret">
  <div data-rect="700,200,100,100" style="display:none">hidden</div>
</div>`

describe('element map guest script', () => {
  it('keeps meaningful boxes, collapses buttons and drops same-size wrappers', () => {
    mount(PAGE)
    const map = run()
    if (!map || map === 'unchanged') throw new Error('map expected')
    const names = map.boxes.map((box) => `${box.tagName}:${box.w}x${box.h}`)
    expect(names).toContain('button:100x32')
    expect(names).not.toContain('span:40x16')
    // the unstyled 600x300 wrapper adds nothing over the styled one it wraps
    expect(map.boxes.filter((box) => box.w === 600 && box.h === 300)).toHaveLength(1)
    expect(map.boxes.find((box) => box.tagName === 'button')?.strong).toBe(true)
    const card = map.boxes.find((box) => box.w === 280)!
    const parent = map.boxes[card.parent]
    expect(parent.w).toBe(600)
    expect(map.boxes.find((box) => box.tagName === 'button')?.parent).toBe(card.id)
  })

  it('never reports password fields or display:none subtrees', () => {
    mount(PAGE)
    const map = run()
    if (!map || map === 'unchanged') throw new Error('map expected')
    expect(map.boxes.some((box) => box.tagName === 'input')).toBe(false)
    expect(map.boxes.some((box) => box.x === 700)).toBe(false)
  })

  it('marks viewport-sized containers as shell', () => {
    mount(PAGE)
    const map = run()
    if (!map || map === 'unchanged') throw new Error('map expected')
    expect(map.boxes.find((box) => box.w === 1000)?.shell).toBe(true)
  })

  it('answers an unchanged page with a tiny payload until the page mutates', async () => {
    mount(PAGE)
    expect(run()).not.toBe('unchanged')
    expect(run(true)).toBe('unchanged')
    document.getElementById('a')!.setAttribute('data-x', '1')
    await new Promise((done) => setTimeout(done, 0))
    expect(run(true)).not.toBe('unchanged')
  })

  it('selects the element behind a box id, and refuses a stale token', () => {
    mount(PAGE)
    const map = run()
    if (!map || map === 'unchanged') throw new Error('map expected')
    const button = map.boxes.find((box) => box.tagName === 'button')!
    const evaluate = (id: number, token: number): unknown =>
      new Function(`return ${buildHtmlElementBoxPickScript(id, token)}`)()
    const chain = normalizeHtmlElementPickResult(evaluate(button.id, map.token))
    expect(chain?.chain[0].tagName).toBe('button')
    expect(chain?.chain.length).toBeGreaterThan(1)
    expect(evaluate(button.id, map.token + 1)).toMatchObject({ ok: false, reason: 'stale' })
  })
})
