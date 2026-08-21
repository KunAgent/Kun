import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'

const libraryMocks = vi.hoisted(() => ({ readWorkbook: vi.fn() }))

vi.mock('xlsx', () => ({
  read: libraryMocks.readWorkbook,
  utils: {
    decode_range: (ref: string) => decodeRange(ref),
    encode_cell: ({ r, c }: { r: number; c: number }) => `${encodeColumn(c)}${r + 1}`,
    encode_col: encodeColumn
  }
}))

import { WorkspaceSpreadsheetPreview } from './WorkspaceSpreadsheetPreview'

let dom: JSDOM
let renderer: ReactTestRenderer | undefined

function preview(): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: '/repo/fixture.xlsx',
    name: 'fixture.xlsx',
    sourceFormat: 'xlsx',
    renderFormat: 'xlsx',
    viewer: 'spreadsheet',
    size: 3,
    mtimeMs: 1,
    sourceSha256: 'a'.repeat(64),
    data: new Uint8Array([1, 2, 3])
  }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('Event', (dom.window as unknown as typeof globalThis).Event)
  libraryMocks.readWorkbook.mockReset()
  libraryMocks.readWorkbook.mockReturnValue({
    SheetNames: ['Summary'],
    Sheets: {
      Summary: {
        A1: { t: 's', v: 'Summary', w: 'Summary' },
        '!ref': 'A1:A1'
      }
    }
  })
})

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
  dom.window.close()
  vi.unstubAllGlobals()
})

describe('WorkspaceSpreadsheetPreview outside-click dismissal', () => {
  it('clears an active cell selection when the user clicks outside the table', async () => {
    const onSelectionChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkspaceSpreadsheetPreview, {
        result: preview(),
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
      await flushPromises()
    })
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'spreadsheet',
      sheetName: 'Summary',
      cellRange: 'A1:A1'
    }))

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await flushPromises()
    })
    outside.remove()

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'spreadsheet',
      text: '',
      charCount: 0
    }))
  })

  it('keeps the cell selection when the click targets the sidebar quote action', async () => {
    const onSelectionChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkspaceSpreadsheetPreview, {
        result: preview(),
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
      await flushPromises()
    })
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'spreadsheet',
      cellRange: 'A1:A1'
    }))

    const menu = document.createElement('div')
    menu.setAttribute('data-selection-ignore', 'true')
    document.body.appendChild(menu)
    await act(async () => {
      menu.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await flushPromises()
    })
    menu.remove()

    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceKind: 'spreadsheet',
      cellRange: 'A1:A1'
    }))
  })
})

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
