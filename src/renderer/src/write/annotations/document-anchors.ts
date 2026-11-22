import type { Editor } from '@tiptap/core'
import { EditorView } from '@codemirror/view'
import type { PdfAnnotationAnchor, WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import type { WriteEditorSelectionState } from '../../components/write/write-markdown-editor-types'
import { markdownAnchor, resolveMarkdownAnnotation } from './markdown-anchor'
import { richAnnotationDom, richAnnotationSource } from './rich-anchor'
import { locateWordAnnotation } from './word-anchor'

export { resolveMarkdownAnnotation } from './markdown-anchor'

export type AnnotationView = {
  root: HTMLElement
  markdown: string
  version: string
  richEditor?: Editor | null
}
type Location = { rects: DOMRect[]; status: 'attached' | 'unmounted' | 'detached' }
const detached = (): Location => ({ rects: [], status: 'detached' })
const position = (rects: DOMRect[]): Location => ({ rects, status: rects.length ? 'attached' : 'unmounted' })

function pageElement(root: HTMLElement, number: number): HTMLElement | null {
  return root.querySelector(`[data-write-pdf-page="${number}"]`)
}

function pdfAnnotation(view: AnnotationView, selection: WriteEditorSelectionState): PdfAnnotationAnchor | null {
  if (!view.version || !selection.rects?.length || selection.rects.length > 2048) return null
  const rects: PdfAnnotationAnchor['rects'] = []
  for (const rect of selection.rects) {
    const el = pageElement(view.root, rect.page)
    if (!el) return null
    const w = parseFloat(el.style.width) || el.offsetWidth, h = parseFloat(el.style.height) || el.offsetHeight
    if (!w || !h) return null
    const x = Math.max(0, Math.min(1, rect.x / w)), y = Math.max(0, Math.min(1, rect.y / h))
    const width = Math.min(1 - x, rect.width / w), height = Math.min(1 - y, rect.height / h)
    if (width > 0 && height > 0) rects.push({ page: rect.page, x, y, width, height })
  }
  if (!rects.length) return null
  const dom = view.root.ownerDocument.getSelection()
  let before = '', after = ''
  if (dom?.rangeCount && dom.toString().trim() === selection.text.trim()) {
    const range = dom.getRangeAt(0)
    const first = pageElement(view.root, rects[0].page), last = pageElement(view.root, rects[rects.length - 1].page)
    if (first?.contains(range.startContainer) && last?.contains(range.endContainer)) {
      const context = range.cloneRange()
      context.selectNodeContents(first)
      context.setEnd(range.startContainer, range.startOffset)
      before = context.toString().slice(-128)
      context.selectNodeContents(last)
      context.setStart(range.endContainer, range.endOffset)
      after = context.toString().slice(0, 128)
    }
  }
  return { kind: 'pdf', quote: selection.text, before, after, version: view.version, rects }
}

function codeMirror(root: HTMLElement): EditorView | null {
  const content = root.querySelector<HTMLElement>('.cm-content')
  return content ? EditorView.findFromDOM(content) : null
}

// CodeMirror stores a line break as one character, including for CRLF files.
function rawOffset(source: string, projected: number): number {
  if (!source.includes('\r\n')) return projected
  let lost = 0
  for (let cr = source.indexOf('\r\n'); cr >= 0 && cr - lost < projected; cr = source.indexOf('\r\n', cr + 2)) lost++
  return projected + lost
}
function cmOffset(source: string, raw: number): number {
  return raw - (source.slice(0, raw).match(/\r\n/g)?.length ?? 0)
}

export function captureAnnotationAnchor(view: AnnotationView, kind: WorkAnnotationAnchor['kind'],
  selection: WriteEditorSelectionState): WorkAnnotationAnchor | null {
  if (!selection.text.trim() || selection.text.length > 32768) return null
  if (kind === 'word') {
    const word = selection.annotationAnchor
    return word && word.version === view.version ? word : null
  }
  if (kind === 'pdf') return pdfAnnotation(view, selection)
  const range = selection.ranges[0], editor = view.richEditor
  if (editor) {
    if (!selection.richRange || editor.isDestroyed || !view.root.contains(editor.view.dom)) return null
    const source = richAnnotationSource(editor, view.markdown, selection.richRange)
    if (!source) return null
    const anchor = markdownAnchor(view.markdown, source.from, source.to, selection.text)
    // Crossing inline markup consumes only one delimiter at each open edge.
    // Replace this selection through the rich schema so surrounding spans keep their marks.
    if (anchor && selection.ranges.length && anchor.source !== selection.text) anchor.richText = true
    return anchor
  }
  if (!range || selection.ranges.length !== 1) return null
  const from = rawOffset(view.markdown, range.from), to = rawOffset(view.markdown, range.to)
  if (view.markdown.slice(from, to).replace(/\r\n/g, '\n') !== range.text) return null
  return markdownAnchor(view.markdown, from, to, range.text)
}

function pdfRects(view: AnnotationView, anchor: PdfAnnotationAnchor) {
  const pages = new Map<number, DOMRect | undefined>()
  return anchor.rects.flatMap((r) => {
    if (!pages.has(r.page)) pages.set(r.page, pageElement(view.root, r.page)?.getBoundingClientRect())
    const p = pages.get(r.page)
    return p?.width && p.height ? [new DOMRect(p.x + p.width * r.x, p.y + p.height * r.y,
      p.width * r.width, p.height * r.height)] : []
  })
}

function markdownLocation(view: AnnotationView, anchor: Extract<WorkAnnotationAnchor, { kind: 'markdown' }>, reveal: boolean): Location {
  const target = resolveMarkdownAnnotation(view.markdown, anchor)
  if (!target) return detached()
  const editor = view.richEditor
  if (editor && !editor.isDestroyed && view.root.contains(editor.view.dom)) {
    const dom = richAnnotationDom(editor, view.markdown, target)
    if (!dom) return position([])
    if (reveal) {
      const el = dom instanceof Element ? dom : dom.startContainer.parentElement
      el?.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    return position(Array.from(dom.getClientRects()).filter((r) => r.width > 0 && r.height > 0))
  }
  const cm = codeMirror(view.root)
  if (!cm) return position([])
  const from = cmOffset(view.markdown, target.from), to = cmOffset(view.markdown, target.to)
  if (to > cm.state.doc.length) return position([])
  if (reveal) cm.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) })
  const rects: DOMRect[] = []
  for (const visible of cm.visibleRanges) {
    const start = Math.max(from, visible.from), end = Math.min(to, visible.to)
    if (end <= start) continue
    const a = cm.domAtPos(start), b = cm.domAtPos(end)
    const r = cm.dom.ownerDocument.createRange()
    r.setStart(a.node, a.offset)
    r.setEnd(b.node, b.offset)
    rects.push(...Array.from(r.getClientRects()).filter((box) => box.width && box.height))
  }
  return position(rects)
}

export function locateAnnotation(view: AnnotationView, anchor: WorkAnnotationAnchor): Location {
  if (anchor.kind === 'markdown') return markdownLocation(view, anchor, false)
  if (anchor.kind === 'pdf') return view.version === anchor.version ? position(pdfRects(view, anchor)) : detached()
  const rects = locateWordAnnotation(view.root, anchor, view.version, false)
  return rects === null ? detached() : position(rects)
}

export function revealAnnotation(view: AnnotationView, anchor: WorkAnnotationAnchor): void {
  if (anchor.kind === 'markdown') { markdownLocation(view, anchor, true); return }
  if (anchor.kind === 'word') { locateWordAnnotation(view.root, anchor, view.version, true); return }
  if (anchor.version !== view.version) return
  const mark = anchor.rects[0], page = pageElement(view.root, mark.page)
  if (!page) return
  const target = page.ownerDocument.createElement('span')
  target.style.cssText = 'position:absolute;pointer-events:none;width:1px;height:1px'
  target.style.top = `${mark.y * 100}%`
  target.style.left = `${mark.x * 100}%`
  page.appendChild(target)
  target.scrollIntoView({ block: 'center', inline: 'nearest' })
  target.remove()
}
