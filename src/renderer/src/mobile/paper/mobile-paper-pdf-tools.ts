import type { PDFDocumentProxy, PDFOutlineItem } from 'pdfjs-dist/build/pdf.mjs'

export async function findPaperPdfPage(document: PDFDocumentProxy, query: string, startPage: number,
  cancelled: () => boolean): Promise<number | null> {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle || !document.numPages) return null
  for (let offset = 0; offset < document.numPages; offset += 1) {
    if (cancelled()) return null
    const index = ((Math.max(1, startPage) - 1 + offset) % document.numPages) + 1
    const pdfPage = await document.getPage(index)
    const text = await pdfPage.getTextContent()
    if (cancelled()) return null
    if (text.items.map((item) => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase().includes(needle)) {
      return index
    }
    if (index !== startPage) pdfPage.cleanup()
  }
  return null
}

export async function resolvePaperOutlinePage(document: PDFDocumentProxy, item: PDFOutlineItem): Promise<number | null> {
  if (!item.dest) return null
  const dest = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
  const ref = dest?.[0]
  if (typeof ref === 'number') return ref + 1
  return ref ? await document.getPageIndex(ref) + 1 : null
}

export function flattenPaperOutline(items: PDFOutlineItem[], max = 100): Array<{ item: PDFOutlineItem; depth: number }> {
  const rows: Array<{ item: PDFOutlineItem; depth: number }> = []
  const visit = (nodes: PDFOutlineItem[], depth: number): void => {
    for (const item of nodes) {
      if (rows.length >= max) return
      rows.push({ item, depth })
      if (depth < 4 && item.items?.length) visit(item.items, depth + 1)
    }
  }
  visit(items, 0)
  return rows
}
