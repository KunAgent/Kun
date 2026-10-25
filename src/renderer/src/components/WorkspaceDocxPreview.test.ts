import { createElement, useEffect, useImperativeHandle, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { WorkspaceDocxPagesProps } from './WorkspaceDocxPages'

const engine = vi.hoisted(() => ({
  props: [] as WorkspaceDocxPagesProps[],
  pageCount: 5,
  goToPage: vi.fn(),
  revealParagraph: vi.fn(() => true),
  fullText: vi.fn(() => 'Whole document text')
}))

// The real engine parses with Wasm in a worker; the shell only needs its callbacks.
vi.mock('./WorkspaceDocxPages', () => ({
  WorkspaceDocxPages: (props: WorkspaceDocxPagesProps): ReactElement => {
    engine.props.push(props)
    useImperativeHandle(props.handleRef, () => ({
      goToPage: engine.goToPage,
      revealParagraph: engine.revealParagraph,
      fullText: engine.fullText
    }), [])
    useEffect(() => {
      props.onPageInfo(1, engine.pageCount)
      props.onLoaded()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.source])
    return createElement('div', { 'data-engine': 'docx' })
  }
}))

import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import { WorkspaceDocxPreview } from './WorkspaceDocxPreview'
import { registeredDocxPreviewText } from './workspace-docx-text'

function preview(sha: string, data = new Uint8Array([1, 2, 3]), path = '/repo/handbook.docx'): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path,
    name: path.split('/').at(-1)!,
    sourceFormat: 'docx',
    renderFormat: 'docx',
    viewer: 'word',
    size: data.byteLength,
    mtimeMs: 1,
    sourceSha256: sha,
    data
  }
}

describe('WorkspaceDocxPreview', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let content: HTMLElement
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    openExternal = vi.fn(async () => undefined)
    vi.stubGlobal('window', Object.assign(dom.window, { kunGui: { openExternal } }))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    const browserWindow = dom.window as unknown as typeof globalThis
    vi.stubGlobal('Event', browserWindow.Event)
    engine.props = []
    engine.pageCount = 5
    engine.goToPage.mockClear()
    engine.revealParagraph.mockReset()
    engine.revealParagraph.mockReturnValue(true)
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
    if (typeof element.type !== 'string') return null
    const node = document.createElement(element.type)
    const className = (element.props as { className?: string }).className ?? ''
    if (className.includes('workspace-docx-preview')) {
      content = node
      document.body.append(node)
    }
    return node
  }

  async function mount(element: ReactElement): Promise<ReactTestRenderer> {
    let mounted!: ReactTestRenderer
    await act(async () => {
      mounted = create(element, { createNodeMock })
      for (let index = 0; index < 30; index += 1) await Promise.resolve()
    })
    return mounted
  }

  const lastProps = (): WorkspaceDocxPagesProps => engine.props.at(-1)!
  const summary = (): string | undefined =>
    renderer?.root.findByProps({ 'aria-live': 'polite' }).props.children as string | undefined

  it('shows the page summary and moves between pages through the engine', async () => {
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: preview('a'), loading: false }))
    expect(summary()).toBe('Page 1 of 5')
    expect(lastProps().fileName).toBe('handbook.docx')

    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next page' }).props.onClick())
    expect(engine.goToPage).toHaveBeenLastCalledWith(2)
    expect(summary()).toBe('Page 2 of 5')
    expect(renderer.root.findByProps({ 'aria-label': 'Previous page' }).props.disabled).toBe(false)

    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Previous page' }).props.onClick())
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Previous page' }).props.onClick())
    expect(engine.goToPage).toHaveBeenLastCalledWith(1)
    expect(renderer.root.findByProps({ 'aria-label': 'Previous page' }).props.disabled).toBe(true)
  })

  it('follows the page the reader scrolls to, but not the neighbour reported while a jump settles', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: preview('a'), loading: false }))
    await act(async () => lastProps().onPageInfo(3, 5))
    expect(summary()).toBe('Page 3 of 5')

    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next page' }).props.onClick())
    expect(summary()).toBe('Page 4 of 5')
    await act(async () => lastProps().onPageInfo(3, 5))
    expect(summary()).toBe('Page 4 of 5')
    now.mockReturnValue(11_000)
    await act(async () => lastProps().onPageInfo(3, 5))
    expect(summary()).toBe('Page 3 of 5')
    now.mockRestore()
  })

  it('zooms by mode and by preset steps from the resolved zoom', async () => {
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: preview('a'), loading: false }))
    expect(lastProps().zoom).toBe('automatic')
    await act(async () => lastProps().onZoomChange({ level: 'automatic', resolvedZoom: 62 }))
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick())
    expect(lastProps().zoom).toBe(75)
    await act(async () => renderer?.root.findByType('select').props.onChange({ target: { value: 'fit-width' } }))
    expect(lastProps().zoom).toBe('fit-width')
  })

  it('keeps the parsed document for the same bytes and reparses a changed file', async () => {
    const first = preview('a')
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: first, loading: false }))
    const firstSource = lastProps().source
    await act(async () => {
      renderer?.update(createElement(WorkspaceDocxPreview, {
        result: { ...first, data: new Uint8Array(first.data) },
        loading: false
      }))
    })
    expect(lastProps().source).toBe(firstSource)
    await act(async () => {
      renderer?.update(createElement(WorkspaceDocxPreview, { result: preview('b', new Uint8Array([9])), loading: true }))
    })
    expect(lastProps().source).not.toBe(firstSource)
    expect(renderer.root.findByProps({ 'data-office-preview-state': 'refreshing' })).toBeTruthy()
  })

  it('reports the pages of the selected text and clears it with navigation', async () => {
    const onSelectionChange = vi.fn()
    renderer = await mount(createElement(WorkspaceDocxPreview, {
      result: preview('a'),
      loading: false,
      onSelectionChange
    }))
    const pages = [0, 1].map((index) => {
      const page = document.createElement('div')
      page.setAttribute('data-docx-page-wrapper', 'true')
      page.dataset.docxPageIndex = String(index)
      page.textContent = index === 0 ? 'First page text' : 'Second page text'
      content.append(page)
      return page
    })
    const range = document.createRange()
    range.setStart(pages[0]!.firstChild!, 0)
    range.setEnd(pages[1]!.firstChild!, 6)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'word',
      pageStart: 1,
      pageEnd: 2,
      text: expect.stringContaining('First page text')
    }))

    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next page' }).props.onClick())
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: '', charCount: 0 }))
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  it('jumps to a paragraph from a knowledge source and exposes the whole text to the copy action', async () => {
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: preview('a'), loading: false }))
    await act(async () => requestKnowledgeSourceNavigation({
      filePath: '/repo/handbook.docx',
      location: { kind: 'word', paragraphStart: 12, paragraphEnd: 12 }
    }))
    expect(engine.revealParagraph).toHaveBeenCalledWith(12)
    expect(registeredDocxPreviewText(content)).toBe('Whole document text')

    engine.revealParagraph.mockClear()
    requestKnowledgeSourceNavigation({
      filePath: '/repo/other.docx',
      location: { kind: 'word', paragraphStart: 1, paragraphEnd: 1 }
    })
    expect(engine.revealParagraph).not.toHaveBeenCalled()
  })

  it('opens document links in the system browser instead of navigating the window', async () => {
    renderer = await mount(createElement(WorkspaceDocxPreview, { result: preview('a'), loading: false }))
    const anchor = document.createElement('a')
    anchor.setAttribute('href', 'https://example.com/report')
    anchor.setAttribute('target', '_blank')
    const wrapper = renderer.root.findByProps({ className: 'workspace-docx-preview select-text' })
    const preventDefault = vi.fn()
    await act(async () => wrapper.props.onClickCapture({ button: 0, target: anchor, preventDefault }))
    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/report')

    openExternal.mockClear()
    anchor.setAttribute('href', 'javascript:alert(1)')
    await act(async () => wrapper.props.onClickCapture({ button: 0, target: anchor, preventDefault }))
    expect(openExternal).not.toHaveBeenCalled()
    await act(async () => wrapper.props.onClickCapture({ button: 2, target: anchor, preventDefault }))
    expect(openExternal).not.toHaveBeenCalled()
  })
})
