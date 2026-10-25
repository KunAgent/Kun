import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readTimelineSelection,
  selectionToolbarPlacement,
  type RectLike
} from './timeline-selection'

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const bounds = rect(100, 50, 600, 500)
const toolbar = { width: 200, height: 36 }

describe('selectionToolbarPlacement', () => {
  it('centers the toolbar above the first selected line', () => {
    expect(selectionToolbarPlacement({
      lineRects: [rect(300, 200, 120, 20), rect(110, 222, 400, 20)],
      bounds,
      toolbar
    })).toEqual({ left: 260, top: 156, placement: 'above' })
  })

  it('flips below the last visible line when the top is too close', () => {
    expect(selectionToolbarPlacement({
      lineRects: [rect(300, 60, 100, 20), rect(120, 82, 300, 20)],
      bounds,
      toolbar
    })).toEqual({ left: 170, top: 110, placement: 'below' })
  })

  it('clamps to the viewport edges', () => {
    const placed = selectionToolbarPlacement({
      lineRects: [rect(102, 300, 10, 20)],
      bounds,
      toolbar
    })
    expect(placed?.left).toBe(108)
    const right = selectionToolbarPlacement({
      lineRects: [rect(690, 300, 8, 20)],
      bounds,
      toolbar
    })
    expect(right?.left).toBe(492)
  })

  it('hides once the selection scrolls out of view', () => {
    expect(selectionToolbarPlacement({
      lineRects: [rect(200, -80, 100, 20), rect(200, 600, 100, 20)],
      bounds,
      toolbar
    })).toBeNull()
  })
})

describe('readTimelineSelection', () => {
  let dom: JSDOM
  let root: HTMLDivElement

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><body><div id="root">
      <div class="ds-user-message" data-timeline-block-id="user_1">
        <div class="ds-user-message-bubble"><div id="user-text">How do I migrate?</div></div>
      </div>
      <div data-timeline-block-id="item_2">
        <div class="ds-markdown"><p id="answer">Remote agents depend on host scheduling.</p></div>
        <textarea id="editor">draft</textarea>
      </div>
      <div id="chrome">Run 5 commands</div>
    </div><p id="outside">outside text</p></body>`)
    const win = dom.window as unknown as Window & typeof globalThis
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', win.document)
    vi.stubGlobal('Node', win.Node)
    win.Range.prototype.getClientRects = function getClientRects() {
      return [{ left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 }] as unknown as DOMRectList
    }
    root = dom.window.document.getElementById('root') as HTMLDivElement
  })

  afterEach(() => {
    dom.window.close()
    vi.unstubAllGlobals()
  })

  function select(id: string, start: number, end: number): Selection {
    const doc = dom.window.document
    const node = doc.getElementById(id)!.firstChild!
    const range = doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const selection = dom.window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return selection
  }

  it('reads an assistant passage with its source block', () => {
    const snapshot = readTimelineSelection(root, select('answer', 0, 13))
    expect(snapshot).toMatchObject({
      text: 'Remote agents',
      role: 'assistant',
      sourceBlockId: 'item_2',
      lineRects: [{ left: 10, top: 20, width: 100, height: 20 }]
    })
  })

  it('marks selections inside the user bubble as user quotes', () => {
    expect(readTimelineSelection(root, select('user-text', 0, 6))).toMatchObject({
      text: 'How do',
      role: 'user',
      sourceBlockId: 'user_1'
    })
  })

  it('ignores text outside message prose or outside the timeline', () => {
    expect(readTimelineSelection(root, select('chrome', 0, 3))).toBeNull()
    expect(readTimelineSelection(root, select('outside', 0, 7))).toBeNull()
  })

  it('ignores whitespace-only and collapsed selections', () => {
    expect(readTimelineSelection(root, select('answer', 6, 7))).toBeNull()
    expect(readTimelineSelection(root, select('answer', 3, 3))).toBeNull()
  })
})
