/**
 * Selection contract derived from the ProseMirror selection, expressed in
 * markdown-projection coordinates so inline edit scopes, quoted selections,
 * and completion contexts share one coordinate space. Split out of
 * WriteRichEditor.tsx per the S1 file-size plan.
 */
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type {
  WriteEditorSelectionState,
  WriteSelectionAnchorRect,
  WriteSelectionRange
} from '../../components/write/WriteMarkdownEditor'
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

/**
 * Build the selection contract from the ProseMirror selection. Offsets,
 * line/column values, and the selected text are all expressed in markdown
 * projection coordinates so inline edit scopes and quoted selections share
 * one coordinate space with the completion contexts.
 */
export function selectionStateFromEditor(editor: Editor): WriteEditorSelectionState {
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
    ranges.push({
      from,
      to,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
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
