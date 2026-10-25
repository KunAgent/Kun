import type { DocModel, DocNode, ParagraphNode, TableNode } from '@extend-ai/react-docx'

type ModelNodes = Pick<DocModel, 'nodes'>

/** Plain text of one paragraph; images and form fields contribute nothing. */
export function docxParagraphText(paragraph: ParagraphNode): string {
  let text = ''
  for (const child of paragraph.children) {
    if (child.type === 'text') text += child.text
  }
  return text
}

function tableParagraphs(table: TableNode): ParagraphNode[] {
  const found: ParagraphNode[] = []
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (const node of cell.nodes) {
        if (node.type === 'paragraph') found.push(node)
        else found.push(...tableParagraphs(node))
      }
    }
  }
  return found
}

function tableText(table: TableNode): string {
  return table.rows
    .map((row) => row.cells
      .map((cell) => cell.nodes
        .map((node) => node.type === 'paragraph' ? docxParagraphText(node) : tableText(node))
        .join(' ')
        .trim())
      .join('\t'))
    .join('\n')
}

/** The whole document as text: one line per paragraph, one tab-separated line per table row. */
export function docxModelText(model: ModelNodes): string {
  return model.nodes
    .map((node: DocNode) => node.type === 'paragraph' ? docxParagraphText(node) : tableText(node))
    .join('\n')
    .replace(/\u00a0/g, ' ')
    .trim()
}

/**
 * Body-level block that holds the Nth (1-based) non-empty paragraph. Table
 * paragraphs resolve to their table, which is what the viewer can reveal.
 */
export function docxBlockIdForParagraph(model: ModelNodes, paragraph: number): string | null {
  if (!Number.isInteger(paragraph) || paragraph < 1) return null
  let seen = 0
  let last: string | null = null
  for (const node of model.nodes) {
    const texts = node.type === 'paragraph'
      ? [docxParagraphText(node)]
      : tableParagraphs(node).map(docxParagraphText)
    for (const text of texts) {
      if (!text.trim()) continue
      seen += 1
      if (node.blockId) last = node.blockId
      if (seen === paragraph && node.blockId) return node.blockId
    }
  }
  // A number past the end lands on the last paragraph.
  return seen > 0 ? last : null
}
