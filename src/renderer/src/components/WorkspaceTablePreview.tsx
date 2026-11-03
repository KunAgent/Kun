import { useMemo, type ReactElement } from 'react'

type Translate = (key: string, values?: Record<string, unknown>) => string

export const TABLE_PREVIEW_MAX_ROWS = 5_000
export const TABLE_PREVIEW_MAX_COLUMNS = 200

export type ParsedTable = {
  rows: string[][]
  columnCount: number
  limited: boolean
}

/** RFC 4180 style parsing: quoted fields may hold delimiters, quotes ("") and line breaks. */
export function parseDelimitedTable(text: string, delimiter: ',' | '\t'): ParsedTable {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let limited = false
  const pushRow = (): boolean => {
    row.push(field)
    field = ''
    if (row.length > 1 || row[0] !== '') rows.push(row.slice(0, TABLE_PREVIEW_MAX_COLUMNS))
    if (row.length > TABLE_PREVIEW_MAX_COLUMNS) limited = true
    row = []
    return rows.length < TABLE_PREVIEW_MAX_ROWS + 1
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      if (!pushRow()) {
        limited = true
        break
      }
    } else {
      field += char
    }
  }
  if (!limited && (field !== '' || row.length > 0)) pushRow()
  if (rows.length > TABLE_PREVIEW_MAX_ROWS + 1) {
    rows.length = TABLE_PREVIEW_MAX_ROWS + 1
    limited = true
  }
  return { rows, columnCount: rows.reduce((max, item) => Math.max(max, item.length), 0), limited }
}

const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?(e[-+]?\d+)?%?$/i

type Props = {
  t: Translate
  content: string
  delimiter: ',' | '\t'
  truncatedFile: boolean
}

export function WorkspaceTablePreview({ t, content, delimiter, truncatedFile }: Props): ReactElement {
  const table = useMemo(() => parseDelimitedTable(content, delimiter), [content, delimiter])
  const [header = [], ...body] = table.rows
  const numericColumns = useMemo(() => {
    const columns: boolean[] = []
    for (let column = 0; column < table.columnCount; column += 1) {
      const values = body.slice(0, 200).map((row) => row[column]?.trim() ?? '').filter(Boolean)
      columns.push(values.length > 0 && values.every((value) => NUMERIC.test(value)))
    }
    return columns
  }, [body, table.columnCount])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {table.limited || truncatedFile ? (
        <div className="ds-file-preview-banner is-info">
          <span className="ds-file-preview-banner-text">{t('filePreviewTableLimited', { rows: body.length })}</span>
        </div>
      ) : null}
      <div className="ds-file-preview-table-wrap">
        <table className="ds-file-preview-table">
          <thead>
            <tr>
              <th scope="col" className="is-rownum" aria-label={t('filePreviewTableRow')} />
              {Array.from({ length: table.columnCount }, (_, column) => (
                <th key={column} scope="col" className={numericColumns[column] ? 'is-numeric' : undefined} title={header[column]}>
                  {header[column] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="is-rownum">{rowIndex + 1}</td>
                {Array.from({ length: table.columnCount }, (_, column) => (
                  <td key={column} className={numericColumns[column] ? 'is-numeric' : undefined} title={row[column]}>
                    {row[column] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
