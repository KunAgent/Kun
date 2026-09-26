import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Markdown-shaped plain-text projection of a ProseMirror document.
 *
 * The projection renders每个文本块为一行：块级语法前缀（`## `、`- `、`> `、
 * 围栏等）加上块的纯文本内容，但不包含行内标记（**、`、[]() 等）。它给行内
 * AI 提供与 markdown 文件同构的上下文，并通过 blocks 映射表支持
 * 「投影偏移 ↔ ProseMirror 位置」的精确互转——这是补全 edit-action、行内
 * 编辑作用域和选区引用共用的坐标系。
 */

export type WriteRichProjectedBlock = {
  /** ProseMirror position of the first content position inside the textblock. */
  pmStart: number
  /** ProseMirror position at the end of the textblock content. */
  pmEnd: number
  /** Offset in the projected text where this block's line starts. */
  textFrom: number
  /** Offset in the projected text just past the block's text content. */
  textTo: number
  /** Length of the syntax prefix between textFrom and the block text. */
  prefixLength: number
}

export type WriteRichMarkdownProjection = {
  text: string
  blocks: WriteRichProjectedBlock[]
}

type ProjectionLine = {
  text: string
  block?: { pmStart: number; pmEnd: number; prefixLength: number }
}

type ProjectionState = {
  lines: ProjectionLine[]
  /** Table cells map per line with an in-line prefix; line offsets are only
   * known once all lines are assembled, so they are collected separately. */
  cells: Array<{
    lineIndex: number
    pmStart: number
    pmEnd: number
    prefixLength: number
    textLength: number
  }>
}

function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, '\n', () => '')
}

function listItemMarker(parent: PMNode, index: number, item: PMNode): string {
  if (item.type.name === 'taskItem') {
    return item.attrs.checked ? '- [x] ' : '- [ ] '
  }
  if (parent.type.name === 'orderedList') {
    const start = Number.isFinite(Number(parent.attrs.start)) ? Number(parent.attrs.start) : 1
    return `${start + index}. `
  }
  return '- '
}

function visitBlock(node: PMNode, pos: number, prefix: string, state: ProjectionState): void {
  const name = node.type.name
  const { lines } = state

  if (node.isTextblock) {
    if (name === 'codeBlock') {
      const language = typeof node.attrs.language === 'string' ? node.attrs.language : ''
      lines.push({ text: `${prefix}\`\`\`${language}` })
      lines.push({
        text: prefix + blockText(node),
        block: { pmStart: pos + 1, pmEnd: pos + 1 + node.content.size, prefixLength: prefix.length }
      })
      lines.push({ text: `${prefix}\`\`\`` })
      return
    }
    let marker = ''
    if (name === 'heading') {
      const level = Number(node.attrs.level) || 1
      marker = `${'#'.repeat(Math.max(1, Math.min(6, level)))} `
    }
    lines.push({
      text: prefix + marker + blockText(node),
      block: {
        pmStart: pos + 1,
        pmEnd: pos + 1 + node.content.size,
        prefixLength: prefix.length + marker.length
      }
    })
    return
  }

  switch (name) {
    case 'blockquote':
    case 'callout': {
      node.forEach((child, offset) => {
        visitBlock(child, pos + 1 + offset, `${prefix}> `, state)
      })
      return
    }
    case 'rawMarkdownBlock': {
      // Raw source stays visible in the projection but has no block mapping:
      // offsets inside it cannot map back to a PM position, so inline edit
      // and completion abandon (implementation §5).
      const raw = typeof node.attrs.raw === 'string' ? node.attrs.raw : ''
      for (const line of raw.split('\n')) {
        lines.push({ text: prefix + line })
      }
      return
    }
    case 'blockMath': {
      const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : ''
      lines.push({ text: `${prefix}$$` })
      for (const line of latex.split('\n')) {
        lines.push({ text: prefix + line })
      }
      lines.push({ text: `${prefix}$$` })
      return
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      node.forEach((item, itemOffset, index) => {
        const marker = listItemMarker(node, index, item)
        const continuation = prefix + ' '.repeat(marker.length)
        let first = true
        item.forEach((child, childOffset) => {
          const childPos = pos + 1 + itemOffset + 1 + childOffset
          if (first && child.isTextblock && child.type.name !== 'codeBlock') {
            lines.push({
              text: prefix + marker + blockText(child),
              block: {
                pmStart: childPos + 1,
                pmEnd: childPos + 1 + child.content.size,
                prefixLength: prefix.length + marker.length
              }
            })
          } else {
            visitBlock(child, childPos, continuation, state)
          }
          first = false
        })
      })
      return
    }
    case 'table': {
      node.forEach((row, rowOffset, rowIndex) => {
        let lineText = `${prefix}|`
        const rowPos = pos + 1 + rowOffset
        const lineIndex = lines.length
        row.forEach((cell, cellOffset) => {
          const cellPos = rowPos + 1 + cellOffset
          const firstChild = cell.firstChild
          const text = firstChild && firstChild.isTextblock ? blockText(firstChild) : ''
          const prefixLength = lineText.length + 1
          lineText += ` ${text} |`
          if (firstChild && firstChild.isTextblock) {
            state.cells.push({
              lineIndex,
              pmStart: cellPos + 2,
              pmEnd: cellPos + 2 + firstChild.content.size,
              prefixLength,
              textLength: text.length
            })
          }
        })
        lines.push({ text: lineText })
        if (rowIndex === 0) {
          lines.push({ text: `${prefix}|${' --- |'.repeat(row.childCount)}` })
        }
      })
      return
    }
    case 'horizontalRule': {
      lines.push({ text: `${prefix}---` })
      return
    }
    case 'image': {
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
      lines.push({ text: `${prefix}![${alt}](${src})` })
      return
    }
    default: {
      if (node.isLeaf) {
        lines.push({ text: prefix })
        return
      }
      node.forEach((child, offset) => {
        visitBlock(child, pos + 1 + offset, prefix, state)
      })
    }
  }
}

function assembleProjection(
  state: ProjectionState,
  topLevelBreaks: Set<number>
): WriteRichMarkdownProjection {
  const blocks: WriteRichProjectedBlock[] = []
  let text = ''
  const lineStarts: number[] = []
  for (let index = 0; index < state.lines.length; index += 1) {
    if (index > 0) {
      text += topLevelBreaks.has(index) ? '\n\n' : '\n'
    }
    lineStarts.push(text.length)
    const line = state.lines[index]
    text += line.text
    if (line.block) {
      blocks.push({
        pmStart: line.block.pmStart,
        pmEnd: line.block.pmEnd,
        textFrom: lineStarts[index],
        textTo: text.length,
        prefixLength: line.block.prefixLength
      })
    }
  }
  for (const cell of state.cells) {
    const lineStart = lineStarts[cell.lineIndex]
    if (lineStart === undefined) continue
    blocks.push({
      pmStart: cell.pmStart,
      pmEnd: cell.pmEnd,
      textFrom: lineStart,
      textTo: lineStart + cell.prefixLength + cell.textLength,
      prefixLength: cell.prefixLength
    })
  }
  blocks.sort((a, b) => a.pmStart - b.pmStart)
  return { text, blocks }
}

const projectionCache = new WeakMap<PMNode, WriteRichMarkdownProjection>()

export function buildWriteRichMarkdownProjection(doc: PMNode): WriteRichMarkdownProjection {
  const cached = projectionCache.get(doc)
  if (cached) return cached

  const state: ProjectionState = { lines: [], cells: [] }
  const topLevelBreaks = new Set<number>()
  doc.forEach((child, offset) => {
    if (state.lines.length > 0) topLevelBreaks.add(state.lines.length)
    visitBlock(child, offset, '', state)
  })
  const projection = assembleProjection(state, topLevelBreaks)
  projectionCache.set(doc, projection)
  return projection
}

function findBlockForPos(blocks: WriteRichProjectedBlock[], pos: number): WriteRichProjectedBlock | null {
  let low = 0
  let high = blocks.length - 1
  let found: WriteRichProjectedBlock | null = null
  while (low <= high) {
    const mid = (low + high) >> 1
    const block = blocks[mid]
    if (pos < block.pmStart) {
      high = mid - 1
    } else {
      if (pos <= block.pmEnd) found = block
      low = mid + 1
    }
  }
  return found
}

function findBlockForOffset(blocks: WriteRichProjectedBlock[], offset: number): WriteRichProjectedBlock | null {
  for (const block of blocks) {
    if (offset >= block.textFrom && offset <= block.textTo) return block
  }
  return null
}

/** Map a ProseMirror position to its offset in the projected text. */
export function projectedOffsetForPos(
  doc: PMNode,
  projection: WriteRichMarkdownProjection,
  pos: number
): number | null {
  const block = findBlockForPos(projection.blocks, pos)
  if (!block) return null
  const clamped = Math.max(block.pmStart, Math.min(block.pmEnd, pos))
  const textOffset = doc.textBetween(block.pmStart, clamped, '\n', () => '').length
  return block.textFrom + block.prefixLength + textOffset
}

/** Map an offset in the projected text back to a ProseMirror position. */
export function posForProjectedOffset(
  doc: PMNode,
  projection: WriteRichMarkdownProjection,
  offset: number
): number | null {
  const block = findBlockForOffset(projection.blocks, offset)
  if (!block) return null
  let remaining = Math.max(0, offset - block.textFrom - block.prefixLength)
  const resolved = doc.resolve(Math.min(block.pmStart, doc.content.size))
  const parent = resolved.parent
  let pos = block.pmStart
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.child(index)
    if (child.isText && child.text) {
      if (remaining <= child.text.length) return pos + remaining
      remaining -= child.text.length
    }
    pos += child.nodeSize
  }
  return Math.min(pos, block.pmEnd)
}
