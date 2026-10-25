import type { XlsxCellRange, XlsxViewerController } from '@extend-ai/react-xlsx'

/** Cells read for one quoted selection; a larger range is cut off at whole rows. */
export const MAX_XLSX_SELECTION_CELLS = 20_000
/** Rows asked of the worker at once. */
const ROW_BATCH = 200

type SelectionSource = Pick<
  XlsxViewerController,
  'activeSheet' | 'getRowsBatchAsync' | 'getActiveWorksheet' | 'getCellDisplayValue' | 'getCellFormula'
>

export type XlsxSelectionRead = {
  text: string
  /** "B2: SUM(B1:B1)" for each formula cell that was read. */
  formulas: string[]
}

export type NormalizedXlsxRange = {
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

export function normalizeXlsxRange(range: XlsxCellRange): NormalizedXlsxRange {
  return {
    rowStart: Math.min(range.start.row, range.end.row),
    rowEnd: Math.max(range.start.row, range.end.row),
    columnStart: Math.min(range.start.col, range.end.col),
    columnEnd: Math.max(range.start.col, range.end.col)
  }
}

export function xlsxColumnLabel(column: number): string {
  let current = Math.max(0, Math.floor(column)) + 1
  let label = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    current = Math.floor((current - 1) / 26)
  }
  return label
}

export function xlsxCellAddress(row: number, column: number): string {
  return `${xlsxColumnLabel(column)}${row + 1}`
}

/** "B3:H10" for a selection, always start:end (a single cell reads "B3:B3"). */
export function xlsxRangeLabel(range: XlsxCellRange): string {
  const normalized = normalizeXlsxRange(range)
  return `${xlsxCellAddress(normalized.rowStart, normalized.columnStart)}:${xlsxCellAddress(normalized.rowEnd, normalized.columnEnd)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function displayText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return ''
  // The worker returns display strings with markup characters escaped.
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function formulaBody(formula: unknown): string {
  return typeof formula === 'string' ? formula.replace(/^=/, '').trim() : ''
}

/** The selection as tab-separated rows plus its formulas, without a second copy of the workbook. */
export async function readXlsxSelection(
  controller: SelectionSource,
  range: XlsxCellRange,
  signal?: AbortSignal
): Promise<XlsxSelectionRead> {
  signal?.throwIfAborted()
  const sheet = controller.activeSheet
  if (!sheet) throw new Error('No worksheet is open')
  const { rowStart, rowEnd, columnStart, columnEnd } = normalizeXlsxRange(range)
  const columns = columnEnd - columnStart + 1
  const lastRow = Math.min(rowEnd, rowStart + Math.max(1, Math.floor(MAX_XLSX_SELECTION_CELLS / columns)) - 1)
  const grid = Array.from({ length: lastRow - rowStart + 1 }, () => Array<string>(columns).fill(''))
  const formulas: string[] = []

  if (controller.getRowsBatchAsync) {
    for (let batchStart = rowStart; batchStart <= lastRow; batchStart += ROW_BATCH) {
      const count = Math.min(ROW_BATCH, lastRow - batchStart + 1)
      const rows = await controller.getRowsBatchAsync(sheet.workbookSheetIndex, batchStart, count)
      signal?.throwIfAborted()
      if (!rows) throw new Error('Worksheet rows are unavailable')
      for (const row of rows) {
        if (!isRecord(row) || typeof row.index !== 'number' || !Array.isArray(row.cells)) continue
        if (row.index < rowStart || row.index > lastRow) continue
        for (const cell of row.cells) {
          if (!isRecord(cell) || typeof cell.col !== 'number') continue
          if (cell.col < columnStart || cell.col > columnEnd || cell.isMergedSecondary === true) continue
          let value = displayText(cell.value)
          const formula = formulaBody(cell.formula)
          if (formula) {
            const address = xlsxCellAddress(row.index, cell.col)
            const cached = sheet.cachedFormulaValues[address]
            if (cached !== undefined && value.startsWith('#')) value = cached
            formulas.push(`${address}: ${formula}`)
          }
          grid[row.index - rowStart]![cell.col - columnStart] = value
        }
      }
    }
  } else {
    const worksheet = controller.getActiveWorksheet()
    for (let row = rowStart; row <= lastRow; row += 1) {
      for (let column = columnStart; column <= columnEnd; column += 1) {
        if (worksheet?.isMergedSecondary(row, column)) continue
        const address = { row, col: column }
        grid[row - rowStart]![column - columnStart] = controller.getCellDisplayValue(address)
        const formula = formulaBody(controller.getCellFormula(address))
        if (formula) formulas.push(`${xlsxCellAddress(row, column)}: ${formula}`)
      }
    }
  }
  signal?.throwIfAborted()
  return { text: grid.map((cells) => cells.join('\t')).join('\n').trim(), formulas }
}
