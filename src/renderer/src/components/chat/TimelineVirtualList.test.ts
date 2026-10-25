// @vitest-environment jsdom
import { act, createElement, useRef, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineVirtualList } from './TimelineVirtualList'
import { useTimelineRowState } from './timeline-row-state'
import { revealVirtualTimelineBlock } from './timeline-virtual-navigation'

type Row = { id: string; pending?: boolean }
const key = (row: Row): string => row.id
const keep = (row: Row): boolean => row.pending === true
const contains = (row: Row, blockId: string): boolean => row.id === blockId
const rows: Row[] = Array.from({ length: 1_000 }, (_, index) => ({ id: `row-${index}`, pending: index === 5 }))
const observers = new Set<TestResizeObserver>()

class TestResizeObserver {
  nodes = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this) }
  observe(node: Element): void { this.nodes.add(node) }
  unobserve(node: Element): void { this.nodes.delete(node) }
  disconnect(): void { this.nodes.clear(); observers.delete(this) }
}

function resize(node: HTMLElement, height = node.offsetHeight): void {
  for (const observer of [...observers]) {
    if (observer.nodes.has(node)) observer.callback([{
      target: node, borderBoxSize: [{ blockSize: height, inlineSize: 800 }],
      contentRect: { height, width: 800 }
    } as unknown as ResizeObserverEntry], observer as unknown as ResizeObserver)
  }
}

function RowContent({ row }: { row: Row }): ReactElement {
  const [open, setOpen] = useTimelineRowState('detail', false)
  return createElement('button', { 'data-row-content': row.id, onClick: () => setOpen(!open) },
    `${row.id}${open ? ' expanded' : ''}`)
}

function Fixture({ twoLists = false, secondOffset = 40_000, data = rows }: {
  twoLists?: boolean; secondOffset?: number; data?: Row[]
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const list = (offset: number, id: string): ReactElement => createElement('section', {
    'data-list-offset': offset, 'data-list-name': id, key: id
  }, createElement(TimelineVirtualList<Row>, {
    items: data, viewportRef, itemKey: key, keepMounted: keep, containsBlock: contains,
    children: (row) => createElement(RowContent, { row })
  }))
  return createElement('div', { ref: viewportRef, 'data-viewport': true },
    createElement('div', { 'data-turn-id': 'test-turn' }, list(0, 'first'),
      twoLists ? list(secondOffset, 'second') : null))
}

describe('TimelineVirtualList with the shared timeline scroller', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    // jsdom does not compute CSS zoom, so model its browser CSSOM value too.
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
      const style = getComputedStyle(element, pseudoElement)
      return element === document.body ? Object.assign(style, { zoom: document.body.style.zoom || '1' }) : style
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-viewport') ? 320 : 40
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80_000)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const viewport = this.closest<HTMLElement>('[data-viewport]')
      const offset = Number(this.closest<HTMLElement>('[data-list-offset]')?.dataset.listOffset ?? 0)
      const zoom = Number.parseFloat(document.body.style.zoom) || 1
      const top = this.hasAttribute('data-viewport') ? 0 : (offset - (viewport?.scrollTop ?? 0)) * zoom
      return { top, bottom: top + 40 * zoom, height: 40 * zoom, width: 800, left: 0, right: 800, x: 0, y: top, toJSON: () => ({}) }
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        this.scrollTop = options.top ?? 0
        this.dispatchEvent(new Event('scroll'))
      } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.zoom = ''
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
    observers.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const mounted = (scope: ParentNode): Element[] => [...scope.querySelectorAll('[data-row-content]')]
  const scroll = async (top: number): Promise<void> => {
    await act(async () => container.querySelector<HTMLElement>('[data-viewport]')!.scrollTo({ top }))
  }

  it('mounts a bounded viewport of 1000 records and keeps an offscreen pending control interactive', async () => {
    await act(async () => root.render(createElement(Fixture)))
    expect(mounted(container).length).toBeLessThan(30)
    await scroll(20_000)
    expect(container.querySelector('[data-row-content="row-500"]')).not.toBeNull()
    expect(container.querySelector('[data-row-content="row-0"]')).toBeNull()
    expect(mounted(container).length).toBeLessThan(30)
    const pending = container.querySelector<HTMLButtonElement>('[data-row-content="row-5"]')!
    await act(async () => pending.click())
    expect(pending.textContent).toBe('row-5 expanded')
  })

  it('restores expansion after viewport eviction and does not move a reader when records append', async () => {
    await act(async () => root.render(createElement(Fixture)))
    await scroll(20_000)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-row-content="row-500"]')!.click())
    await scroll(30_000)
    expect(container.querySelector('[data-row-content="row-500"]')).toBeNull()
    await scroll(20_000)
    expect(container.querySelector('[data-row-content="row-500"]')?.textContent).toBe('row-500 expanded')
    await act(async () => root.render(createElement(Fixture, { data: [...rows, { id: 'row-1000' }] })))
    expect(container.querySelector<HTMLElement>('[data-viewport]')!.scrollTop).toBe(20_000)
    expect(mounted(container).length).toBeLessThan(30)
  })

  it('measures each sibling list relative to the shared viewport after a preceding layout change', async () => {
    await act(async () => root.render(createElement(Fixture, { twoLists: true })))
    await scroll(52_000)
    const second = container.querySelector('[data-list-name="second"]')!
    expect(second.querySelector('[data-row-content="row-300"]')).not.toBeNull()
    await act(async () => root.render(createElement(Fixture, { twoLists: true, secondOffset: 41_000 })))
    await act(async () => resize(container.querySelector<HTMLElement>('[data-list-name="second"]')!))
    expect(second.querySelector('[data-row-content="row-275"]')).not.toBeNull()
    expect(second.querySelector('[data-row-content="row-300"]')).toBeNull()
    expect(mounted(container).length).toBeLessThan(45)
  })

  it.each([0.82, 1, 1.2])('keeps the visible records and tail mounted at %s body zoom', async (zoom) => {
    document.body.style.zoom = String(zoom)
    await act(async () => root.render(createElement(Fixture, { twoLists: true })))
    const second = container.querySelector('[data-list-name="second"]')!
    await scroll(52_000)
    expect(second.querySelector('[data-row-content="row-300"]')).not.toBeNull()
    await scroll(79_680)
    expect(second.querySelector('[data-row-content="row-999"]')).not.toBeNull()
    expect(mounted(container).length).toBeLessThan(45)
  })

  it('preserves the reading anchor when a measured overscan row above the viewport grows', async () => {
    await act(async () => root.render(createElement(Fixture)))
    await scroll(20_000)
    const row = container.querySelector<HTMLElement>('[data-timeline-virtual-row="row-496"]')!
    await act(async () => resize(row, 100))
    expect(container.querySelector<HTMLElement>('[data-viewport]')!.scrollTop).toBe(20_060)
  })

  it('reveals a find result that is currently outside the mounted window', async () => {
    await act(async () => root.render(createElement(Fixture)))
    expect(container.querySelector('[data-row-content="row-700"]')).toBeNull()
    await act(async () => {
      expect(revealVirtualTimelineBlock(container.querySelector<HTMLElement>('[data-turn-id]')!, 'row-700')).toBe(true)
    })
    expect(container.querySelector('[data-row-content="row-700"]')).not.toBeNull()
  })
})
