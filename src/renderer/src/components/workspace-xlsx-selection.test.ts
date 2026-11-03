import { describe, expect, it, vi } from 'vitest'
import {
  MAX_XLSX_SELECTION_CELLS,
  normalizeXlsxRange,
  readXlsxSelection,
  xlsxCellAddress,
  xlsxColumnLabel,
  xlsxRangeLabel
} from './workspace-xlsx-selection'

const range = (r1: number, c1: number, r2: number, c2: number) => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 }
})

type Cell = { col: number; value: string; formula?: string; isMergedSecondary?: true }

function source(rows: Record<number, Cell[]>, overrides: Record<string, unknown> = {}) {
  return {
    activeSheet: { workbookSheetIndex: 3, cachedFormulaValues: { B2: '42' } },
    getActiveWorksheet: () => null,
    getCellDisplayValue: () => '',
    getCellFormula: () => '',
    getRowsBatchAsync: vi.fn(async (_sheet: number, start: number, count: number) =>
      Array.from({ length: count }, (_, offset) => ({
        index: start + offset,
        cells: rows[start + offset] ?? []
      }))),
    ...overrides
  } as never
}

describe('spreadsheet addresses', () => {
  it('labels columns past Z', () => {
    expect([0, 25, 26, 51, 701, 702].map(xlsxColumnLabel)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'])
    expect(xlsxCellAddress(9, 27)).toBe('AB10')
  })

  it('normalizes reversed ranges and labels them start:end', () => {
    expect(normalizeXlsxRange(range(9, 7, 2, 1))).toEqual({ rowStart: 2, rowEnd: 9, columnStart: 1, columnEnd: 7 })
    expect(xlsxRangeLabel(range(9, 7, 2, 1))).toBe('B3:H10')
    expect(xlsxRangeLabel(range(0, 0, 0, 0))).toBe('A1:A1')
  })
})

describe('readXlsxSelection', () => {
  it('reads the selected rectangle as tab-separated rows and decodes escaped text', async () => {
    const read = await readXlsxSelection(source({
      0: [{ col: 0, value: 'skip' }, { col: 1, value: 'a &amp; b' }, { col: 2, value: '&lt;tag&gt;' }, { col: 3, value: 'skip' }],
      1: [{ col: 1, value: '7' }, { col: 2, value: '' }]
    }), range(0, 1, 1, 2))
    expect(read).toEqual({ text: 'a & b\t<tag>\n7', formulas: [] })
  })

  it('lists formulas without the leading equals sign and keeps cached values over errors', async () => {
    const read = await readXlsxSelection(source({
      1: [
        { col: 1, value: '#NAME?', formula: '=SUM(A1:A9)' },
        { col: 2, value: '3', formula: 'B2+1' }
      ]
    }), range(1, 1, 1, 2))
    expect(read.text).toBe('42\t3')
    expect(read.formulas).toEqual(['B2: SUM(A1:A9)', 'C2: B2+1'])
  })

  it('leaves merged secondary cells empty', async () => {
    const read = await readXlsxSelection(source({
      0: [{ col: 0, value: 'Merged' }, { col: 1, value: 'hidden', isMergedSecondary: true }, { col: 2, value: 'End' }]
    }), range(0, 0, 0, 2))
    expect(read.text).toBe('Merged\t\tEnd')
  })

  it('asks the worker for rows in batches', async () => {
    const batched = source({})
    await readXlsxSelection(batched, range(0, 0, 449, 1))
    const calls = (batched as unknown as { getRowsBatchAsync: ReturnType<typeof vi.fn> }).getRowsBatchAsync.mock.calls
    expect(calls.map(([sheet, start, count]) => [sheet, start, count])).toEqual([[3, 0, 200], [3, 200, 200], [3, 400, 50]])
  })

  it('cuts a huge selection off at whole rows', async () => {
    const wide = source({ 0: [{ col: 0, value: 'x' }] })
    await readXlsxSelection(wide, range(0, 0, 1_048_575, 1_023))
    const calls = (wide as unknown as { getRowsBatchAsync: ReturnType<typeof vi.fn> }).getRowsBatchAsync.mock.calls
    const rows = calls.reduce((total, [, , count]) => total + (count as number), 0)
    expect(rows * 1_024).toBeLessThanOrEqual(MAX_XLSX_SELECTION_CELLS)
    expect(rows).toBe(Math.floor(MAX_XLSX_SELECTION_CELLS / 1_024))
  })

  it('falls back to per-cell reads when the workbook is not in a worker', async () => {
    const read = await readXlsxSelection(source({}, {
      getRowsBatchAsync: undefined,
      getActiveWorksheet: () => ({ isMergedSecondary: (_row: number, col: number) => col === 1 }),
      getCellDisplayValue: ({ row, col }: { row: number; col: number }) => `r${row}c${col}`,
      getCellFormula: ({ row, col }: { row: number; col: number }) => (col === 0 ? `=A${row + 1}` : '')
    }), range(0, 0, 1, 1))
    expect(read.text).toBe('r0c0\t\nr1c0')
    expect(read.formulas).toEqual(['A1: A1', 'A2: A2'])
  })

  it('stops when the request is cancelled and fails without a worksheet', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(readXlsxSelection(source({}), range(0, 0, 0, 0), controller.signal)).rejects.toThrow()
    await expect(readXlsxSelection({ activeSheet: null } as never, range(0, 0, 0, 0))).rejects.toThrow('No worksheet')
  })
})
