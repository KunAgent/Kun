import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'

const libraryMocks = vi.hoisted(() => ({
  renderDocx: vi.fn(),
  initPptx: vi.fn(),
  readWorkbook: vi.fn(),
  setCodepage: vi.fn()
}))

vi.mock('docx-preview', () => ({ renderAsync: libraryMocks.renderDocx }))
vi.mock('pptx-preview', () => ({ init: libraryMocks.initPptx }))
vi.mock('xlsx/dist/cpexcel.full.mjs', () => ({
  cptable: { 936: true },
  utils: {},
  version: 'test',
  $$typeof: undefined
}))
vi.mock('xlsx', () => ({
  read: libraryMocks.readWorkbook,
  set_cptable: libraryMocks.setCodepage,
  utils: {
    decode_range: (ref: string) => decodeRange(ref),
    encode_cell: ({ r, c }: { r: number; c: number }) => `${encodeColumn(c)}${r + 1}`,
    encode_col: encodeColumn
  }
}))

import { fittedDocxPreviewZoom, WorkspaceDocxPreview } from './WorkspaceDocxPreview'
import { fittedPptxPreviewZoom, WorkspacePptxPreview } from './WorkspacePptxPreview'
import { MAX_MOUNTED_PPTX_THUMBNAILS } from './WorkspacePptxThumbnailRail'
import {
  WorkspaceSpreadsheetPreview,
  normalizeSpreadsheetSelection,
  spreadsheetRangeLabel
} from './WorkspaceSpreadsheetPreview'
import {
  openWorkspaceOfficeExternalLink,
  secureWorkspaceOfficeLinks
} from './workspace-office-external-link'
import { selectionFromOfficeDom } from './workspace-office-selection'
import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import {
  createMockPptxPreviewer,
  type MockPptxPreviewer
} from './workspace-office-renderers-test-support'

let docxViewportWidth = 360

function preview(
  viewer: WorkspaceOfficePreviewSuccess['viewer'],
  sha = 'a'.repeat(64),
  sourceFormat?: WorkspaceOfficePreviewSuccess['sourceFormat']
): WorkspaceOfficePreviewSuccess {
  const renderFormat = viewer === 'word' ? 'docx' : viewer === 'presentation' ? 'pptx' : sourceFormat === 'xls' ? 'xls' : 'xlsx'
  return {
    ok: true,
    path: `/repo/fixture.${sourceFormat ?? renderFormat}`,
    name: `fixture.${sourceFormat ?? renderFormat}`,
    sourceFormat: sourceFormat ?? renderFormat,
    renderFormat,
    viewer,
    size: 3,
    mtimeMs: 1,
    sourceSha256: sha,
    data: new Uint8Array([1, 2, 3])
  }
}

describe('browser Office renderers', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let pptxInstances: MockPptxPreviewer[]
  let pptxSlideCount: number
  let scrollIntoView: ReturnType<typeof vi.fn>
  let renderedDocxPages: HTMLElement[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', Object.assign(dom.window, {
      kunGui: { openExternal: vi.fn(async () => undefined) }
    }))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    const browserWindow = dom.window as unknown as typeof globalThis
    vi.stubGlobal('Event', browserWindow.Event)
    vi.stubGlobal('KeyboardEvent', browserWindow.KeyboardEvent)
    scrollIntoView = vi.fn()
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    libraryMocks.renderDocx.mockReset()
    renderedDocxPages = []
    libraryMocks.renderDocx.mockImplementation(async (_data, body: HTMLElement) => {
      const wrapper = document.createElement('div')
      const first = document.createElement('section')
      const second = document.createElement('section')
      wrapper.className = 'docx-wrapper'
      wrapper.style.paddingLeft = '30px'
      wrapper.style.paddingRight = '30px'
      first.className = 'docx'
      second.className = 'docx'
      first.textContent = 'First page text'
      second.textContent = 'Second page text'
      first.append(document.createElement('p'))
      second.append(document.createElement('p'))
      renderedDocxPages = [first, second]
      Object.defineProperty(first, 'offsetWidth', { configurable: true, value: 816 })
      Object.defineProperty(second, 'offsetWidth', { configurable: true, value: 816 })
      wrapper.append(first, second)
      body.append(wrapper)
    })
    docxViewportWidth = 360
    pptxInstances = []
    pptxSlideCount = 3
    libraryMocks.initPptx.mockReset()
    libraryMocks.initPptx.mockImplementation((host: HTMLElement) => {
      const instance = createMockPptxPreviewer(host, pptxSlideCount)
      pptxInstances.push(instance)
      return instance
    })
    libraryMocks.readWorkbook.mockReset()
    libraryMocks.readWorkbook.mockReturnValue({
      SheetNames: ['Summary', 'Data'],
      Sheets: {
        Summary: {
          A1: { t: 's', v: 'Summary', w: 'Summary' },
          B1: { t: 's', v: '<img src=x onerror=alert(1)>', w: '<img src=x onerror=alert(1)>' },
          A2: { t: 's', v: 'Value', w: 'Value' },
          B2: { t: 'n', v: 12, w: '12', f: 'SUM(B1:B1)' },
          '!ref': 'A1:B2'
        },
        Data: { A1: { t: 's', v: 'Data' }, '!ref': 'A1:A1' }
      }
    })
    libraryMocks.setCodepage.mockReset()
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fits DOCX pages to narrow preview widths without enlarging wide pages', () => {
    expect(fittedDocxPreviewZoom(328, 876)).toBe(0.37)
    expect(fittedDocxPreviewZoom(608, 876)).toBe(0.69)
    expect(fittedDocxPreviewZoom(1_000, 876)).toBe(1)
    expect(fittedDocxPreviewZoom(0, 876)).toBe(1)
    expect(fittedPptxPreviewZoom(700, 500)).toBe(0.67)
    expect(fittedPptxPreviewZoom(1_200, 800)).toBe(1)
  })

  it('uses a distraction-free canvas for a single-slide PPTX', async () => {
    pptxSlideCount = 1
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Slide thumbnails' })).toHaveLength(0)
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Previous slide' })).toHaveLength(0)
  })

  it('renders DOCX safely, navigates pages, zooms, and retains old DOM after refresh failure', async () => {
    await act(async () => {
      renderer = create(createElement(WorkspaceDocxPreview, {
        result: preview('word'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })

    expect(libraryMocks.renderDocx).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(dom.window.HTMLElement),
      expect.any(dom.window.HTMLElement),
      expect.objectContaining({ renderAltChunks: false, breakPages: true, useBase64URL: true })
    )
    expect(renderer!.root.findByProps({ 'aria-label': 'Page 1 of 2' })).toBeTruthy()
    scrollIntoView.mockClear()
    await act(async () => requestKnowledgeSourceNavigation({
      filePath: '/repo/fixture.docx',
      location: { kind: 'word', paragraphStart: 2, paragraphEnd: 2 }
    }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(renderer!.root.findByProps({ className: 'workspace-docx-preview select-text' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('37%')
    docxViewportWidth = 640
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('69%')
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next page' }).props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': 'Page 2 of 2' })).toBeTruthy()
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('80%')
    docxViewportWidth = 360
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('80%')
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Reset zoom' }).props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('37%')

    const anchor = document.createElement('a')
    const linkContainer = document.createElement('div')
    const anchorText = document.createElement('span')
    anchor.href = 'https://example.test/document'
    anchor.target = '_blank'
    anchor.setAttribute('ping', 'https://example.test/ping')
    anchor.append(anchorText)
    linkContainer.append(anchor)
    secureWorkspaceOfficeLinks(linkContainer)
    expect(anchor.getAttribute('href')).toBe('#')
    expect(anchor.hasAttribute('target')).toBe(false)
    expect(anchor.hasAttribute('ping')).toBe(false)
    const preventDefault = vi.fn()
    openWorkspaceOfficeExternalLink({ target: anchorText, preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(window.kunGui.openExternal).toHaveBeenCalledWith('https://example.test/document')

    libraryMocks.renderDocx.mockRejectedValueOnce(new Error('broken refresh'))
    await act(async () => {
      renderer?.update(createElement(WorkspaceDocxPreview, {
        result: preview('word', 'b'.repeat(64)),
        loading: true
      }))
      await flushPromises()
    })
    expect(renderer!.root.findByProps({ 'aria-label': 'Page 2 of 2' })).toBeTruthy()
    expect(JSON.stringify(renderer!.toJSON())).toContain('broken refresh')
  })

  it('reports a cross-page Word selection and keeps it when focus moves outside the document', async () => {
    const onSelectionChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkspaceDocxPreview, {
        result: preview('word'),
        loading: false,
        onSelectionChange
      }), { createNodeMock })
      await flushPromises()
    })
    const body = renderedDocxPages[0]!.parentElement!.parentElement!
    document.body.append(body)
    const pages = renderedDocxPages
    const range = document.createRange()
    range.setStart(pages[0]!.firstChild!, 0)
    range.setEnd(pages[1]!.firstChild!, 6)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(selectionFromOfficeDom(body, 'word', 'docx', (node) => ({
      page: renderedDocxPages.findIndex((candidate) => candidate.contains(node)) + 1
    }))).toEqual(expect.objectContaining({
      pageStart: 1,
      pageEnd: 2,
      text: expect.stringContaining('First page text')
    }))
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'word',
      pageStart: 1,
      pageEnd: 2,
      text: expect.stringContaining('First page text')
    }))

    const outside = document.createElement('textarea')
    document.body.append(outside)
    outside.focus()
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ pageStart: 1, pageEnd: 2 }))
  })

  it('owns both PPTX previewers and destroys all source-scoped state before replacement', async () => {
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })
    expect(libraryMocks.initPptx).toHaveBeenNthCalledWith(
      1,
      expect.any(dom.window.HTMLElement),
      { width: 960, height: 540, mode: 'slide' }
    )
    expect(libraryMocks.initPptx).toHaveBeenNthCalledWith(
      2,
      expect.any(dom.window.HTMLElement),
      { width: 160, height: 90, mode: 'slide' }
    )
    const first = pptxInstances[0]!
    const firstThumbnails = pptxInstances[1]!
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next slide' }).props.onClick())
    expect(first.renderSingleSlide).toHaveBeenCalledWith(1)
    await act(async () => requestKnowledgeSourceNavigation({
      filePath: '/repo/fixture.pptx',
      location: { kind: 'presentation', slideStart: 3, slideEnd: 3 }
    }))
    expect(first.renderSingleSlide).toHaveBeenCalledWith(2)
    const securedMainLink = first.host.querySelector('a')!
    expect(securedMainLink.getAttribute('href')).toBe('#')
    expect(securedMainLink.hasAttribute('target')).toBe(false)
    const securedThumbnailLink = firstThumbnails.host.querySelector('a')!
    expect(securedThumbnailLink.getAttribute('href')).toBe('#')
    expect(securedThumbnailLink.hasAttribute('ping')).toBe(false)

    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: preview('presentation', 'b'.repeat(64)),
        loading: false
      }))
      await flushPromises()
    })
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(firstThumbnails.destroy).toHaveBeenCalledTimes(1)

    const second = pptxInstances[2]!
    const secondThumbnails = pptxInstances[3]!
    const previewFailure = new Error('presentation parse failed')
    libraryMocks.initPptx.mockImplementationOnce((host: HTMLElement) => {
      const instance = createMockPptxPreviewer(host, 1, previewFailure)
      pptxInstances.push(instance)
      return instance
    })
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: preview('presentation', 'c'.repeat(64)),
        loading: false
      }))
      await flushPromises()
    })
    const failed = pptxInstances[4]!
    const unusedFailedThumbnails = pptxInstances[5]!
    expect(failed.destroy).toHaveBeenCalledTimes(1)
    expect(unusedFailedThumbnails.destroy).toHaveBeenCalledTimes(1)
    expect(second.destroy).toHaveBeenCalledTimes(1)
    expect(secondThumbnails.destroy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(renderer!.toJSON())).toContain('presentation parse failed')

    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(second.destroy).toHaveBeenCalledTimes(1)
    expect(secondThumbnails.destroy).toHaveBeenCalledTimes(1)
  })

  it('reports only current-slide PPT text and clears selection when navigating', async () => {
    const onSelectionChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false,
        onSelectionChange
      }), { createNodeMock })
      await flushPromises()
    })
    const main = pptxInstances[0]!
    document.body.append(main.host)
    const anchor = main.host.querySelector('a')!
    const range = document.createRange()
    range.selectNodeContents(anchor)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(selectionFromOfficeDom(main.host, 'presentation', 'pptx', () => ({ slide: 1 })))
      .toEqual(expect.objectContaining({
      sourceKind: 'presentation',
      slide: 1,
      text: 'Slide 1'
    }))

    const callsBeforeNavigation = onSelectionChange.mock.calls.length
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next slide' }).props.onClick())
    expect(onSelectionChange.mock.calls.length).toBeGreaterThan(callsBeforeNavigation)
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'presentation',
      text: '',
      charCount: 0
    }))
    expect(window.getSelection()?.rangeCount).toBe(0)
  })

  it('virtualizes a long PPTX rail to sixteen static thumbnails and syncs the active slide', async () => {
    pptxSlideCount = 50
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })

    const thumbnailButtons = renderer!.root.findAll((node) => (
      typeof node.props['data-pptx-thumbnail-index'] === 'number'
    ))
    expect(thumbnailButtons).toHaveLength(50)
    expect(thumbnailButtons.filter((node) => node.props['data-thumbnail-state'] === 'ready'))
      .toHaveLength(MAX_MOUNTED_PPTX_THUMBNAILS)
    expect(thumbnailButtons.filter((node) => node.props['data-thumbnail-state'] === 'placeholder'))
      .toHaveLength(50 - MAX_MOUNTED_PPTX_THUMBNAILS)
    expect(pptxInstances[1]!.renderSingleSlide.mock.calls.map(([index]) => index))
      .toEqual(Array.from({ length: MAX_MOUNTED_PPTX_THUMBNAILS }, (_, index) => index))

    scrollIntoView.mockClear()
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Go to slide 10' }).props.onClick())
    expect(pptxInstances[0]!.renderSingleSlide).toHaveBeenCalledWith(9)
    expect(renderer!.root.findByProps({ 'aria-label': 'Go to slide 10' }).props['aria-current']).toBe('page')
    expect(scrollIntoView).toHaveBeenCalled()

    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': 'Go to slide 50' }).props.onClick()
      await flushPromises()
    })
    expect(pptxInstances[0]!.renderSingleSlide).toHaveBeenCalledWith(49)
    expect(renderer!.root.findByProps({ 'aria-label': 'Go to slide 50' }).props['data-thumbnail-state'])
      .toBe('ready')
    expect(renderer!.root.findAll((node) => node.props['data-thumbnail-state'] === 'ready'))
      .toHaveLength(MAX_MOUNTED_PPTX_THUMBNAILS)
  })

  it('uses IntersectionObserver to release old thumbnail DOM before mounting a new window', async () => {
    pptxSlideCount = 50
    let observerCallback: IntersectionObserverCallback | undefined
    vi.stubGlobal('IntersectionObserver', class {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0]
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
    })
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })

    const entries = [
      ...Array.from({ length: 16 }, (_, index) => intersectionEntry(index, false)),
      ...Array.from({ length: 16 }, (_, index) => intersectionEntry(index + 34, true))
    ]
    await act(async () => {
      observerCallback?.(entries, {} as IntersectionObserver)
      await flushPromises()
    })
    const ready = renderer!.root.findAll((node) => node.props['data-thumbnail-state'] === 'ready')
    expect(ready).toHaveLength(MAX_MOUNTED_PPTX_THUMBNAILS)
    expect(ready.map((node) => node.props['data-pptx-thumbnail-index']))
      .toEqual(Array.from({ length: 16 }, (_, index) => index + 34))
  })

  it('supports presentation keys while leaving editable controls untouched', async () => {
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })
    const main = pptxInstances[0]!
    main.renderSingleSlide.mockClear()

    await dispatchKey('ArrowRight')
    await dispatchKey('PageDown')
    await dispatchKey('End')
    await dispatchKey('Home')
    await dispatchKey(' ')
    expect(main.renderSingleSlide.mock.calls.map(([index]) => index)).toEqual([1, 2, 2, 0, 1])

    const input = document.createElement('input')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(input, editable)
    await dispatchKey('ArrowRight', input)
    await dispatchKey('ArrowRight', editable)
    expect(main.renderSingleSlide).toHaveBeenCalledTimes(5)
  })

  it('uses the Fullscreen API and hides audience controls after two seconds', async () => {
    vi.useFakeTimers()
    let fullscreenElement: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement
    })
    const requestFullscreen = vi.fn(function (this: HTMLElement) {
      fullscreenElement = this
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    Object.defineProperty(dom.window.HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen
    })

    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: preview('presentation'),
        loading: false
      }), { createNodeMock })
      await flushPromises()
    })
    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': 'Enter fullscreen' }).props.onClick()
      await flushPromises()
    })
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ 'data-pptx-fullscreen': 'true' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ 'aria-label': 'Slide thumbnails' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-pptx-fullscreen-controls': 'visible' })).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(renderer!.root.findByProps({ 'data-pptx-fullscreen-controls': 'hidden' })).toBeTruthy()
    await act(async () => renderer?.root.findByProps({ 'data-pptx-fullscreen': 'true' }).props.onPointerMove())
    expect(renderer!.root.findByProps({ 'data-pptx-fullscreen-controls': 'visible' })).toBeTruthy()

    await act(async () => {
      renderer?.root.findByProps({ 'aria-label': 'Exit fullscreen' }).props.onClick()
      await flushPromises()
    })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findByProps({ 'data-pptx-fullscreen': 'false' })).toBeTruthy()

    await dispatchKey('f')
    expect(requestFullscreen).toHaveBeenCalledTimes(2)
  })

  it('loads SheetJS with XLS codepages and keeps worksheet and zoom controls local', async () => {
    await act(async () => {
      renderer = create(createElement(WorkspaceSpreadsheetPreview, {
        result: preview('spreadsheet', 'a'.repeat(64), 'xls'),
        loading: false
      }))
      await flushPromises()
    })

    expect(libraryMocks.setCodepage).toHaveBeenCalledWith(expect.objectContaining({
      cptable: { 936: true },
      version: 'test'
    }))
    expect(libraryMocks.readWorkbook).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ type: 'array', dense: false, cellFormula: true })
    )
    await act(async () => requestKnowledgeSourceNavigation({
      filePath: '/repo/fixture.xls',
      location: { kind: 'spreadsheet', sheetName: 'Data', range: 'A1:B2' }
    }))
    expect(JSON.stringify(renderer!.toJSON())).toContain('Data')
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': 'Reset zoom' }).children.join('')).toBe('110%')
  })

  it('creates Excel-style rectangular selections with TSV, formulas, and escaped cell text', async () => {
    const onSelectionChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkspaceSpreadsheetPreview, {
        result: preview('spreadsheet'),
        loading: false,
        onSelectionChange
      }))
      await flushPromises()
    })
    const rect = { left: 1, right: 20, top: 2, bottom: 12, width: 19, height: 10 }
    await act(async () => {
      renderer?.root.findByProps({ 'data-office-sheet-cell': '0:0' }).props.onPointerDown({
        button: 0,
        preventDefault: vi.fn(),
        currentTarget: { getBoundingClientRect: () => rect }
      })
      renderer?.root.findByProps({ 'data-office-sheet-cell': '1:1' }).props.onPointerEnter({
        currentTarget: { getBoundingClientRect: () => rect }
      })
      await flushPromises()
    })

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'spreadsheet',
      sheetName: 'Summary',
      cellRange: 'A1:B2',
      text: 'Summary\t<img src=x onerror=alert(1)>\nValue\t12',
      formulas: ['B2: =SUM(B1:B1)']
    }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ anchorRect: expect.anything() })
    )
    expect(renderer!.root.findByProps({ 'data-office-sheet-cell': '0:1' }).children).toEqual([
      '<img src=x onerror=alert(1)>'
    ])
  })

  it('normalizes reverse and merged-cell spreadsheet ranges', () => {
    const range = normalizeSpreadsheetSelection(
      { row: 8, column: 5, rowEnd: 9, columnEnd: 7 },
      { row: 2, column: 1, rowEnd: 2, columnEnd: 1 }
    )
    expect(range).toEqual({ rowStart: 2, rowEnd: 9, columnStart: 1, columnEnd: 7 })
    expect(range && spreadsheetRangeLabel(range)).toBe('B3:H10')
  })
})

function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
  if (typeof element.type !== 'string') return null
  const props = element.props as { className?: string }
  const node = document.createElement(element.type)
  if (props.className === 'min-h-0 flex-1 overflow-auto p-4') {
    node.style.paddingLeft = '16px'
    node.style.paddingRight = '16px'
    Object.defineProperty(node, 'clientWidth', {
      configurable: true,
      get: () => docxViewportWidth
    })
  }
  return node
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}

async function dispatchKey(
  key: string,
  target: Window | HTMLElement = window
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
}

function intersectionEntry(index: number, isIntersecting: boolean): IntersectionObserverEntry {
  const target = document.createElement('div')
  target.setAttribute('data-pptx-thumbnail-index', String(index))
  return { target, isIntersecting } as unknown as IntersectionObserverEntry
}

function encodeColumn(column: number): string {
  let value = column + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function decodeRange(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const [start = 'A1', end = start] = ref.split(':')
  return { s: decodeCell(start), e: decodeCell(end) }
}

function decodeCell(cell: string): { r: number; c: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(cell) ?? ['', 'A', '1']
  let column = 0
  for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64
  return { r: Number.parseInt(match[2]!, 10) - 1, c: column - 1 }
}
