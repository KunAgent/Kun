import type { DocModel, DocxSourceRef, resolveDocxSourceGeometry, revealDocxSource } from '@extend-ai/react-docx'
import type { WordAnnotationAnchor } from '@shared/work-annotation-anchor'
import { docxParagraphText } from '../../components/workspace-docx-model'
import { relocatedQuoteOffset } from './quote-offset'

type Paragraph = { id: string; text: string; from: number }
type Source = { paragraphs: Paragraph[]; text: string }
type WordViewer = {
  root: HTMLElement; version: string; source: () => Source
  resolve: typeof resolveDocxSourceGeometry; reveal: typeof revealDocxSource
}
const viewers = new WeakMap<Element, WordViewer>()

/** Use the full parsed model, including paragraphs on virtualized pages. */
export function registerWordAnchorViewer(root: HTMLElement, version: string, model: () => DocModel,
  resolve: typeof resolveDocxSourceGeometry, reveal: typeof revealDocxSource): () => void {
  let previous: DocModel | undefined, cached: Source
  const source = (): Source => {
    const next = model()
    if (previous === next) return cached
    const paragraphs: Paragraph[] = []
    let from = 0
    function collect(nodes: DocModel['nodes']): void {
      for (const node of nodes) {
        if (node.type === 'table') {
          for (const row of node.rows) for (const cell of row.cells) collect(cell.nodes)
        } else if (node.blockId) {
          const text = docxParagraphText(node)
          paragraphs.push({ id: node.blockId, text, from })
          from += text.length + 1
        }
      }
    }
    collect(next.nodes)
    cached = { paragraphs, text: paragraphs.map((p) => p.text).join('\n') }
    previous = next
    return cached
  }
  viewers.set(root, { root, version, source, resolve, reveal })
  return () => { viewers.delete(root) }
}

function viewerFor(root: HTMLElement): WordViewer | undefined {
  const element = root.matches('.kun-docx-surface') ? root : root.querySelector('.kun-docx-surface')
  return element ? viewers.get(element) : undefined
}

function point(node: Node, offset: number): WordAnnotationAnchor['start'] | null {
  const element = node.nodeType === node.ELEMENT_NODE ? node as Element : node.parentElement
  const paragraph = element?.closest<HTMLElement>('[data-docx-paragraph-host], [data-docx-source-kind="paragraph"]')
  const nodeId = paragraph?.dataset.docxSourceId
  const page = Number(element?.closest<HTMLElement>('[data-docx-page-index]')?.dataset.docxPageIndex) + 1
  if (!paragraph || !nodeId || !Number.isInteger(page) || page < 1) return null
  const run = element?.closest<HTMLElement>('[data-docx-text-start]')
  const before = paragraph.ownerDocument.createRange()
  before.selectNodeContents(run ?? paragraph)
  before.setEnd(node, offset)
  const count = before.toString().length
  return { nodeId, page, offset: Number(run?.dataset.docxTextStart ?? 0) + count }
}

export function wordAnnotation(root: HTMLElement, range: Range, version: string, selected: string): WordAnnotationAnchor | null {
  const viewer = viewerFor(root)
  if (!viewer || viewer.version !== version) return null
  const start = point(range.startContainer, range.startOffset), end = point(range.endContainer, range.endOffset)
  if (!start || !end) return null
  const source = viewer.source()
  const a = source.paragraphs.find((p) => p.id === start.nodeId)
  const b = source.paragraphs.find((p) => p.id === end.nodeId)
  if (!a || !b) return null
  const from = a.from + start.offset, to = b.from + end.offset
  const quote = source.text.slice(from, to)
  if (!quote.trim() || quote.length > 32768 ||
      quote.replace(/\s/g, '') !== selected.replace(/\s/g, '')) return null
  return { kind: 'word', version, quote, start, end,
    unique: source.text.indexOf(quote) === source.text.lastIndexOf(quote),
    before: source.text.slice(Math.max(0, from - 128), from), after: source.text.slice(to, to + 128) }
}

function wordRefs(viewer: WordViewer, anchor: WordAnnotationAnchor, version: string): DocxSourceRef[] {
  const source = viewer.source()
  let from: number, to: number
  if (version === anchor.version) {
    const a = source.paragraphs.find((p) => p.id === anchor.start.nodeId)
    const b = source.paragraphs.find((p) => p.id === anchor.end.nodeId)
    if (!a || !b) return []
    from = a.from + anchor.start.offset
    to = b.from + anchor.end.offset
    if (source.text.slice(from, to) !== anchor.quote) return []
  } else {
    // Word block IDs may be regenerated on save. An independent text match
    // must establish identity before selecting in different document bytes.
    const offset = relocatedQuoteOffset(source.text, anchor.quote, anchor)
    if (offset === null) return []
    from = offset
    to = from + anchor.quote.length
  }
  const documentId = viewer.root.querySelector<HTMLElement>('[data-docx-document-id]')?.dataset.docxDocumentId ?? ''
  return source.paragraphs.flatMap((p) => {
    const start = Math.max(0, from - p.from), end = Math.min(p.text.length, to - p.from)
    return end > start ? [{ documentId, nodeId: p.id, partName: 'word/document.xml', story: 'body', offsetEncoding: 'utf-16' as const, start, end }] : []
  })
}

export function locateWordAnnotation(root: HTMLElement, anchor: WordAnnotationAnchor, version: string, reveal: boolean): DOMRect[] | null {
  const viewer = viewerFor(root)
  if (!viewer || viewer.version !== version) return []
  const refs = wordRefs(viewer, anchor, version)
  if (!refs.length) return null
  if (reveal) viewer.reveal(viewer.root, refs[0])
  const { fragments } = viewer.resolve(viewer.root, refs)
  return fragments.flatMap((f) => {
    const page = viewer.root.querySelector(`[data-docx-page-index="${f.pageIndex}"] [data-docx-page-surface]`)?.getBoundingClientRect()
    if (!page || !f.pageHeight || !f.pageWidth) return []
    const x = page.width / f.pageWidth, y = page.height / f.pageHeight, box = f.boundingBox
    return [new DOMRect(page.left + box.left * x, page.top + box.top * y, (box.right - box.left) * x, (box.bottom - box.top) * y)]
  })
}
