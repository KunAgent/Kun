import * as xlsx from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  applySpreadsheetMutations,
  diffUniverWorkbook,
  normalizeUniverWorkbook,
  sheetJsWorkbookToUniver
} from './workspace-univer-model'

function fixture() {
  const workbook = xlsx.utils.book_new()
  const sheet = xlsx.utils.aoa_to_sheet([
    ['Item', 'Amount', 'Enabled'],
    ['Alpha', 12.5, true]
  ])
  sheet.B2.f = 'SUM(B2,0)'
  sheet.A1.z = '@'
  sheet.A1.s = {
    patternType: 'solid',
    fgColor: { rgb: 'FFFF00' },
    font: { bold: true, name: 'Arial', sz: 12, color: { rgb: 'FF0000' } },
    alignment: { horizontal: 'center', wrapText: true }
  } as never
  sheet['!merges'] = [xlsx.utils.decode_range('A3:C3')]
  sheet['!rows'] = [{ hpt: 24 }, { hidden: true }]
  sheet['!cols'] = [{ wch: 18 }, { hidden: true }]
  xlsx.utils.book_append_sheet(workbook, sheet, 'Budget')
  return sheetJsWorkbookToUniver(workbook, 'a'.repeat(64), 'budget.xlsx')
}

describe('SheetJS to Univer workbook conversion', () => {
  it('preserves sparse values, formulas, merges, dimensions, number formats, and supported styles', () => {
    const converted = fixture()
    const sheet = converted.workbookData.sheets.sheet_1!

    expect(converted.workbookData.sheetOrder).toEqual(['sheet_1'])
    expect(sheet.name).toBe('Budget')
    expect(sheet.cellData?.[0]?.[0]).toMatchObject({
      v: 'Item',
      t: 1,
      s: {
        ff: 'Arial', fs: 12, bl: 1, bg: { rgb: '#FFFF00' },
        cl: { rgb: '#FF0000' }, ht: 2, tb: 3, n: { pattern: '@' }
      }
    })
    expect(sheet.cellData?.[1]?.[1]).toMatchObject({ v: 12.5, t: 2, f: '=SUM(B2,0)' })
    expect(sheet.cellData?.[1]?.[2]).toMatchObject({ v: true, t: 3 })
    expect(sheet.mergeData).toEqual([{ startRow: 2, endRow: 2, startColumn: 0, endColumn: 2 }])
    expect(converted.baseline.sheets.sheet_1).toMatchObject({
      merges: ['A3:C3'],
      rows: { 1: { size: 24 }, 2: { hidden: true } },
      columns: { 1: { size: 18 }, 2: { hidden: true } }
    })
  })

  it('does not treat a formula cached value as a user mutation', () => {
    const converted = fixture()
    const changed = structuredClone(converted.workbookData)
    changed.sheets.sheet_1!.cellData![1]![1]!.v = 99
    expect(diffUniverWorkbook(converted.baseline, changed)).toEqual({ mutations: [] })
  })
})

describe('Univer workbook mutation diff', () => {
  it('tracks content, formula, style, merge, row, and column changes', () => {
    const converted = fixture()
    const changed = structuredClone(converted.workbookData)
    changed.sheets.sheet_1!.cellData![0]![0] = {
      v: 'Updated',
      t: 1,
      s: { bl: 0, bg: { rgb: '#00FF00' }, n: { pattern: '@' } }
    }
    changed.sheets.sheet_1!.cellData![1]![1] = { f: '=B1*2', t: 2 }
    changed.sheets.sheet_1!.mergeData = []
    changed.sheets.sheet_1!.rowData![0]!.h = 40
    changed.sheets.sheet_1!.columnData![0]!.w = 145

    expect(diffUniverWorkbook(converted.baseline, changed).mutations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'cell', sheetName: 'Budget', address: 'A1', value: 'Updated',
        style: expect.objectContaining({ bold: false, fillColor: '#00FF00' })
      }),
      { kind: 'cell', sheetName: 'Budget', address: 'B2', formula: '=B1*2' },
      { kind: 'merge', sheetName: 'Budget', range: 'A3:C3', merged: false },
      { kind: 'row', sheetName: 'Budget', index: 1, size: 30 },
      { kind: 'column', sheetName: 'Budget', index: 1, size: 20 }
    ]))
  })

  it('removes mutations after applying and reverting to the source baseline', () => {
    const converted = fixture()
    const edited = applySpreadsheetMutations(converted.workbookData, [
      { kind: 'cell', sheetName: 'Budget', address: 'A2', value: 'Local' },
      { kind: 'merge', sheetName: 'Budget', range: 'A4:B4', merged: true }
    ])
    const edits = diffUniverWorkbook(converted.baseline, edited)
    expect(edits.mutations).toHaveLength(2)

    const sourceCell = converted.baseline.sheets.sheet_1!.cells.A2!
    const reverted = applySpreadsheetMutations(edited, [
      { kind: 'cell', sheetName: 'Budget', address: 'A2', value: sourceCell.value ?? null },
      { kind: 'merge', sheetName: 'Budget', range: 'A4:B4', merged: false }
    ])
    expect(diffUniverWorkbook(converted.baseline, reverted)).toEqual({ mutations: [] })
  })

  it('blocks worksheet structure changes instead of silently omitting them', () => {
    const converted = fixture()
    const changed = structuredClone(converted.workbookData)
    changed.sheetOrder.push('new_sheet')
    changed.sheets.new_sheet = { id: 'new_sheet', name: 'New' }
    expect(diffUniverWorkbook(converted.baseline, changed)).toMatchObject({
      mutations: [],
      unsupportedReason: expect.stringContaining('worksheets')
    })
  })

  it('normalizes an applied mutation into a stable cell state', () => {
    const converted = fixture()
    const edited = applySpreadsheetMutations(converted.workbookData, [{
      kind: 'cell',
      sheetName: 'Budget',
      address: 'C2',
      value: false,
      style: { bold: true, horizontalAlignment: 'right', numberFormat: 'General' }
    }])
    expect(normalizeUniverWorkbook(edited, converted.baseline.sourceSha256).sheets.sheet_1?.cells.C2).toEqual({
      value: false,
      style: { bold: true, horizontalAlignment: 'right', numberFormat: 'General' }
    })
  })
})
