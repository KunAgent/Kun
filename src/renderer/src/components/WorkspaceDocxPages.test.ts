import { createElement, createRef, type ReactElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceDocxPagesHandle, WorkspaceDocxPagesProps } from './WorkspaceDocxPages'

type FakeParsed = { id: string; model: { nodes: unknown[] }; dispose: ReturnType<typeof vi.fn> }

const lib = vi.hoisted(() => ({
  parse: vi.fn(),
  reveal: vi.fn(),
  editor: { currentPage: 2, totalPages: 9 },
  viewers: [] as Array<{ zoom: unknown }>
}))

vi.mock('@extend-ai/react-docx', () => ({
  setWasmSource: vi.fn(),
  parseDocxForViewer: lib.parse,
  revealDocxSource: lib.reveal,
  useDocxEditor: (options: { document: FakeParsed }) => ({ ...lib.editor, model: options.document.model }),
  DocxEditorViewer: (props: { zoom: unknown }): ReactElement => {
    lib.viewers.push({ zoom: props.zoom })
    return createElement('div', { 'data-viewer': 'docx' })
  }
}))

import { WorkspaceDocxPages } from './WorkspaceDocxPages'

const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (value: string, blockId: string) => ({ type: 'paragraph', blockId, children: [text(value)] })

function parsedDocument(id: string): FakeParsed {
  return {
    id,
    model: { nodes: [paragraph('Title', `${id}/0`), paragraph('Body text', `${id}/1`)] },
    dispose: vi.fn()
  }
}

describe('WorkspaceDocxPages', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let scroller: HTMLDivElement
  let scrollTop: number
  let frames: Array<() => void>
  let surfaceNode: HTMLElement | null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    frames = []
    surfaceNode = null
    ;(dom.window as unknown as { requestAnimationFrame: (callback: () => void) => number }).requestAnimationFrame = (callback) => {
      frames.push(callback)
      return frames.length
    }
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    scroller = document.createElement('div')
    scrollTop = 0
    Object.defineProperties(scroller, {
      scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value } },
      scrollHeight: { configurable: true, get: () => 6_000 },
      clientHeight: { configurable: true, get: () => 600 }
    })
    document.body.append(scroller)
    lib.parse.mockReset()
    lib.reveal.mockReset()
    lib.viewers = []
    lib.editor = { currentPage: 2, totalPages: 9 }
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.unstubAllGlobals()
  })

  function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
    if (typeof element.type !== 'string') return null
    const node = document.createElement(element.type)
    if ((element.props as { className?: string }).className === 'kun-docx-surface') {
      const viewerRoot = document.createElement('div')
      viewerRoot.setAttribute('data-docx-editor-root', 'true')
      node.append(viewerRoot)
      scroller.append(node)
      surfaceNode = node
    }
    return node
  }

  function props(overrides: Partial<WorkspaceDocxPagesProps> = {}): WorkspaceDocxPagesProps {
    return {
      source: new Uint8Array([1, 2, 3]),
      fileName: 'handbook.docx',
      zoom: 'automatic',
      scrollRef: { current: scroller } as RefObject<HTMLDivElement | null>,
      handleRef: createRef<WorkspaceDocxPagesHandle>(),
      onPageInfo: vi.fn(),
      onZoomChange: vi.fn(),
      onLoaded: vi.fn(),
      onError: vi.fn(),
      ...overrides
    }
  }

  async function mount(deckProps: WorkspaceDocxPagesProps): Promise<ReactTestRenderer> {
    let mounted!: ReactTestRenderer
    await act(async () => {
      mounted = create(createElement(WorkspaceDocxPages, deckProps), { createNodeMock })
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    return mounted
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
  }

  function runFrame(): void {
    const pending = frames.splice(0)
    for (const callback of pending) callback()
  }

  it('parses in a worker with deferred fonts, then shows the viewer and its page count', async () => {
    const first = parsedDocument('a')
    lib.parse.mockResolvedValue(first)
    const deckProps = props({ zoom: 125 })
    renderer = await mount(deckProps)
    const [buffer, options] = lib.parse.mock.calls[0]!
    expect((buffer as ArrayBuffer).byteLength).toBe(3)
    expect(options).toEqual(expect.objectContaining({ useWorker: true, loadEmbeddedFonts: 'defer', fileName: 'handbook.docx' }))
    expect(renderer.root.findByProps({ 'data-viewer': 'docx' })).toBeTruthy()
    expect(lib.viewers.at(-1)!.zoom).toBe(125)
    expect(deckProps.onLoaded).toHaveBeenCalledTimes(1)
    expect(deckProps.onPageInfo).toHaveBeenLastCalledWith(2, 9)
  })

  it('reports a document that cannot be parsed', async () => {
    lib.parse.mockRejectedValue(new Error('Not a Word file'))
    const deckProps = props()
    renderer = await mount(deckProps)
    expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
    expect(deckProps.onError).toHaveBeenCalledWith('Not a Word file')
    expect(deckProps.onLoaded).not.toHaveBeenCalled()
  })

  it('swaps in a changed file, disposes the old parse and keeps the reader where they were', async () => {
    const first = parsedDocument('a')
    const second = parsedDocument('b')
    lib.parse.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const deckProps = props()
    renderer = await mount(deckProps)
    expect(first.dispose).not.toHaveBeenCalled()

    scrollTop = 2_400
    await act(async () => {
      renderer?.update(createElement(WorkspaceDocxPages, { ...deckProps, source: new Uint8Array([9, 9]) }))
    })
    await settle()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(deckProps.onLoaded).toHaveBeenCalledTimes(2)
    // The viewer resets the pane while it paginates; the saved offset is asked for again.
    scrollTop = 0
    runFrame()
    expect(scrollTop).toBe(2_400)
    // The new pages are held at the old height until they are measured.
    expect(renderer.root.findByProps({ className: 'kun-docx-surface' }).props.style).toEqual({ minHeight: 5_952 })

    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it('stops restoring the offset as soon as the reader scrolls', async () => {
    lib.parse.mockResolvedValueOnce(parsedDocument('a')).mockResolvedValueOnce(parsedDocument('b'))
    const deckProps = props()
    renderer = await mount(deckProps)
    scrollTop = 1_500
    await act(async () => {
      renderer?.update(createElement(WorkspaceDocxPages, { ...deckProps, source: new Uint8Array([7]) }))
    })
    await settle()
    surfaceNode!.style.minHeight = '5952px'
    scroller.dispatchEvent(new (dom.window as unknown as { Event: typeof Event }).Event('wheel'))
    scrollTop = 40
    runFrame()
    expect(scrollTop).toBe(40)
    expect(surfaceNode!.style.minHeight).toBe('')
  })

  it('offers the whole text and paragraph reveal to the preview', async () => {
    lib.parse.mockResolvedValue(parsedDocument('a'))
    const handleRef = createRef<WorkspaceDocxPagesHandle>()
    renderer = await mount(props({ handleRef }))
    expect(handleRef.current!.fullText()).toBe('Title\nBody text')

    expect(handleRef.current!.revealParagraph(2)).toBe(true)
    const root = scroller.querySelector('[data-docx-editor-root]')
    expect(lib.reveal).toHaveBeenCalledWith(root, 'a/1')
    expect(handleRef.current!.revealParagraph(0)).toBe(false)
  })

  it('scrolls to a page that is not mounted by extrapolating, then aligns it once it appears', async () => {
    lib.parse.mockResolvedValue(parsedDocument('a'))
    const handleRef = createRef<WorkspaceDocxPagesHandle>()
    renderer = await mount(props({ handleRef }))
    // Rects are in viewport pixels, so they move with the pane's scroll offset.
    Object.defineProperties(scroller, {
      offsetHeight: { configurable: true, value: 600 },
      getBoundingClientRect: { configurable: true, value: () => ({ top: 0, height: 600 }) }
    })
    const page = (index: number, top: number): HTMLElement => {
      const element = document.createElement('div')
      element.setAttribute('data-docx-page-wrapper', 'true')
      element.dataset.docxPageIndex = String(index)
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: top - scrollTop, height: 900 })
      })
      scroller.append(element)
      return element
    }
    page(0, 24)
    page(1, 1_024)

    handleRef.current!.goToPage(6)
    await act(async () => { await Promise.resolve() })
    // Stride 1000 from page 0 at 24 puts page 5 near 5024; the window then mounts it.
    expect(scrollTop).toBe(5_024)
    page(5, 5_030)
    await act(async () => {
      runFrame()
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })
    expect(scrollTop).toBe(5_022)

    handleRef.current!.goToPage(2)
    await act(async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve() })
    expect(scrollTop).toBe(1_016)
  })
})
