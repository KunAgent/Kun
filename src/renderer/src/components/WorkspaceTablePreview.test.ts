import { describe, expect, it } from 'vitest'
import { TABLE_PREVIEW_MAX_ROWS, parseDelimitedTable } from './WorkspaceTablePreview'
import { formatHexDump } from './WorkspaceFilePreviewStates'
import { nextImageZoom } from './WorkspaceImageViewer'
import { workspaceLineEnding } from './WorkspaceFilePreviewStatusBar'

describe('delimited table parsing', () => {
  it('handles quoted delimiters, escaped quotes and line breaks inside fields', () => {
    const table = parseDelimitedTable('name,note\r\n"Kun, Inc","said ""hi""\nthen left"\nplain,x\n', ',')
    expect(table.rows).toEqual([
      ['name', 'note'],
      ['Kun, Inc', 'said "hi"\nthen left'],
      ['plain', 'x']
    ])
    expect(table.columnCount).toBe(2)
    expect(table.limited).toBe(false)
  })

  it('parses tab-separated files and caps very long tables', () => {
    expect(parseDelimitedTable('a\tb\n1\t2', '\t').rows).toEqual([['a', 'b'], ['1', '2']])
    const long = ['h', ...Array.from({ length: TABLE_PREVIEW_MAX_ROWS + 50 }, (_, index) => String(index))].join('\n')
    const capped = parseDelimitedTable(long, ',')
    expect(capped.limited).toBe(true)
    expect(capped.rows).toHaveLength(TABLE_PREVIEW_MAX_ROWS + 1)
  })
})

describe('preview helpers', () => {
  it('formats a hex dump with offsets and printable ASCII', () => {
    const base64 = Buffer.from('GGUF\u0003\u0000\u0000\u0000general.arch').toString('base64')
    const [first, second] = formatHexDump(base64)
    expect(first.offset).toBe('00000000')
    expect(first.bytes.startsWith('47 47 55 46 03 00 00 00  67 65')).toBe(true)
    expect(first.ascii).toBe('|GGUF....general.|')
    expect(second.ascii).toBe('|arch|')
  })

  it('steps image zoom through fixed levels', () => {
    expect(nextImageZoom(1, 1)).toBe(2)
    expect(nextImageZoom(1, -1)).toBe(0.5)
    expect(nextImageZoom(16, 1)).toBe(16)
    expect(nextImageZoom(0.3, 1)).toBe(0.5)
  })

  it('reports the line ending of the first line break', () => {
    expect(workspaceLineEnding('a\r\nb')).toBe('CRLF')
    expect(workspaceLineEnding('a\nb')).toBe('LF')
    expect(workspaceLineEnding('single line')).toBeNull()
  })
})
