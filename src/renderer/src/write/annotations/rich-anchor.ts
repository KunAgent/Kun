import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Nodes, RootContent } from 'mdast'
import { splitFrontmatter } from '@shared/markdown/frontmatter'
import { parseWorkMdast } from '@shared/markdown/parse-mdast'
import { mdastToPm } from '../markdown/mdast-to-pm'
import { WorkSourceMap } from '../markdown/source-map'
import { splitSoftLineParagraphs } from '../markdown/soft-line-split'

type Span = { from: number; to: number }
type Leaf = { value: string; source: Span; literal: Span | null; edges?: number[]; math: boolean }
type Mapping = Leaf & { pm: Span }
const cache = new WeakMap<PmNode, { source: string; spans: Mapping[] }>()

/** Markdown escapes and character references occupy different numbers of
 * UTF-16 units in the source and the rendered paragraph. Retain boundaries
 * only when the decoded source exactly reproduces the parser's text. */
function decodedEdges(raw: string, expected: string, start: number): number[] | undefined {
  const edges = [start]
  let decoded = ''
  for (let i = 0; i < raw.length;) {
    let value = raw[i], consumed = 1
    if (value === '\\' && /^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/.test(raw[i + 1] ?? '')) {
      value = raw[i + 1]
      consumed = 2
    } else if (value === '&') {
      const entity = /^&(?:#[xX][0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.exec(raw.slice(i))?.[0]
      if (entity && typeof document !== 'undefined') {
        const decoder = document.createElement('textarea')
        decoder.innerHTML = entity
        value = decoder.value
        consumed = entity.length
      }
    }
    decoded += value
    for (let j = 1; j <= value.length; j++) edges.push(start + i + (j === value.length ? consumed : 0))
    i += consumed
  }
  return decoded === expected ? edges : undefined
}
// A selected ProseMirror position lives in the rendered tree. Recover its
// literal source leaf from the same parse and block layout as the Work codec.
// A syntax delimiter, link URL or frontmatter field is never searched as prose.
function sourceLeaves(node: Nodes, raw: string, block: Span): Leaf[] {
  const leaves: Leaf[] = []
  let cursor = block.from
  function visit(n: Nodes): void {
    if ('children' in n) {
      for (const child of n.children) visit(child)
      return
    }
    if (!['text', 'code', 'inlineCode', 'math', 'inlineMath'].includes(n.type) || !('value' in n)) return
    const text = n.value
    const math = n.type === 'math' || n.type === 'inlineMath'
    const start = n.position?.start.offset ?? raw.indexOf(text, cursor)
    const end = n.position?.end.offset ?? start + text.length
    if (start < block.from || end > block.to || end < start) return
    const fragment = raw.slice(start, end)
    // A fenced code block's info string may equal its body.
    const fence = n.type === 'code' && /^\s*(?:`{3,}|~{3,})/.test(fragment)
    const inside = fence || n.type === 'math' ? Math.max(0, fragment.indexOf('\n') + 1) : 0
    const at = fragment.indexOf(text, inside)
    const edges = at < 0 && n.type === 'text' ? decodedEdges(fragment, text, start) : undefined
    const literal = edges ? { from: start, to: end } : at < 0 ? null : { from: start + at, to: start + at + text.length }
    leaves.push({ value: text, source: { from: start, to: end }, literal, math, edges })
    cursor = end
  }
  visit(node)
  return leaves
}

function mappings(doc: PmNode, source: string): Mapping[] {
  const existing = cache.get(doc)
  if (existing?.source === source) return existing.spans
  const { frontmatter, body } = splitFrontmatter(source)
  const root = parseWorkMdast(body)
  root.children = splitSoftLineParagraphs(root.children, body)
  const blocks: RootContent[] = []
  mdastToPm(root, { body, sourceMap: new WorkSourceMap(), onTopBlock: (_node, ast) => { blocks.push(ast) } })
  const spans: Mapping[] = []
  doc.forEach((blockNode, pos, index) => {
    const ast = blocks[index]
    if (!ast || ast.position?.start.offset === undefined || ast.position.end.offset === undefined) return
    const leaves = sourceLeaves(ast, body, { from: ast.position.start.offset, to: ast.position.end.offset })
    const rendered: { value: string; pm: Span; math: boolean }[] = []
    function add(n: PmNode, start: number) {
      const math = n.type.name === 'inlineMath' || n.type.name === 'blockMath'
      if (n.isText || math) rendered.push({
        value: math ? String(n.attrs.latex ?? '') : n.text ?? '', math, pm: { from: start, to: start + n.nodeSize }
      })
    }
    add(blockNode, pos)
    blockNode.descendants((n, relative) => { add(n, pos + 1 + relative) })
    if (rendered.length !== leaves.length || rendered.some((n, i) => n.math !== leaves[i].math || n.value !== leaves[i].value)) return
    leaves.forEach((leaf, i) => {
      const shift = (s: Span): Span => ({ from: s.from + frontmatter.length, to: s.to + frontmatter.length })
      spans.push({ ...leaf, pm: rendered[i].pm, source: shift(leaf.source), literal: leaf.literal && shift(leaf.literal),
        edges: leaf.edges?.map((edge) => edge + frontmatter.length) })
    })
  })
  cache.set(doc, { source, spans })
  return spans
}

export function richAnnotationSource(editor: Editor, source: string, selection: Span & { latexRange?: Span }): Span | null {
  const spans = mappings(editor.state.doc, source)
  const first = spans.find((s) => s.pm.from <= selection.from && s.pm.to > selection.from)
  const last = spans.find((s) => s.pm.from < selection.to && s.pm.to >= selection.to)
  if (!first || !last) return null
  if (first.math && first === last) {
    if (!selection.latexRange) return first.source
    if (!first.literal || selection.latexRange.from < 0 || selection.latexRange.to > first.value.length) return null
    return { from: first.literal.from + selection.latexRange.from, to: first.literal.from + selection.latexRange.to }
  }
  if (!first.literal || !last.literal) return null
  return {
    from: first.math ? first.source.from : (first.edges?.[selection.from - first.pm.from] ?? first.literal.from + selection.from - first.pm.from),
    to: last.math ? last.source.to : (last.edges?.[selection.to - last.pm.from] ?? last.literal.from + selection.to - last.pm.from)
  }
}

export function richAnnotationPositions(doc: PmNode, source: string, target: Span) {
  const spans = mappings(doc, source)
  const usable = (s: Mapping) => s.math ? s.source : s.literal
  const first = spans.find((s) => { const a = usable(s); return a && a.to > target.from && a.from < target.to })
  const last = [...spans].reverse().find((s) => { const a = usable(s); return a && a.from < target.to && a.to > target.from })
  if (!first || !last) return null
  const startIndex = first.edges?.findIndex((edge) => edge >= target.from)
  const endIndex = last.edges?.findIndex((edge) => edge >= target.to)
  const start = first.math ? first.pm.from : first.pm.from + (startIndex ?? Math.max(0, target.from - first.literal!.from))
  const end = last.math ? last.pm.to : endIndex !== undefined && endIndex >= 0
    ? last.pm.from + endIndex : last.pm.to - Math.max(0, last.literal!.to - target.to)
  return { from: start, to: end, atom: first === last && first.math }
}

export function richAnnotationDom(editor: Editor, source: string, target: Span): Range | Element | null {
  const pos = richAnnotationPositions(editor.state.doc, source, target)
  if (!pos) return null
  if (pos.atom) {
    const element = editor.view.nodeDOM(pos.from)
    return element instanceof Element ? element : null
  }
  const a = editor.view.domAtPos(pos.from, 1), b = editor.view.domAtPos(pos.to, -1)
  const dom = editor.view.dom.ownerDocument.createRange()
  dom.setStart(a.node, a.offset)
  dom.setEnd(b.node, b.offset)
  return dom
}
