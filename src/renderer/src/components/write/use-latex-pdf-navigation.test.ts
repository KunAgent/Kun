// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWritePdfNavigation } from './use-write-pdf-navigation'

vi.mock('../../lib/knowledge-source-navigation', () => ({ subscribeKnowledgeSourceNavigation: () => () => {} }))
let root: Root
let host: HTMLDivElement
let nav: ReturnType<typeof useWritePdfNavigation>
const pageTexts: [] = []
const scrollerRef: { current: HTMLDivElement | null } = { current: null }
function Probe({ pdf, path = '/work/main.pdf', preserve = true }: { pdf: PDFDocumentProxy | null; path?: string; preserve?: boolean }) {
  nav = useWritePdfNavigation({ filePath: path, pdfDocument: pdf, pageCount: pdf?.numPages ?? 0, pageTexts, scrollerRef, preservePosition: preserve })
  return null
}
const pdf = (numPages = 10) => ({ numPages }) as PDFDocumentProxy
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  scrollerRef.current = null
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('LaTeX PDF position across compilation', () => {
  it('retains the current page through the loading state and a replacement document', async () => {
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    await act(async () => nav.scrollToPage(7))
    await act(async () => root.render(createElement(Probe, { pdf: null })))
    expect(nav.currentPage).toBe(7)
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    expect(nav.currentPage).toBe(7)
    expect(nav.pageInput).toBe('7')
  })

  it('clamps a preserved page when recompilation removes pages', async () => {
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    await act(async () => nav.scrollToPage(7))
    await act(async () => root.render(createElement(Probe, { pdf: pdf(3) })))
    expect(nav.currentPage).toBe(3)
  })

  it('resets for a different file and keeps normal PDF reader reload behavior', async () => {
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    await act(async () => nav.scrollToPage(7))
    await act(async () => root.render(createElement(Probe, { pdf: pdf(), path: '/work/other.pdf' })))
    expect(nav.currentPage).toBe(1)
    await act(async () => root.render(createElement(Probe, { pdf: pdf(), preserve: false })))
    await act(async () => nav.scrollToPage(7))
    await act(async () => root.render(createElement(Probe, { pdf: pdf(), preserve: false })))
    expect(nav.currentPage).toBe(1)
  })

  it.each([1, 2])('restores the within-page offset after hidden reload at UI scale %s', async (uiScale) => {
    let notifyResize = (): void => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe() {}
      disconnect() {}
    })
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'clientHeight', { value: 300 / uiScale })
    scrollerRef.current = scroller
    const scrollerRect = vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 300 } as DOMRect)
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    const page = document.createElement('div')
    const rect = vi.spyOn(page, 'getBoundingClientRect')
    Object.defineProperty(page, 'scrollIntoView', { value: vi.fn() })
    rect.mockReturnValue({ top: 20, bottom: 1020, height: 1000 } as DOMRect)
    nav.pageRefs.current.set(7, page)
    await act(async () => nav.scrollToPage(7))
    await act(async () => {
      nav.schedulePageSync()
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(nav.currentPage).toBe(7)
    await act(async () => root.render(createElement(Probe, { pdf: pdf() })))
    scroller.scrollTop = 0
    scrollerRect.mockReturnValue({ top: 0, height: 0 } as DOMRect)
    rect.mockReturnValue({ top: 500, bottom: 1300, height: 800 } as DOMRect)
    await act(async () => {
      for (let number = 1; number <= 7; number++) nav.onPageViewport(number, { width: 600, height: 800 })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(scroller.scrollTop).toBe(0)
    scrollerRect.mockReturnValue({ top: 100, height: 300 } as DOMRect)
    await act(async () => { notifyResize(); await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(scroller.scrollTop).toBe(464 / uiScale)
    expect(nav.currentPage).toBe(7)
  })
})
