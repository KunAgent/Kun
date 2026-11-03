import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'

type Range = { start: { row: number; col: number }; end: { row: number; col: number } }

const lib = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  viewerProps: [] as Array<Record<string, unknown>>,
  state: {} as Record<string, unknown>
}))

vi.mock('@extend-ai/react-xlsx', () => ({
  setWasmSource: vi.fn(),
  useXlsxViewerController: (options: Record<string, unknown>) => {
    lib.options.push(options)
    return lib.state
  },
  XlsxViewer: (props: Record<string, unknown>): ReactElement => {
    lib.viewerProps.push(props)
    return createElement('div', { 'data-viewer': 'xlsx' })
  }
}))

import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import { WorkspaceXlsxGrid } from './WorkspaceXlsxGrid'

function preview(sha = 'a', data = new Uint8Array([1, 2, 3])): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: '/repo/usage.xlsx',
    name: 'usage.xlsx',
    sourceFormat: 'xlsx',
    renderFormat: 'xlsx',
    viewer: 'spreadsheet',
    size: data.byteLength,
    mtimeMs: 1,
    sourceSha256: sha,
    data
  }
}

const range = (r1: number, c1: number, r2: number, c2: number): Range => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 }
})

function controllerState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isLoading: false,
    selection: null,
    activeCell: null,
    selectedRangeAddress: null,
    activeSheet: { name: 'Usage', workbookSheetIndex: 0, cachedFormulaValues: {} },
    sheets: [{ name: 'Usage' }, { name: 'My Notes' }],
    tabs: [
      { id: 't0', index: 0, name: 'Usage', kind: 'sheet' },
      { id: 't1', index: 1, name: 'My Notes', kind: 'sheet' }
    ],
    activeTabIndex: 0,
    zoomScale: 100,
    canZoomIn: true,
    canZoomOut: true,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    setActiveTabIndex: vi.fn(),
    setActiveSheetIndex: vi.fn(),
    highlightRanges: vi.fn(() => true),
    clearHighlightedRanges: vi.fn(),
    copySelectionToClipboard: vi.fn(async () => true),
    getActiveWorksheet: () => null,
    getCellDisplayValue: () => '',
    getCellFormula: () => '',
    getRowsBatchAsync: vi.fn(async (_sheet: number, start: number, count: number) =>
      Array.from({ length: count }, (_, offset) => ({
        index: start + offset,
        cells: [
          { col: 0, value: `A${start + offset + 1}` },
          { col: 1, value: `B${start + offset + 1}`, formula: '=A1+1' }
        ]
      }))),
    ...overrides
  }
}

describe('WorkspaceXlsxGrid', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  // One file version per test: the shell keeps its bytes stable, so renders must too.
  let current: WorkspaceOfficePreviewSuccess

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', Object.assign(dom.window, { kunGui: {} }))
    vi.stubGlobal('document', dom.window.document)
    vi.useFakeTimers()
    lib.options = []
    lib.viewerProps = []
    lib.state = controllerState()
    current = preview()
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    vi.useRealTimers()
    dom.window.close()
    vi.unstubAllGlobals()
  })

  async function render(element: ReactElement, update = false): Promise<void> {
    await act(async () => {
      if (update && renderer) renderer.update(element)
      else renderer = create(element)
    })
  }

  const grid = (overrides: Record<string, unknown> = {}, result = current, source = result.data): ReactElement =>
    createElement(WorkspaceXlsxGrid, { result, source, loading: false, ...overrides } as never)

  async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  it('opens the workbook read-only in a worker with resizable rows and columns', async () => {
    await render(grid())
    const options = lib.options.at(-1)!
    expect(options).toEqual(expect.objectContaining({
      fileName: 'usage.xlsx',
      readOnly: true,
      allowResizeInReadOnly: true,
      useWorker: true
    }))
    expect((options.file as ArrayBuffer).byteLength).toBe(3)
    expect(lib.viewerProps.at(-1)).toEqual(expect.objectContaining({ readOnly: true, showDefaultToolbar: false, isDark: false }))
  })

  it('quotes a dragged selection with its sheet, range, text and formulas', async () => {
    const onSelectionChange = vi.fn()
    await render(grid({ onSelectionChange }))
    expect(onSelectionChange).not.toHaveBeenCalled()

    lib.state = controllerState({ selection: range(0, 0, 1, 1), selectedRangeAddress: 'A1:B2' })
    await render(grid({ onSelectionChange }), true)
    await advance(200)
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      sourceKind: 'spreadsheet',
      sourceFormat: 'xlsx',
      text: 'A1\tB1\nA2\tB2',
      charCount: 11,
      sheetName: 'Usage',
      cellRange: 'A1:B2',
      formulas: ['B1: A1+1', 'B2: A1+1']
    })

    lib.state = controllerState()
    await render(grid({ onSelectionChange }), true)
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: '', charCount: 0 }))
  })

  it('does not quote the default active cell until the reader interacts with the grid', async () => {
    const onSelectionChange = vi.fn()
    lib.state = controllerState({ activeCell: { row: 0, col: 0 } })
    await render(grid({ onSelectionChange }))
    await advance(200)
    expect(onSelectionChange).not.toHaveBeenCalled()

    const surface = renderer!.root.findByProps({ className: 'kun-xlsx flex min-h-0 flex-1 flex-col' })
    await act(async () => surface.props.onPointerDownCapture())
    lib.state = controllerState({ activeCell: { row: 2, col: 1 } })
    await render(grid({ onSelectionChange }), true)
    await advance(200)
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ cellRange: 'B3:B3', text: 'B3' }))
  })

  it('clears a quoted selection when the grid goes away', async () => {
    const onSelectionChange = vi.fn()
    lib.state = controllerState({ selection: range(0, 0, 0, 0) })
    await render(grid({ onSelectionChange }))
    await advance(200)
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'A1' }))
    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: '', charCount: 0 }))
  })

  it('switches worksheets from the tab bar', async () => {
    await render(grid())
    const tabs = renderer!.root.findAllByProps({ role: 'tab' })
    expect(tabs.map((tab) => tab.props['aria-selected'])).toEqual([true, false])
    await act(async () => tabs[1]!.props.onClick())
    expect((lib.state.setActiveTabIndex as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(1)
  })

  it('has no tab bar for a single worksheet', async () => {
    lib.state = controllerState({ tabs: [{ id: 't0', index: 0, name: 'Only', kind: 'sheet' }] })
    await render(grid())
    expect(renderer!.root.findAllByProps({ role: 'tablist' })).toHaveLength(0)
  })

  it('reveals a knowledge-source range, quoting the sheet name, and lets the highlight fade', async () => {
    await render(grid())
    await act(async () => requestKnowledgeSourceNavigation({
      filePath: '/repo/usage.xlsx',
      location: { kind: 'spreadsheet', sheetName: "Q1 'draft'", range: 'B2:C4' }
    }))
    expect(lib.state.highlightRanges).toHaveBeenCalledWith("'Q1 ''draft'''!B2:C4", { autoScroll: true })
    await advance(4_100)
    expect(lib.state.clearHighlightedRanges).toHaveBeenCalled()
  })

  it('zooms with the stepper and copies the selection', async () => {
    lib.state = controllerState({ selection: range(0, 0, 0, 1), selectedRangeAddress: 'A1:B1' })
    await render(grid())
    const root = renderer!.root
    await act(async () => root.findByProps({ 'aria-label': 'Zoom in' }).props.onClick())
    await act(async () => root.findByProps({ 'aria-label': 'Zoom out' }).props.onClick())
    await act(async () => root.findByProps({ 'aria-label': 'Reset zoom' }).props.onClick())
    expect(lib.state.zoomIn).toHaveBeenCalled()
    expect(lib.state.zoomOut).toHaveBeenCalled()
    expect(lib.state.resetZoom).toHaveBeenCalled()

    await act(async () => root.findByProps({ 'aria-label': 'Copy' }).props.onClick())
    expect(lib.state.copySelectionToClipboard).toHaveBeenCalled()
  })

  it('returns to the worksheet the reader was on after the file changes', async () => {
    lib.state = controllerState({ activeSheet: { name: 'My Notes', workbookSheetIndex: 1, cachedFormulaValues: {} }, activeTabIndex: 1 })
    await render(grid())
    const changed = preview('b', new Uint8Array([9, 9]))
    // The reload briefly shows the first worksheet again.
    lib.state = controllerState({ isLoading: true, sheets: [], activeSheet: null })
    await render(grid({}, changed), true)
    lib.state = controllerState()
    await render(grid({}, changed), true)
    expect(lib.state.setActiveSheetIndex).toHaveBeenCalledWith(1)
  })
})
