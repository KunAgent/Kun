import type {
  ICellData,
  IStyleData,
  IWorkbookData,
  IWorksheetData
} from '@univerjs/core'
import type { WorkBook, WorkSheet } from 'xlsx'
import type {
  WorkspaceSpreadsheetCellStylePatch,
  WorkspaceSpreadsheetMutation
} from '@shared/workspace-spreadsheet'
import { MAX_WORKSPACE_SPREADSHEET_MUTATIONS } from '@shared/workspace-spreadsheet'
import type { XlsxStyleOverrides } from './workspace-xlsx-style-reader'

const DEFAULT_ROWS = 200
const DEFAULT_COLUMNS = 26
const MAX_ROWS = 1_048_576
const MAX_COLUMNS = 16_384

export type NormalizedSpreadsheetCell = {
  value?: string | number | boolean
  formula?: string
  style?: WorkspaceSpreadsheetCellStylePatch
}

export type NormalizedSpreadsheetSheet = {
  id: string
  name: string
  cells: Record<string, NormalizedSpreadsheetCell>
  merges: string[]
  rows: Record<number, { size?: number; hidden?: boolean }>
  columns: Record<number, { size?: number; hidden?: boolean }>
}

export type NormalizedSpreadsheetWorkbook = {
  sourceSha256: string
  sheetOrder: string[]
  sheets: Record<string, NormalizedSpreadsheetSheet>
}

export type UniverWorkbookConversion = {
  workbookData: IWorkbookData
  baseline: NormalizedSpreadsheetWorkbook
}

export function sheetJsWorkbookToUniver(
  workbook: WorkBook,
  sourceSha256: string,
  title: string,
  styleOverrides: XlsxStyleOverrides = {}
): UniverWorkbookConversion {
  const sheets: IWorkbookData['sheets'] = {}
  const sheetOrder: string[] = []
  const normalizedSheets: Record<string, NormalizedSpreadsheetSheet> = {}
  workbook.SheetNames.forEach((name, sheetIndex) => {
    const source = workbook.Sheets[name]
    if (!source) return
    const id = `sheet_${sheetIndex + 1}`
    const converted = convertSheet(
      source,
      id,
      name,
      workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden,
      styleOverrides[name]
    )
    sheetOrder.push(id)
    sheets[id] = converted.data
    normalizedSheets[id] = converted.normalized
  })
  if (sheetOrder.length === 0) throw new Error('The workbook contains no worksheets.')
  return {
    workbookData: {
      id: `kun_${sourceSha256.slice(0, 20)}`,
      name: title,
      appVersion: '0.25.1',
      locale: 'zhCN' as IWorkbookData['locale'],
      styles: {},
      sheetOrder,
      sheets
    },
    baseline: { sourceSha256, sheetOrder, sheets: normalizedSheets }
  }
}

export function normalizeUniverWorkbook(
  workbookData: IWorkbookData,
  sourceSha256: string
): NormalizedSpreadsheetWorkbook {
  const sheets: Record<string, NormalizedSpreadsheetSheet> = {}
  for (const id of workbookData.sheetOrder) {
    const sheet = workbookData.sheets[id]
    if (!sheet?.name) continue
    const cells: Record<string, NormalizedSpreadsheetCell> = {}
    for (const [rowKey, columns] of Object.entries(sheet.cellData ?? {})) {
      const row = Number(rowKey)
      if (!Number.isInteger(row) || !columns) continue
      for (const [columnKey, cell] of Object.entries(columns)) {
        const column = Number(columnKey)
        if (!Number.isInteger(column) || !cell) continue
        const normalized = normalizeUniverCell(cell, workbookData.styles)
        if (hasCellState(normalized)) cells[encodeCell(row, column)] = normalized
      }
    }
    const rows = Object.fromEntries(Object.entries(sheet.rowData ?? {}).flatMap(([key, value]) => {
      if (!value) return []
      const index = Number(key) + 1
      const next = {
        ...(typeof value.h === 'number' ? { size: round(value.h * 0.75) } : {}),
        ...(value.hd !== undefined ? { hidden: value.hd === 1 } : {})
      }
      return Object.keys(next).length ? [[index, next]] : []
    }))
    const columns = Object.fromEntries(Object.entries(sheet.columnData ?? {}).flatMap(([key, value]) => {
      if (!value) return []
      const index = Number(key) + 1
      const next = {
        ...(typeof value.w === 'number' ? { size: pixelsToColumnWidth(value.w) } : {}),
        ...(value.hd !== undefined ? { hidden: value.hd === 1 } : {})
      }
      return Object.keys(next).length ? [[index, next]] : []
    }))
    sheets[id] = {
      id,
      name: sheet.name,
      cells,
      merges: (sheet.mergeData ?? []).map((range) => encodeRange(range)).sort(),
      rows,
      columns
    }
  }
  return { sourceSha256, sheetOrder: [...workbookData.sheetOrder], sheets }
}

export function diffUniverWorkbook(
  baseline: NormalizedSpreadsheetWorkbook,
  workbookData: IWorkbookData
): {
  mutations: WorkspaceSpreadsheetMutation[]
  unsupportedReason?: string
  baseFingerprints?: Record<string, string>
} {
  const current = normalizeUniverWorkbook(workbookData, baseline.sourceSha256)
  if (
    current.sheetOrder.length !== baseline.sheetOrder.length ||
    current.sheetOrder.some((id, index) => id !== baseline.sheetOrder[index])
  ) return { mutations: [], unsupportedReason: 'Adding, deleting, or reordering worksheets is not supported by XLSX patch saving.' }

  const mutations: WorkspaceSpreadsheetMutation[] = []
  for (const id of baseline.sheetOrder) {
    const before = baseline.sheets[id]
    const after = current.sheets[id]
    if (!before || !after || before.name !== after.name) {
      return { mutations: [], unsupportedReason: 'Renaming worksheets is not supported by XLSX patch saving.' }
    }
    for (const address of unionKeys(before.cells, after.cells)) {
      const mutation = diffCell(before.name, address, before.cells[address], after.cells[address])
      if (mutation) mutations.push(mutation)
    }
    for (const range of before.merges.filter((range) => !after.merges.includes(range))) {
      mutations.push({ kind: 'merge', sheetName: before.name, range, merged: false })
    }
    for (const range of after.merges.filter((range) => !before.merges.includes(range))) {
      mutations.push({ kind: 'merge', sheetName: before.name, range, merged: true })
    }
    diffDimensions(mutations, 'row', before.name, before.rows, after.rows)
    diffDimensions(mutations, 'column', before.name, before.columns, after.columns)
    if (mutations.length > MAX_WORKSPACE_SPREADSHEET_MUTATIONS) {
      return {
        mutations: [],
        unsupportedReason: `This edit changes more than ${MAX_WORKSPACE_SPREADSHEET_MUTATIONS} spreadsheet items. Save a smaller batch.`
      }
    }
  }
  return mutations.length > 0
    ? {
        mutations,
        baseFingerprints: Object.fromEntries(mutations.map((mutation) => [
          spreadsheetMutationTargetKey(mutation),
          fingerprintSpreadsheetMutationTarget(baseline, mutation)
        ]))
      }
    : { mutations }
}

export function spreadsheetMutationTargetKey(mutation: WorkspaceSpreadsheetMutation): string {
  if (mutation.kind === 'cell') return `cell:${mutation.sheetName}:${mutation.address}`
  if (mutation.kind === 'merge') return `merge:${mutation.sheetName}:${mutation.range}`
  return `${mutation.kind}:${mutation.sheetName}:${mutation.index}`
}

export function fingerprintSpreadsheetMutationTarget(
  workbook: NormalizedSpreadsheetWorkbook,
  mutation: WorkspaceSpreadsheetMutation
): string {
  const sheet = workbook.sheetOrder
    .map((id) => workbook.sheets[id])
    .find((candidate) => candidate?.name === mutation.sheetName)
  if (!sheet) return fingerprintValue(null)
  if (mutation.kind === 'cell') return fingerprintValue(sheet.cells[mutation.address] ?? null)
  if (mutation.kind === 'merge') return fingerprintValue(sheet.merges.includes(mutation.range))
  const dimensions = mutation.kind === 'row' ? sheet.rows : sheet.columns
  return fingerprintValue(dimensions[mutation.index] ?? null)
}

export function applySpreadsheetMutations(
  workbookData: IWorkbookData,
  mutations: WorkspaceSpreadsheetMutation[]
): IWorkbookData {
  const copy = structuredClone(workbookData)
  for (const mutation of mutations) {
    const sheetId = copy.sheetOrder.find((id) => copy.sheets[id]?.name === mutation.sheetName)
    const sheet = sheetId ? copy.sheets[sheetId] : undefined
    if (!sheet) continue
    if (mutation.kind === 'merge') {
      const range = decodeRange(mutation.range)
      const merges = sheet.mergeData ?? []
      sheet.mergeData = mutation.merged
        ? [...merges.filter((item) => encodeRange(item) !== mutation.range), range]
        : merges.filter((item) => encodeRange(item) !== mutation.range)
      continue
    }
    if (mutation.kind === 'row' || mutation.kind === 'column') {
      const index = mutation.index - 1
      if (mutation.kind === 'row') {
        const target = (sheet.rowData ??= {})
        const entry = target[index] ?? {}
        if (Object.prototype.hasOwnProperty.call(mutation, 'size')) {
          entry.h = mutation.size == null ? undefined : mutation.size / 0.75
        }
        if (Object.prototype.hasOwnProperty.call(mutation, 'hidden')) entry.hd = mutation.hidden ? 1 : 0
        target[index] = entry
      } else {
        const target = (sheet.columnData ??= {})
        const entry = target[index] ?? {}
        if (Object.prototype.hasOwnProperty.call(mutation, 'size')) {
          entry.w = mutation.size == null ? undefined : columnWidthToPixels(mutation.size)
        }
        if (Object.prototype.hasOwnProperty.call(mutation, 'hidden')) entry.hd = mutation.hidden ? 1 : 0
        target[index] = entry
      }
      continue
    }
    if (mutation.kind !== 'cell') throw new Error(`Unsupported spreadsheet mutation: ${mutation.kind}`)
    const { row, column } = decodeCell(mutation.address)
    const rows = (sheet.cellData ??= {})
    const columns = (rows[row] ??= {})
    const cell = (columns[column] ??= {})
    if (Object.prototype.hasOwnProperty.call(mutation, 'formula')) {
      cell.f = mutation.formula ? ensureFormulaPrefix(mutation.formula) : null
    }
    if (Object.prototype.hasOwnProperty.call(mutation, 'value')) {
      cell.v = mutation.value
      cell.t = valueType(mutation.value)
    }
    if (mutation.style) cell.s = applyStylePatch(resolveStyle(cell.s, copy.styles), mutation.style)
  }
  return copy
}

function convertSheet(
  sheet: WorkSheet,
  id: string,
  name: string,
  hidden: number | undefined,
  styleOverrides: Record<string, WorkspaceSpreadsheetCellStylePatch> | undefined
): { data: Partial<IWorksheetData>; normalized: NormalizedSpreadsheetSheet } {
  const range = safeSheetRange(sheet)
  const cellData: NonNullable<IWorksheetData['cellData']> = {}
  const cells: Record<string, NormalizedSpreadsheetCell> = {}
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue
    const point = decodeCell(key)
    const source = sheet[key]
    if (!source || point.row < 0 || point.column < 0) continue
    const style = styleOverrides?.[key.toUpperCase()] ?? sheetJsStyle(source)
    const cell: ICellData = {
      ...(source.v !== undefined && source.v !== null ? { v: normalizeScalar(source.v), t: valueType(normalizeScalar(source.v)) } : {}),
      ...(source.f ? { f: ensureFormulaPrefix(source.f) } : {}),
      ...(style ? { s: stylePatchToUniver(style) } : {})
    }
    ;(cellData[point.row] ??= {})[point.column] = cell
    const normalized = normalizeUniverCell(cell, {})
    if (hasCellState(normalized)) cells[key.toUpperCase()] = normalized
  }
  const mergeData = (sheet['!merges'] ?? []).map((item) => ({
    startRow: item.s.r,
    endRow: item.e.r,
    startColumn: item.s.c,
    endColumn: item.e.c
  }))
  const rowData: NonNullable<IWorksheetData['rowData']> = {}
  const rows: NormalizedSpreadsheetSheet['rows'] = {}
  ;(sheet['!rows'] ?? []).forEach((row, index) => {
    if (!row) return
    const heightPx = row.hpx ?? (typeof row.hpt === 'number' ? row.hpt / 0.75 : undefined)
    rowData[index] = {
      ...(heightPx !== undefined ? { h: heightPx } : {}),
      ...(row.hidden !== undefined ? { hd: row.hidden ? 1 : 0 } : {})
    }
    rows[index + 1] = {
      ...(row.hpt !== undefined ? { size: round(row.hpt) } : heightPx !== undefined ? { size: round(heightPx * 0.75) } : {}),
      ...(row.hidden !== undefined ? { hidden: row.hidden } : {})
    }
  })
  const columnData: NonNullable<IWorksheetData['columnData']> = {}
  const columns: NormalizedSpreadsheetSheet['columns'] = {}
  ;(sheet['!cols'] ?? []).forEach((column, index) => {
    if (!column) return
    const widthPx = column.wpx ?? (typeof column.wch === 'number' ? columnWidthToPixels(column.wch) : undefined)
    columnData[index] = {
      ...(widthPx !== undefined ? { w: widthPx } : {}),
      ...(column.hidden !== undefined ? { hd: column.hidden ? 1 : 0 } : {})
    }
    columns[index + 1] = {
      ...(column.wch !== undefined ? { size: round(column.wch) } : widthPx !== undefined ? { size: pixelsToColumnWidth(widthPx) } : {}),
      ...(column.hidden !== undefined ? { hidden: column.hidden } : {})
    }
  })
  return {
    data: {
      id,
      name,
      tabColor: '',
      hidden: hidden ? 1 : 0,
      freeze: { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 },
      rowCount: Math.min(MAX_ROWS, Math.max(DEFAULT_ROWS, range.endRow + 101)),
      columnCount: Math.min(MAX_COLUMNS, Math.max(DEFAULT_COLUMNS, range.endColumn + 21)),
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      mergeData,
      cellData,
      rowData,
      columnData,
      rowHeader: { width: 46 },
      columnHeader: { height: 24 },
      showGridlines: 1,
      rightToLeft: 0
    },
    normalized: {
      id,
      name,
      cells,
      merges: mergeData.map(encodeRange).sort(),
      rows,
      columns
    }
  }
}

function diffCell(
  sheetName: string,
  address: string,
  before: NormalizedSpreadsheetCell | undefined,
  after: NormalizedSpreadsheetCell | undefined
): WorkspaceSpreadsheetMutation | null {
  const mutation: Extract<WorkspaceSpreadsheetMutation, { kind: 'cell' }> = {
    kind: 'cell', sheetName, address
  }
  const beforeFormula = before?.formula
  const afterFormula = after?.formula
  if (beforeFormula !== afterFormula) {
    mutation.formula = afterFormula ?? null
    if (!afterFormula) mutation.value = after?.value ?? null
  } else if (!afterFormula && before?.value !== after?.value) {
    mutation.value = after?.value ?? null
  }
  const style = diffStyle(before?.style, after?.style)
  if (style) mutation.style = style
  return Object.keys(mutation).length > 3 ? mutation : null
}

function diffStyle(
  before: WorkspaceSpreadsheetCellStylePatch | undefined,
  after: WorkspaceSpreadsheetCellStylePatch | undefined
): WorkspaceSpreadsheetCellStylePatch | undefined {
  const patch: WorkspaceSpreadsheetCellStylePatch = {}
  for (const key of [
    'fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike',
    'fontColor', 'fillColor', 'horizontalAlignment', 'verticalAlignment',
    'wrap', 'numberFormat', 'textRotation'
  ] as const) {
    if (before?.[key] !== after?.[key]) (patch as Record<string, unknown>)[key] = after?.[key] ?? null
  }
  const borders: NonNullable<WorkspaceSpreadsheetCellStylePatch['borders']> = {}
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (JSON.stringify(before?.borders?.[side]) !== JSON.stringify(after?.borders?.[side])) {
      borders[side] = after?.borders?.[side] ?? null
    }
  }
  if (Object.keys(borders).length) patch.borders = borders
  return Object.keys(patch).length ? patch : undefined
}

function diffDimensions(
  output: WorkspaceSpreadsheetMutation[],
  kind: 'row' | 'column',
  sheetName: string,
  before: Record<number, { size?: number; hidden?: boolean }>,
  after: Record<number, { size?: number; hidden?: boolean }>
): void {
  for (const key of unionKeys(before, after)) {
    const index = Number(key)
    const previous = before[index]
    const current = after[index]
    const mutation: Extract<WorkspaceSpreadsheetMutation, { kind: 'row' | 'column' }> = {
      kind, sheetName, index
    }
    if (previous?.size !== current?.size) mutation.size = current?.size ?? null
    if (previous?.hidden !== current?.hidden) mutation.hidden = current?.hidden ?? null
    if (Object.keys(mutation).length > 3) output.push(mutation)
  }
}

function normalizeUniverCell(
  cell: ICellData,
  styles: IWorkbookData['styles']
): NormalizedSpreadsheetCell {
  const formula = typeof cell.f === 'string' && cell.f ? ensureFormulaPrefix(cell.f) : undefined
  const value = normalizeScalar(cell.v)
  const style = univerStyleToPatch(resolveStyle(cell.s, styles))
  return {
    ...(formula ? { formula } : value !== undefined ? { value } : {}),
    ...(style ? { style } : {})
  }
}

function sheetJsStyle(cell: WorkSheet[string]): WorkspaceSpreadsheetCellStylePatch | undefined {
  const raw = cell.s as Record<string, unknown> | undefined
  const fill = raw?.fgColor as { rgb?: string } | undefined
  const font = raw?.font as Record<string, unknown> | undefined
  const alignment = raw?.alignment as Record<string, unknown> | undefined
  const style: WorkspaceSpreadsheetCellStylePatch = {
    ...(cell.z ? { numberFormat: String(cell.z) } : {}),
    ...(fill?.rgb ? { fillColor: normalizeColor(fill.rgb) } : {}),
    ...(typeof font?.name === 'string' ? { fontFamily: font.name } : {}),
    ...(typeof font?.sz === 'number' ? { fontSize: font.sz } : {}),
    ...(font?.bold ? { bold: true } : {}),
    ...(font?.italic ? { italic: true } : {}),
    ...(typeof (font?.color as { rgb?: string } | undefined)?.rgb === 'string'
      ? { fontColor: normalizeColor((font!.color as { rgb: string }).rgb) }
      : {}),
    ...(alignment?.horizontal ? { horizontalAlignment: alignment.horizontal as NonNullable<WorkspaceSpreadsheetCellStylePatch['horizontalAlignment']> } : {}),
    ...(alignment?.vertical ? { verticalAlignment: alignment.vertical as NonNullable<WorkspaceSpreadsheetCellStylePatch['verticalAlignment']> } : {}),
    ...(alignment?.wrapText !== undefined ? { wrap: Boolean(alignment.wrapText) } : {})
  }
  return Object.keys(style).length ? style : undefined
}

function stylePatchToUniver(style: WorkspaceSpreadsheetCellStylePatch): IStyleData {
  return applyStylePatch({}, style)
}

function applyStylePatch(base: IStyleData, style: WorkspaceSpreadsheetCellStylePatch): IStyleData {
  const next = { ...base }
  if ('fontFamily' in style) next.ff = style.fontFamily ?? undefined
  if ('fontSize' in style) next.fs = style.fontSize ?? undefined
  if ('bold' in style) next.bl = style.bold ? 1 : 0
  if ('italic' in style) next.it = style.italic ? 1 : 0
  if ('underline' in style) next.ul = { s: style.underline && style.underline !== 'none' ? 1 : 0, t: style.underline === 'double' ? 10 : 12 }
  if ('strike' in style) next.st = { s: style.strike ? 1 : 0 }
  if ('fontColor' in style) next.cl = style.fontColor ? { rgb: style.fontColor } : undefined
  if ('fillColor' in style) next.bg = style.fillColor ? { rgb: style.fillColor } : undefined
  if ('horizontalAlignment' in style) next.ht = horizontalToUniver(style.horizontalAlignment)
  if ('verticalAlignment' in style) next.vt = verticalToUniver(style.verticalAlignment)
  if ('wrap' in style) next.tb = style.wrap ? 3 : 1
  if ('numberFormat' in style) next.n = style.numberFormat ? { pattern: style.numberFormat } : undefined
  if ('textRotation' in style) next.tr = style.textRotation == null ? undefined : { a: style.textRotation }
  if (style.borders) {
    const borders = { ...(next.bd ?? {}) }
    for (const [side, border] of Object.entries(style.borders)) {
      const key = ({ top: 't', right: 'r', bottom: 'b', left: 'l' } as const)[side as 'top']
      if (!key) continue
      borders[key] = border ? { s: borderToUniver(border.style), cl: { rgb: border.color ?? '#000000' } } : null
    }
    next.bd = borders
  }
  return next
}

function univerStyleToPatch(style: IStyleData): WorkspaceSpreadsheetCellStylePatch | undefined {
  const patch: WorkspaceSpreadsheetCellStylePatch = {
    ...(style.ff ? { fontFamily: style.ff } : {}),
    ...(style.fs !== undefined ? { fontSize: style.fs } : {}),
    ...(style.bl !== undefined ? { bold: style.bl === 1 } : {}),
    ...(style.it !== undefined ? { italic: style.it === 1 } : {}),
    ...(style.ul ? { underline: style.ul.s === 0 ? 'none' : style.ul.t === 10 ? 'double' : 'single' } : {}),
    ...(style.st ? { strike: style.st.s === 1 } : {}),
    ...(style.cl?.rgb ? { fontColor: normalizeColor(style.cl.rgb) } : {}),
    ...(style.bg?.rgb ? { fillColor: normalizeColor(style.bg.rgb) } : {}),
    ...(style.ht ? { horizontalAlignment: horizontalFromUniver(style.ht) } : {}),
    ...(style.vt ? { verticalAlignment: verticalFromUniver(style.vt) } : {}),
    ...(style.tb !== undefined ? { wrap: style.tb === 3 } : {}),
    ...(style.n?.pattern ? { numberFormat: style.n.pattern } : {}),
    ...(style.tr?.a !== undefined ? { textRotation: style.tr.a } : {})
  }
  const borders: NonNullable<WorkspaceSpreadsheetCellStylePatch['borders']> = {}
  for (const [side, key] of Object.entries({ top: 't', right: 'r', bottom: 'b', left: 'l' }) as Array<[keyof typeof borders, 't' | 'r' | 'b' | 'l']>) {
    const border = style.bd?.[key]
    if (border) borders[side] = { style: borderFromUniver(border.s), ...(border.cl?.rgb ? { color: normalizeColor(border.cl.rgb) } : {}) }
  }
  if (Object.keys(borders).length) patch.borders = borders
  return Object.keys(patch).length ? patch : undefined
}

function resolveStyle(value: ICellData['s'], styles: IWorkbookData['styles']): IStyleData {
  if (!value) return {}
  return typeof value === 'string' ? styles[value] ?? {} : value
}

function safeSheetRange(sheet: WorkSheet): { endRow: number; endColumn: number } {
  try {
    const decoded = decodeRange(sheet['!ref'] || 'A1:A1')
    return { endRow: Math.min(MAX_ROWS - 1, decoded.endRow), endColumn: Math.min(MAX_COLUMNS - 1, decoded.endColumn) }
  } catch {
    return { endRow: 0, endColumn: 0 }
  }
}

function decodeCell(address: string): { row: number; column: number } {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address)
  if (!match) return { row: -1, column: -1 }
  let column = 0
  for (const character of match[1]!.toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

function encodeCell(row: number, column: number): string {
  let value = column + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + value % 26) + label
    value = Math.floor(value / 26)
  }
  return `${label}${row + 1}`
}

function decodeRange(range: string): { startRow: number; endRow: number; startColumn: number; endColumn: number } {
  const [start, end = start] = range.split(':')
  const from = decodeCell(start!)
  const to = decodeCell(end!)
  if (from.row < 0 || to.row < 0) throw new Error(`Invalid spreadsheet range: ${range}`)
  return { startRow: from.row, endRow: to.row, startColumn: from.column, endColumn: to.column }
}

function encodeRange(range: { startRow: number; endRow: number; startColumn: number; endColumn: number }): string {
  return `${encodeCell(range.startRow, range.startColumn)}:${encodeCell(range.endRow, range.endColumn)}`
}

function normalizeScalar(value: unknown): string | number | boolean | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : value instanceof Date
      ? value.toISOString()
      : undefined
}

function valueType(value: unknown): 1 | 2 | 3 | null {
  return typeof value === 'string' ? 1 : typeof value === 'number' ? 2 : typeof value === 'boolean' ? 3 : null
}

function ensureFormulaPrefix(formula: string): string {
  return formula.startsWith('=') ? formula : `=${formula}`
}

function hasCellState(cell: NormalizedSpreadsheetCell): boolean {
  return cell.value !== undefined || cell.formula !== undefined || cell.style !== undefined
}

function unionKeys(a: object, b: object): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
}

function normalizeColor(color: string): string {
  const value = color.trim().replace(/^#/, '')
  return `#${value.length === 8 ? value.slice(2) : value}`.toUpperCase()
}

function horizontalToUniver(value: WorkspaceSpreadsheetCellStylePatch['horizontalAlignment']): 1 | 2 | 3 | 4 | 6 | undefined {
  return ({ left: 1, center: 2, right: 3, justify: 4, fill: 4, distributed: 6 } as const)[value as 'left']
}

function verticalToUniver(value: WorkspaceSpreadsheetCellStylePatch['verticalAlignment']): 1 | 2 | 3 | undefined {
  return ({ top: 1, center: 2, bottom: 3 } as const)[value as 'top']
}

function horizontalFromUniver(value: number): NonNullable<WorkspaceSpreadsheetCellStylePatch['horizontalAlignment']> {
  return ({ 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'distributed' } as const)[value as 1] ?? 'left'
}

function verticalFromUniver(value: number): NonNullable<WorkspaceSpreadsheetCellStylePatch['verticalAlignment']> {
  return ({ 1: 'top', 2: 'center', 3: 'bottom' } as const)[value as 1] ?? 'bottom'
}

function borderToUniver(style: string): number {
  return ({ none: 0, thin: 1, dotted: 3, dashed: 4, double: 7, medium: 8, thick: 13 } as Record<string, number>)[style] ?? 0
}

function borderFromUniver(style: number): NonNullable<NonNullable<WorkspaceSpreadsheetCellStylePatch['borders']>['top']>['style'] {
  return ({ 0: 'none', 1: 'thin', 3: 'dotted', 4: 'dashed', 7: 'double', 8: 'medium', 13: 'thick' } as const)[style as 0] ?? 'thin'
}

function columnWidthToPixels(width: number): number {
  return Math.max(0, Math.round(width * 7 + 5))
}

function pixelsToColumnWidth(pixels: number): number {
  return round(Math.max(0, (pixels - 5) / 7))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function fingerprintValue(value: unknown): string {
  const input = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}
