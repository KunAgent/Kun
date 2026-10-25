import { describe, expect, it } from 'vitest'
import type { DocModel } from '@extend-ai/react-docx'
import { docxBlockIdForParagraph, docxModelText, docxParagraphText } from './workspace-docx-model'

const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (value: string, blockId?: string) => ({
  type: 'paragraph',
  ...(blockId ? { blockId } : {}),
  children: value ? [text(value)] : []
})
const table = (blockId: string, rows: string[][]) => ({
  type: 'table',
  blockId,
  rows: rows.map((cells) => ({
    type: 'table-row',
    cells: cells.map((cell) => ({ type: 'table-cell', nodes: [paragraph(cell)] }))
  }))
})
const model = (...nodes: unknown[]): Pick<DocModel, 'nodes'> => ({ nodes } as unknown as Pick<DocModel, 'nodes'>)

describe('Word model helpers', () => {
  it('reads paragraph text from text runs only', () => {
    expect(docxParagraphText({
      type: 'paragraph',
      children: [text('Hello '), { type: 'image' }, text('world')]
    } as never)).toBe('Hello world')
  })

  it('flattens the document into lines with tab-separated table rows', () => {
    expect(docxModelText(model(
      paragraph('Title', 'b/0'),
      paragraph(''),
      table('b/2', [['Region', 'Q1'], ['North', '120']]),
      paragraph('Closing note', 'b/3')
    ))).toBe('Title\n\nRegion\tQ1\nNorth\t120\nClosing note')
  })

  it('finds the block holding the Nth non-empty paragraph', () => {
    const doc = model(
      paragraph('Title', 'b/0'),
      paragraph('   ', 'b/1'),
      paragraph('First body line', 'b/2'),
      table('b/3', [['Region', 'Q1'], ['North', '120']]),
      paragraph('After the table', 'b/4')
    )
    expect(docxBlockIdForParagraph(doc, 1)).toBe('b/0')
    expect(docxBlockIdForParagraph(doc, 2)).toBe('b/2')
    // Table cells count as paragraphs and resolve to the table the viewer can reveal.
    expect(docxBlockIdForParagraph(doc, 3)).toBe('b/3')
    expect(docxBlockIdForParagraph(doc, 6)).toBe('b/3')
    expect(docxBlockIdForParagraph(doc, 7)).toBe('b/4')
  })

  it('clamps numbers past the end and rejects invalid ones', () => {
    const doc = model(paragraph('Only', 'b/0'))
    expect(docxBlockIdForParagraph(doc, 99)).toBe('b/0')
    expect(docxBlockIdForParagraph(doc, 0)).toBeNull()
    expect(docxBlockIdForParagraph(doc, 1.5)).toBeNull()
    expect(docxBlockIdForParagraph(model(paragraph('')), 1)).toBeNull()
  })
})
