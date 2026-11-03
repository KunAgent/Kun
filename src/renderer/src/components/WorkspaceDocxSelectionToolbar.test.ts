import { createElement, createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceDocxSelectionToolbar,
  documentSelectionToolbarPosition,
  selectedDocxPageRange
} from './WorkspaceDocxSelectionToolbar'

function docxPage(index: number, text: string): HTMLElement {
  const page = document.createElement('div')
  page.setAttribute('data-docx-page-wrapper', 'true')
  page.dataset.docxPageIndex = String(index)
  page.textContent = text
  return page
}

describe('WorkspaceDocxSelectionToolbar', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let body: HTMLDivElement
  let viewport: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('Event', dom.window.document.createEvent('Event').constructor)
    body = document.createElement('div')
    viewport = document.createElement('div')
    viewport.append(body)
    document.body.append(viewport)
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 360 })
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 360, bottom: 500, width: 360, height: 500 })
    })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('offers quote and copy actions for selected Word text', async () => {
    const page = docxPage(0, 'First page text')
    body.append(page)
    const range = document.createRange()
    range.setStart(page.firstChild!, 0)
    range.setEnd(page.firstChild!, 10)
    Object.defineProperty(range, 'getClientRects', {
      configurable: true,
      value: () => [{ left: 20, right: 140, top: 80, bottom: 98, width: 120, height: 18 }]
    })
    const bodyRef = createRef<HTMLDivElement>()
    const scrollRef = createRef<HTMLDivElement>()
    bodyRef.current = body
    scrollRef.current = viewport
    const onQuoteSelection = vi.fn(async () => true)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => {
      renderer = create(createElement(WorkspaceDocxSelectionToolbar, {
        bodyRef,
        scrollRef,
        sourceName: 'fixture.docx',
        sourceSha256: 'a'.repeat(64),
        onQuoteSelection
      }))
    })
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
    })

    await act(async () => {
      await renderer!.root.findByProps({ 'data-docx-copy-selection': true }).props.onClick()
    })
    expect(writeText).toHaveBeenCalledWith('First page')
    await act(async () => {
      await renderer!.root.findByProps({ 'data-docx-quote-selection': true }).props.onClick()
    })
    expect(onQuoteSelection).toHaveBeenCalledWith(expect.objectContaining({
      sourceName: 'fixture.docx',
      pageStart: 1,
      pageEnd: 1,
      text: 'First page'
    }))
    expect(window.getSelection()?.rangeCount).toBe(0)
  })

  it('computes cross-page metadata and clamps the toolbar to its viewport', () => {
    const first = docxPage(0, 'First')
    const second = docxPage(1, 'Second')
    body.append(first, second)
    const range = document.createRange()
    range.setStart(first.firstChild!, 1)
    range.setEnd(second.firstChild!, 2)

    expect(selectedDocxPageRange(range, body)).toEqual({ pageStart: 1, pageEnd: 2 })
    expect(documentSelectionToolbarPosition(
      { left: -50, right: 10, top: 12, bottom: 30, width: 60 },
      { left: 0, top: 0 },
      { scrollLeft: 20, scrollTop: 40, viewportWidth: 360 }
    )).toEqual({ left: 124, top: 70, placement: 'below' })
  })

  it('converts screen-pixel rects to layout pixels when the app is zoomed', () => {
    // Body zoom 0.5: a rect 100px from the pane's left is 200 layout px in.
    expect(documentSelectionToolbarPosition(
      { left: 100, right: 160, top: 100, bottom: 112, width: 60 },
      { left: 0, top: 0 },
      { scrollLeft: 0, scrollTop: 30, viewportWidth: 800, scale: 0.5 }
    )).toEqual({ left: 260, top: 230, placement: 'above' })
    expect(documentSelectionToolbarPosition(
      { left: 100, right: 160, top: 20, bottom: 32, width: 60 },
      { left: 0, top: 0 },
      { scrollLeft: 0, scrollTop: 30, viewportWidth: 800, scale: 0.5 }
    )).toEqual({ left: 260, top: 94, placement: 'below' })
  })
})
