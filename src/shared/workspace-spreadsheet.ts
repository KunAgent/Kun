export const MAX_WORKSPACE_SPREADSHEET_MUTATIONS = 10_000
export const MAX_WORKSPACE_SPREADSHEET_MUTATION_BYTES = 2 * 1024 * 1024
export const MAX_WORKSPACE_SPREADSHEET_FORMULA_CHARS = 8_192
export const MAX_WORKSPACE_SPREADSHEET_CELL_TEXT_CHARS = 32_767

export type WorkspaceSpreadsheetBorderPatch = {
  style: 'none' | 'thin' | 'medium' | 'thick' | 'double' | 'dashed' | 'dotted'
  color?: string | null
}

export type WorkspaceSpreadsheetCellStylePatch = {
  fontFamily?: string | null
  fontSize?: number | null
  bold?: boolean | null
  italic?: boolean | null
  underline?: 'none' | 'single' | 'double' | null
  strike?: boolean | null
  fontColor?: string | null
  fillColor?: string | null
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify' | 'fill' | 'distributed' | null
  verticalAlignment?: 'top' | 'center' | 'bottom' | null
  wrap?: boolean | null
  numberFormat?: string | null
  textRotation?: number | null
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', WorkspaceSpreadsheetBorderPatch | null>>
}

export type WorkspaceSpreadsheetCellMutation = {
  kind: 'cell'
  sheetName: string
  address: string
  value?: string | number | boolean | null
  formula?: string | null
  style?: WorkspaceSpreadsheetCellStylePatch
}

export type WorkspaceSpreadsheetMergeMutation = {
  kind: 'merge'
  sheetName: string
  range: string
  merged: boolean
}

export type WorkspaceSpreadsheetDimensionMutation = {
  kind: 'row' | 'column'
  sheetName: string
  index: number
  size?: number | null
  hidden?: boolean | null
}

export type WorkspaceSpreadsheetMutation =
  | WorkspaceSpreadsheetCellMutation
  | WorkspaceSpreadsheetMergeMutation
  | WorkspaceSpreadsheetDimensionMutation

export type WorkspaceSpreadsheetSavePayload = {
  path: string
  workspaceRoot: string
  expectedSha256: string
  mutations: WorkspaceSpreadsheetMutation[]
}

export type WorkspaceSpreadsheetSaveResult =
  | {
      ok: true
      path: string
      sourceSha256: string
      size: number
      mtimeMs: number
      appliedMutations: number
    }
  | {
      ok: false
      code:
        | 'invalid_request'
        | 'unsupported_type'
        | 'source_changed'
        | 'officecli_unavailable'
        | 'mutation_failed'
      message: string
    }

export type WorkspaceSpreadsheetConvertPayload = {
  path: string
  workspaceRoot: string
  expectedSha256: string
}

export type WorkspaceSpreadsheetConvertResult =
  | {
      ok: true
      path: string
      name: string
      sourceSha256: string
      size: number
      mtimeMs: number
    }
  | {
      ok: false
      code:
        | 'invalid_request'
        | 'unsupported_type'
        | 'source_changed'
        | 'libreoffice_unavailable'
        | 'conversion_failed'
      message: string
    }
