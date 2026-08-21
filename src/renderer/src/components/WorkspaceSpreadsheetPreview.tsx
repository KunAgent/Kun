import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { WorkBook } from 'xlsx'
import type { WorkspaceOfficePreviewSuccess, WorkspaceOfficeSelection } from '@shared/office-document'
import { WorkspaceOfficePreviewToolbar } from './WorkspaceOfficePreviewToolbar'
import {
  SPREADSHEET_WINDOW_COLUMNS,
  SPREADSHEET_WINDOW_ROWS,
  buildSpreadsheetWindow,
  readSpreadsheetRange
} from './workspace-spreadsheet-model'
import { subscribeKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'

type SheetJs = typeof import('xlsx')

type ParsedWorkbook = {
  xlsx: SheetJs
  workbook: WorkBook
}

type SpreadsheetSelectionPoint = {
  row: number
  column: number
  rowEnd: number
  columnEnd: number
}

type SpreadsheetSelectionRange = {
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

export function WorkspaceSpreadsheetPreview({
  result,
  loading,
  refreshError,
  onSelectionChange
}: {
  result: WorkspaceOfficePreviewSuccess
  loading: boolean
  refreshError?: string | null
  onSelectionChange?: (selection: WorkspaceOfficeSelection) => void
}): ReactElement {
  const draggingRef = useRef(false)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [rowStart, setRowStart] = useState(0)
  const [columnStart, setColumnStart] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [selectionStart, setSelectionStart] = useState<SpreadsheetSelectionPoint | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<SpreadsheetSelectionPoint | null>(null)

  useEffect(() => {
    let disposed = false
    void import('xlsx')
      .then(async (xlsx) => {
        if (result.renderFormat === 'xls') {
          const codepage = await import('xlsx/dist/cpexcel.full.mjs')
          xlsx.set_cptable(codepage)
        }
        const workbook = xlsx.read(result.data, {
          type: 'array',
          dense: false,
          cellDates: false,
          cellFormula: true,
          cellNF: false,
          cellStyles: false
        })
        if (workbook.SheetNames.length === 0) throw new Error('The workbook contains no worksheets.')
        if (disposed) return
        setParsed({ xlsx, workbook })
        setSheetIndex(0)
        setRowStart(0)
        setColumnStart(0)
        setError(null)
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause))
      })
    return () => {
      disposed = true
    }
  }, [result.data, result.renderFormat, result.sourceSha256])

  const activeSheetName = parsed?.workbook.SheetNames[sheetIndex]
  const activeSheet = activeSheetName ? parsed?.workbook.Sheets[activeSheetName] : undefined
  const tableWindow = useMemo(() => {
    if (!parsed || !activeSheet) return null
    return buildSpreadsheetWindow(parsed.xlsx.utils, activeSheet, rowStart, columnStart)
  }, [activeSheet, columnStart, parsed, rowStart])

  const selectedRange = useMemo(
    () => normalizeSpreadsheetSelection(selectionStart, selectionEnd),
    [selectionEnd, selectionStart]
  )

  const clearSelection = useCallback((): void => {
    draggingRef.current = false
    setSelectionStart(null)
    setSelectionEnd(null)
    if (onSelectionChange) {
      onSelectionChange({
        sourceKind: 'spreadsheet',
        sourceFormat: result.sourceFormat,
        text: '',
        charCount: 0
      })
    }
  }, [onSelectionChange, result.sourceFormat])

  const selectionActive = selectionStart !== null && selectionEnd !== null

  // Dismiss the selection when the pointer lands outside the table. Explicit
  // sidebar quote controls opt out so they can consume the current selection.
  useEffect(() => {
    if (!selectionActive) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null
      if (!target) return
      if (typeof target.closest === 'function' && target.closest('[data-selection-ignore="true"]')) {
        return
      }
      if (tableRef.current?.contains(target)) return
      clearSelection()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [selectionActive, clearSelection])

  useEffect(() => {
    const finish = (): void => { draggingRef.current = false }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [])

  useEffect(() => {
    if (!onSelectionChange || !tableWindow || !selectedRange || !activeSheetName) return
    const cells = new Map(
      tableWindow.rows.flatMap((row) => row.cells.map((cell) => [cell.key, cell] as const))
    )
    const lines: string[] = []
    const formulas: string[] = []
    for (let row = selectedRange.rowStart; row <= selectedRange.rowEnd; row += 1) {
      const values: string[] = []
      for (let column = selectedRange.columnStart; column <= selectedRange.columnEnd; column += 1) {
        const cell = cells.get(`${row}:${column}`)
        values.push(cell?.text ?? '')
        if (cell?.formula) formulas.push(`${columnLabel(column)}${row + 1}: ${cell.formula}`)
      }
      lines.push(values.join('\t'))
    }
    const text = lines.join('\n').trim()
    const selectionText = text || formulas.join('\n')
    if (!selectionText) return
    onSelectionChange({
      sourceKind: 'spreadsheet',
      sourceFormat: result.sourceFormat,
      text: selectionText,
      charCount: Array.from(selectionText).length,
      sheetName: activeSheetName,
      cellRange: spreadsheetRangeLabel(selectedRange),
      formulas
    })
  }, [activeSheetName, onSelectionChange, result.sourceFormat, selectedRange, tableWindow])

  useEffect(() => {
    clearSelection()
    // Clear selection whenever the source or rendered worksheet window changes.
  }, [clearSelection, result.sourceSha256, sheetIndex, rowStart, columnStart])

  const selectSheet = (nextSheetIndex: number): void => {
    if (!parsed) return
    const safeIndex = Math.max(0, Math.min(nextSheetIndex, parsed.workbook.SheetNames.length - 1))
    const name = parsed.workbook.SheetNames[safeIndex]
    const sheet = name ? parsed.workbook.Sheets[name] : undefined
    setSheetIndex(safeIndex)
    if (sheet) {
      const range = readSpreadsheetRange(parsed.xlsx.utils, sheet)
      setRowStart(range.s.r)
      setColumnStart(range.s.c)
    }
  }

  useEffect(() => subscribeKnowledgeSourceNavigation(result.path, (location) => {
    if (location.kind !== 'spreadsheet' || !parsed) return false
    const nextSheetIndex = parsed.workbook.SheetNames.indexOf(location.sheetName)
    if (nextSheetIndex < 0) return false
    let range
    try {
      range = parsed.xlsx.utils.decode_range(location.range)
    } catch {
      return false
    }
    setSheetIndex(nextSheetIndex)
    setRowStart(range.s.r)
    setColumnStart(range.s.c)
    return true
  }), [parsed, result.path])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ds-surface-subtle">
      <WorkspaceOfficePreviewToolbar
        result={result}
        loading={loading}
        refreshError={refreshError}
        viewerError={error}
        zoom={zoom}
        onZoomChange={setZoom}
      >
        {parsed ? (
          <select
            aria-label="Worksheet"
            className="max-w-44 rounded border border-ds-border-muted bg-ds-card px-1 py-0.5 text-[11px] text-ds-ink"
            value={sheetIndex}
            onChange={(event) => selectSheet(Number.parseInt(event.target.value, 10))}
          >
            {parsed.workbook.SheetNames.map((name, index) => (
              <option key={`${index}-${name}`} value={index}>{name}</option>
            ))}
          </select>
        ) : null}
        {tableWindow ? (
          <>
            <SpreadsheetPager
              label="Rows"
              start={tableWindow.rowStart}
              end={tableWindow.rowEnd}
              minimum={tableWindow.range.s.r}
              maximum={tableWindow.range.e.r}
              pageSize={SPREADSHEET_WINDOW_ROWS}
              onChange={setRowStart}
            />
            <SpreadsheetPager
              label="Columns"
              start={tableWindow.columnStart}
              end={tableWindow.columnEnd}
              minimum={tableWindow.range.s.c}
              maximum={tableWindow.range.e.c}
              pageSize={SPREADSHEET_WINDOW_COLUMNS}
              onChange={setColumnStart}
            />
          </>
        ) : null}
      </WorkspaceOfficePreviewToolbar>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tableWindow ? (
          <div className="origin-top-left" style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})` }}>
            <table ref={tableRef} className="border-collapse bg-white text-[11px] text-slate-900 shadow-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 min-w-12 border border-slate-300 bg-slate-100 px-2 py-1" />
                  {tableWindow.columnLabels.map((label) => (
                    <th key={label} scope="col" className="sticky top-0 z-10 min-w-24 border border-slate-300 bg-slate-100 px-2 py-1 text-center font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableWindow.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <th scope="row" className="sticky left-0 z-10 border border-slate-300 bg-slate-100 px-2 py-1 text-right font-semibold">{row.rowNumber}</th>
                    {row.cells.map((cell) => cell.hidden ? null : (() => {
                      const [cellRow, cellColumn] = cell.key.split(':').map(Number)
                      const point = spreadsheetSelectionPoint(
                        cellRow,
                        cellColumn,
                        cell.rowSpan,
                        cell.colSpan
                      )
                      const selected = selectedRange
                        ? spreadsheetCellIntersects(point, selectedRange)
                        : false
                      return (
                      <td
                        key={cell.key}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                        title={cell.formula}
                        data-office-sheet-cell={cell.key}
                        className={`max-w-80 whitespace-pre-wrap border border-slate-300 px-2 py-1 align-top ${onSelectionChange ? 'select-none' : ''} ${selected ? 'bg-accent/20 outline outline-1 -outline-offset-1 outline-accent/60' : ''}`}
                        onPointerDown={(event) => {
                          if (!onSelectionChange || event.button !== 0) return
                          event.preventDefault()
                          draggingRef.current = true
                          setSelectionStart(point)
                          setSelectionEnd(point)
                        }}
                        onPointerEnter={() => {
                          if (!onSelectionChange || !draggingRef.current) return
                          setSelectionEnd(point)
                        }}
                      >
                        {cell.text}
                      </td>
                      )
                    })())}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-ds-muted">Loading workbook…</div>
        ) : null}
      </div>
    </div>
  )
}

function SpreadsheetPager({
  label,
  start,
  end,
  minimum,
  maximum,
  pageSize,
  onChange
}: {
  label: string
  start: number
  end: number
  minimum: number
  maximum: number
  pageSize: number
  onChange: (start: number) => void
}): ReactElement {
  return (
    <div className="flex items-center gap-1 rounded border border-ds-border-muted px-1 py-0.5">
      <button type="button" aria-label={`Previous ${label.toLowerCase()}`} disabled={start <= minimum} className="rounded p-0.5 hover:bg-ds-hover disabled:opacity-40" onClick={() => onChange(Math.max(minimum, start - pageSize))}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span>{label} {start + 1}–{end + 1} / {maximum + 1}</span>
      <button type="button" aria-label={`Next ${label.toLowerCase()}`} disabled={end >= maximum} className="rounded p-0.5 hover:bg-ds-hover disabled:opacity-40" onClick={() => onChange(Math.min(maximum, start + pageSize))}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message || 'This workbook could not be rendered.'
}

function spreadsheetSelectionPoint(
  row: number,
  column: number,
  rowSpan = 1,
  columnSpan = 1
): SpreadsheetSelectionPoint {
  return {
    row,
    column,
    rowEnd: row + Math.max(1, rowSpan) - 1,
    columnEnd: column + Math.max(1, columnSpan) - 1
  }
}

export function normalizeSpreadsheetSelection(
  start: SpreadsheetSelectionPoint | null,
  end: SpreadsheetSelectionPoint | null
): SpreadsheetSelectionRange | null {
  if (!start || !end) return null
  return {
    rowStart: Math.min(start.row, end.row),
    rowEnd: Math.max(start.rowEnd, end.rowEnd),
    columnStart: Math.min(start.column, end.column),
    columnEnd: Math.max(start.columnEnd, end.columnEnd)
  }
}

function spreadsheetCellIntersects(
  point: SpreadsheetSelectionPoint,
  range: SpreadsheetSelectionRange
): boolean {
  return point.row <= range.rowEnd && point.rowEnd >= range.rowStart &&
    point.column <= range.columnEnd && point.columnEnd >= range.columnStart
}

function columnLabel(column: number): string {
  let current = Math.max(0, Math.floor(column)) + 1
  let label = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    current = Math.floor((current - 1) / 26)
  }
  return label
}

export function spreadsheetRangeLabel(range: SpreadsheetSelectionRange): string {
  return `${columnLabel(range.columnStart)}${range.rowStart + 1}:` +
    `${columnLabel(range.columnEnd)}${range.rowEnd + 1}`
}
