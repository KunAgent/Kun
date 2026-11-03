import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachDocxDragSelection,
  textPointAt,
  type CaretFromPoint,
  type CaretPoint
} from './workspace-docx-drag-selection'

type Box = { left: number; top: number; right: number; bottom: number }

describe('workspace docx drag selection', () => {
  let dom: JSDOM
  let root: HTMLElement
  let page: HTMLElement
  let texts: Text[]
  let boxes: Box[]

  function run(text: string, box: Box): Text {
    const span = document.createElement('span')
    span.setAttribute('data-docx-text-start', '0')
    const node = document.createTextNode(text)
    span.append(node)
    const rect = { ...box, width: box.right - box.left, height: box.bottom - box.top }
    Object.defineProperty(span, 'getClientRects', { value: () => [rect] })
    page.append(span)
    boxes.push(box)
    return node
  }

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    root = document.createElement('div')
    page = document.createElement('div')
    page.setAttribute('data-docx-page-wrapper', 'true')
    root.append(page)
    document.body.append(root)
    boxes = []
    texts = [
      run('Heading', { left: 100, top: 100, right: 220, bottom: 130 }),
      run('First line', { left: 100, top: 140, right: 200, bottom: 158 }),
      run('Second line', { left: 100, top: 160, right: 210, bottom: 178 })
    ]
  })

  afterEach(() => {
    dom.window.close()
    vi.unstubAllGlobals()
  })

  /** Blank space resolves to the paragraph start, like the real viewer; text resolves to text. */
  function resolver(): CaretFromPoint & ReturnType<typeof vi.fn> {
    return vi.fn((x: number, y: number): CaretPoint | null => {
      const row = boxes.findIndex((box) => y >= box.top && y <= box.bottom)
      const rect = row < 0 ? null : boxes[row]!
      if (!rect || x < rect.left || x > rect.right) return { node: page, offset: 0 }
      return { node: texts[row]!, offset: Math.round(((x - rect.left) / (rect.right - rect.left)) * texts[row]!.length) }
    }) as CaretFromPoint & ReturnType<typeof vi.fn>
  }

  it('keeps a pointer that already resolves to text', () => {
    expect(textPointAt(root, 150, 150, resolver())).toEqual({ node: texts[1], offset: 5 })
  })

  it('pulls a pointer right of a line back to the end of that line', () => {
    const resolve = resolver()
    expect(textPointAt(root, 600, 150, resolve)).toEqual({ node: texts[1], offset: 10 })
    expect(resolve).toHaveBeenLastCalledWith(199, 149)
  })

  it('pulls a pointer left of a line to its start', () => {
    expect(textPointAt(root, 10, 168, resolver())).toEqual({ node: texts[2], offset: 0 })
  })

  it('picks the nearest line vertically when the pointer is in the gap or below the text', () => {
    expect(textPointAt(root, 500, 137, resolver())?.node).toBe(texts[1])
    expect(textPointAt(root, 500, 900, resolver())?.node).toBe(texts[2])
  })

  it('has no position on a page without text', () => {
    page.replaceChildren()
    expect(textPointAt(root, 600, 150, resolver())).toBeNull()
  })

  describe('dragging', () => {
    let selection: { rangeCount: number; collapse: ReturnType<typeof vi.fn>; extend: ReturnType<typeof vi.fn> }
    let frames: Array<() => void>
    let pane: HTMLElement & { scrollTop: number }
    let detach: () => void

    const mouse = (type: string, init: Record<string, unknown> = {}): MouseEvent =>
      new (dom.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    const runFrame = (): void => {
      const pending = frames.splice(0)
      for (const callback of pending) callback()
    }
    const down = (init: Record<string, unknown> = {}): MouseEvent => {
      const event = mouse('mousedown', { button: 0, detail: 1, clientX: 120, clientY: 150, ...init })
      root.dispatchEvent(event)
      return event
    }
    const move = (x: number, y: number): void => {
      document.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: x, clientY: y }))
    }

    beforeEach(() => {
      selection = { rangeCount: 1, collapse: vi.fn(), extend: vi.fn() }
      document.getSelection = () => selection as unknown as Selection
      frames = []
      Object.assign(dom.window, {
        requestAnimationFrame: (callback: () => void) => frames.push(callback),
        cancelAnimationFrame: () => { frames = [] }
      })
      pane = document.createElement('div') as HTMLElement & { scrollTop: number }
      pane.scrollTop = 500
      pane.getBoundingClientRect = () => ({ left: 0, top: 50, right: 400, bottom: 400, width: 400, height: 350 }) as DOMRect
      detach = attachDocxDragSelection(root, () => pane, resolver())
    })

    afterEach(() => detach())

    it('anchors on mouse down and takes the drag away from the browser', () => {
      const event = down()
      expect(event.defaultPrevented).toBe(true)
      expect(selection.collapse).toHaveBeenCalledWith(texts[1], 2)
    })

    it('follows the pointer each frame, also across the blank right of a line', () => {
      down()
      move(600, 168)
      runFrame()
      // x is held inside the pane, which ends at 400, so the line's end is reached.
      expect(selection.extend).toHaveBeenLastCalledWith(texts[2], 11)
      selection.extend.mockClear()
      runFrame()
      expect(selection.extend).not.toHaveBeenCalled()

      move(140, 120)
      runFrame()
      expect(selection.extend).toHaveBeenLastCalledWith(texts[0], 2)
    })

    it('applies the release position and then stops following', () => {
      down()
      document.dispatchEvent(mouse('mouseup', { clientX: 300, clientY: 168 }))
      expect(selection.extend).toHaveBeenLastCalledWith(texts[2], 11)
      selection.extend.mockClear()
      move(130, 120)
      runFrame()
      expect(selection.extend).not.toHaveBeenCalled()
    })

    it('scrolls the pane while the pointer is above or below it', () => {
      down()
      move(150, 600)
      runFrame()
      expect(pane.scrollTop).toBeGreaterThan(500)
      const below = pane.scrollTop
      move(150, 0)
      runFrame()
      expect(pane.scrollTop).toBeLessThan(below)
      move(150, 160)
      const inside = pane.scrollTop
      runFrame()
      expect(pane.scrollTop).toBe(inside)
    })

    it('leaves other clicks to the browser', () => {
      expect(down({ button: 2 }).defaultPrevented).toBe(false)
      expect(down({ detail: 2 }).defaultPrevented).toBe(false)
      expect(down({ shiftKey: true }).defaultPrevented).toBe(false)
      expect(down({ metaKey: true }).defaultPrevented).toBe(false)
      const link = document.createElement('a')
      link.setAttribute('href', 'https://example.com')
      root.append(link)
      const onLink = mouse('mousedown', { button: 0, detail: 1, clientX: 120, clientY: 150 })
      link.dispatchEvent(onLink)
      expect(onLink.defaultPrevented).toBe(false)
      expect(selection.collapse).not.toHaveBeenCalled()
    })

    it('stops when the button is no longer held or the preview goes away', () => {
      down()
      document.dispatchEvent(mouse('mousemove', { buttons: 0, clientX: 130, clientY: 168 }))
      selection.extend.mockClear()
      move(130, 168)
      runFrame()
      expect(selection.extend).not.toHaveBeenCalled()

      down()
      detach()
      move(130, 168)
      runFrame()
      expect(selection.extend).not.toHaveBeenCalled()
    })
  })
})
