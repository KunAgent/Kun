// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { COMPOSER_TOOLBAR_FIT_LEVELS, fitComposerToolbar } from './composer-toolbar-fit'

/**
 * jsdom has no layout, so each fake element reports the geometry it would have
 * at a given level. The level a toolbar settles on must be the smallest one
 * whose geometry fits.
 */
function box(left: number, right: number): DOMRect {
  return { left, right, top: 0, bottom: 10, width: right - left, height: 10, x: left, y: 0, toJSON: () => ({}) }
}

function toolbarFor(fitsAt: number): HTMLElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'ds-composer-toolbar'
  const actions = document.createElement('div')
  actions.className = 'ds-composer-toolbar-actions'
  const send = document.createElement('button')
  actions.append(send)
  toolbar.append(actions)
  document.body.append(toolbar)
  const level = (): number => [...Array(COMPOSER_TOOLBAR_FIT_LEVELS).keys()]
    .filter((index) => toolbar.hasAttribute(`data-fit-${index + 1}`)).length
  Object.defineProperty(toolbar, 'clientWidth', { value: 200 })
  toolbar.getBoundingClientRect = () => box(0, 200)
  actions.getBoundingClientRect = () => box(0, 200)
  // The send button is pushed off the right edge until the toolbar fits.
  send.getBoundingClientRect = () => (level() >= fitsAt ? box(160, 200) : box(180, 260))
  // jsdom reports no client rects at all; mark the controls as rendered.
  for (const element of [toolbar, actions, send]) {
    element.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList
  }
  return toolbar
}

describe('fitComposerToolbar', () => {
  afterEach(() => { document.body.replaceChildren() })

  it('keeps every word while the toolbar already fits', () => {
    const toolbar = toolbarFor(0)
    expect(fitComposerToolbar(toolbar)).toBe(0)
    expect(toolbar.hasAttribute('data-fit-1')).toBe(false)
  })

  it('settles on the smallest level that fits, with the lower levels still applied', () => {
    const toolbar = toolbarFor(3)
    expect(fitComposerToolbar(toolbar)).toBe(3)
    expect([1, 2, 3, 4].map((step) => toolbar.hasAttribute(`data-fit-${step}`))).toEqual([true, true, true, false])
  })

  it('stops at the last level when nothing fits, and relaxes again from level 0', () => {
    const toolbar = toolbarFor(99)
    expect(fitComposerToolbar(toolbar)).toBe(COMPOSER_TOOLBAR_FIT_LEVELS)
    const wide = toolbarFor(0)
    wide.setAttribute('data-fit-4', '')
    expect(fitComposerToolbar(wide)).toBe(0)
    expect(wide.hasAttribute('data-fit-4')).toBe(false)
  })

  it('leaves a hidden toolbar alone', () => {
    const toolbar = document.createElement('div')
    toolbar.setAttribute('data-fit-2', '')
    expect(fitComposerToolbar(toolbar)).toBe(0)
    expect(toolbar.hasAttribute('data-fit-2')).toBe(true)
  })
})
