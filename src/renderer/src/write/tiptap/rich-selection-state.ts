/**
 * Selection contract derived from the ProseMirror selection, expressed in
 * markdown-projection coordinates so inline edit scopes, quoted selections,
 * and completion contexts share one coordinate space. Split out of
 * WriteRichEditor.tsx per the S1 file-size plan.
 */
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type {
  WriteEditorSelectionState,
  WriteSelectionAnchorRect,
  WriteSelectionRange
} from '../../components/write/WriteMarkdownEditor'
import type { WorkDocContext } from '../markdown/document-codec'
import {
  buildWriteRichMarkdownProjection,
  projectedOffsetForPos
} from './markdown-projection'
import { isSelectableRasterImageSrc } from '../selected-image'
import type { WriteBlockType } from '../block-type'

/** Block type of the current selection, walking outward from the cursor. */
export function richSelectionBlockType(state: EditorState): WriteBlockType {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    const name = node.type.name
    if (name === 'heading') {
      const level = Number(node.attrs.level) || 1
      return level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3'
    }
    if (name === 'codeBlock') return 'code'
    if (name === 'blockquote' || name === 'callout') return 'quote'
    if (name === 'bulletList') return 'bullet'
    if (name === 'orderedList') return 'ordered'
  }
  return 'paragraph'
}

function unionRects(
  rects: Array<{ left: number; right: number; top: number; bottom: number }>
): WriteSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function lineColumnOfText(prefix: string): { line: number; column: number } {
  const breaks = prefix.match(/\n/g)?.length ?? 0
  const lastBreak = prefix.lastIndexOf('\n')
  return { line: breaks + 1, column: prefix.length - lastBreak }
}

function newlineCount(text: string): number {
  return text.match(/\n/g)?.length ?? 0
}

/**
 * 1-based source-file line where each top-level block starts, derived from
 * the codec context: frontmatter + leading whitespace lines first, then
 * each block's registered source fragment (or its text content when the
 * block is new) plus the recorded separator. Selection line numbers the
 * agent sees must match the real file — the markdown projection is a
 * different coordinate space and frontmatter is not part of the editor.
 */
const startLineCache = new WeakMap<PMNode, { ctx: WorkDocContext; lines: number[] }>()

function blockStartLines(doc: PMNode, ctx: WorkDocContext): number[] {
  const cached = startLineCache.get(doc)
  if (cached && cached.ctx === ctx) return cached.lines

  const lines: number[] = []
  let line = 1 + newlineCount(ctx.frontmatter) + newlineCount(ctx.leading)
  let prevBlockId: string | undefined
  let prevLineCount = 0
  doc.forEach((node) => {
    if (lines.length > 0) {
      const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : undefined
      const stored = prevBlockId && blockId
        ? ctx.separators.get(`${prevBlockId}${blockId}`)
        : undefined
      line += prevLineCount + newlineCount(stored ?? '\n\n')
    }
    lines.push(line)
    const blockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : undefined
    const raw = ctx.sourceMap.rawFor(blockId)
    prevLineCount = raw !== undefined
      ? newlineCount(raw)
      : newlineCount(node.textBetween(0, node.content.size, '\n', '\n')) + 1
    prevBlockId = blockId
  })
  startLineCache.set(doc, { ctx, lines })
  return lines
}

/** Top-level block covering `pos`: its index and content-start offset. */
function topBlockAt(doc: PMNode, pos: number): { index: number; start: number } | null {
  let found: { index: number; start: number } | null = null
  let index = 0
  doc.forEach((node, offset) => {
    if (found === null && pos >= offset && pos <= offset + node.nodeSize) {
      found = { index, start: offset }
    }
    index += 1
  })
  return found
}

/**
 * Source-file line for a PM position: the owning block's real start line
 * plus the PM-newline count inside the block (accurate for unchanged
 * blocks; best-effort for freshly edited ones).
 */
function sourceLineForPos(doc: PMNode, ctx: WorkDocContext, pos: number): number | null {
  const block = topBlockAt(doc, pos)
  if (!block) return null
  const lines = blockStartLines(doc, ctx)
  const start = lines[block.index]
  if (start === undefined) return null
  return start + newlineCount(
    doc.textBetween(block.start, Math.min(pos, doc.content.size), '\n', '\n')
  )
}

/**
 * Build the selection contract from the ProseMirror selection. Offsets,
 * line/column values, and the selected text are all expressed in markdown
 * projection coordinates so inline edit scopes and quoted selections share
 * one coordinate space with the completion contexts.
 */
export function selectionStateFromEditor(
  editor: Editor,
  ctx?: WorkDocContext
): WriteEditorSelectionState {
  const { state, view } = editor
  const doc = state.doc
  const projection = buildWriteRichMarkdownProjection(doc)
  const ranges: WriteSelectionRange[] = []
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = []

  // A node-selected raster image surfaces the image-aware toolbar;
  // text ranges below stay empty for node selections (pmFrom === pmTo - size
  // collapses to no projected text).
  const nodeSelection = state.selection instanceof NodeSelection ? state.selection : null
  if (nodeSelection?.node.type.name === 'image') {
    const src = typeof nodeSelection.node.attrs.src === 'string' ? nodeSelection.node.attrs.src : ''
    if (isSelectableRasterImageSrc(src)) {
      const alt = typeof nodeSelection.node.attrs.alt === 'string' ? nodeSelection.node.attrs.alt : ''
      let anchorRect: WriteEditorSelectionState['anchorRect']
      const nodeDom = view.nodeDOM(nodeSelection.from)
      if (nodeDom instanceof HTMLElement) {
        const rect = nodeDom.getBoundingClientRect()
        anchorRect = {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      } else {
        try {
          const coords = view.coordsAtPos(nodeSelection.from)
          anchorRect = { ...coords, width: coords.right - coords.left, height: coords.bottom - coords.top }
        } catch {
          anchorRect = undefined
        }
      }
      return {
        text: '',
        ranges: [],
        charCount: 0,
        selectedImage: { src, alt },
        ...(anchorRect ? { anchorRect } : {})
      }
    }
  }

  for (const range of state.selection.ranges) {
    const pmFrom = range.$from.pos
    const pmTo = range.$to.pos
    if (pmFrom === pmTo) continue
    const from = projectedOffsetForPos(doc, projection, pmFrom)
    const to = projectedOffsetForPos(doc, projection, pmTo)
    try {
      rects.push(view.coordsAtPos(pmFrom), view.coordsAtPos(pmTo))
    } catch {
      // coordsAtPos throws while the view is being torn down; skip the rect.
    }
    if (from === null || to === null || to <= from) continue
    const text = projection.text.slice(from, to)
    const start = lineColumnOfText(projection.text.slice(0, from))
    const end = lineColumnOfText(projection.text.slice(0, Math.max(from, to - 1)))
    // Prefer real source-file lines (frontmatter included) over the
    // projection-relative count whenever the codec context is available.
    const sourceStart = ctx ? sourceLineForPos(doc, ctx, pmFrom) : null
    const sourceEnd = ctx ? sourceLineForPos(doc, ctx, Math.max(pmFrom, pmTo - 1)) : null
    ranges.push({
      from,
      to,
      startLine: sourceStart ?? start.line,
      startColumn: start.column,
      endLine: sourceEnd ?? end.line,
      endColumn: end.column,
      text,
      charCount: to - from
    })
  }

  const text = ranges.map((range) => range.text).join('\n\n')
  return {
    text,
    ranges,
    charCount: ranges.reduce((total, range) => total + range.charCount, 0),
    blockType: richSelectionBlockType(state),
    ...(rects.length > 0 ? { anchorRect: unionRects(rects) } : {})
  }
}
