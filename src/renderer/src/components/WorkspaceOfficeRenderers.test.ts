import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'

const libraryMocks = vi.hoisted(() => ({
  renderDocx: vi.fn(),
  readWorkbook: vi.fn(),
  setCodepage: vi.fn()
}))

vi.mock('docx-preview', () => ({ renderAsync: libraryMocks.renderDocx }))
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
