/**
 * Line-per-block parsing (Agentero-style): a top-level paragraph that spans
 * several source lines becomes one editor block per line, so every line can
 * be hovered, dragged and styled on its own.
 *
 * Fidelity: each line keeps its verbatim source fragment and the recorded
 * separator between lines is the original line ending, so an unedited file
 * still serializes byte-identically. Continuation lines carry
 * `data.workSoftLine`, which becomes the paragraph's `softLine` attr; the
 * serializer rejoins an edited soft line with a single newline instead of a
 * blank line, keeping the file's shape.
 *
 * Only breaks that sit directly in the paragraph split it — newlines inside
 * plain text children and hard `break` nodes. A newline inside emphasis,
 * links or other inline containers stays inside its line: that line's source
 * alone would not parse back to the same content.
 */
import type { Break, Paragraph, PhrasingContent, RootContent, Text } from 'mdast'

type Line = { start: number; end: number; children: PhrasingContent[] }

function offsetOf(node: { position?: { start?: { offset?: number }; end?: { offset?: number } } }, edge: 'start' | 'end'): number | undefined {
  return node.position?.[edge]?.offset
}

function newlineOffsets(source: string, base: number): number[] {
  const out: number[] = []
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) out.push(base + i)
  return out
}

/** Lines of one paragraph, or null when it cannot be split faithfully. */
function paragraphLines(paragraph: Paragraph, body: string): Line[] | null {
  const start = offsetOf(paragraph, 'start')
  const end = offsetOf(paragraph, 'end')
  if (typeof start !== 'number' || typeof end !== 'number') return null
  const lines: Line[] = []
  let current: Line = { start, end, children: [] }
  const closeLine = (lineEnd: number, nextStart: number): void => {
    current.end = lineEnd
    lines.push(current)
    current = { start: nextStart, end, children: [] }
  }

  for (const child of paragraph.children) {
    if (child.type === 'break') {
      const breakStart = offsetOf(child as Break, 'start')
      if (typeof breakStart !== 'number') return null
      const newline = body.indexOf('\n', breakStart)
      if (newline === -1 || newline >= end) return null
      closeLine(breakStart, newline + 1)
      continue
    }
    if (child.type !== 'text' || !child.value.includes('\n')) {
      current.children.push(child)
      continue
    }
    const textStart = offsetOf(child as Text, 'start')
    const textEnd = offsetOf(child as Text, 'end')
    if (typeof textStart !== 'number' || typeof textEnd !== 'number') return null
    const parts = child.value.split('\n')
    const breaks = newlineOffsets(body.slice(textStart, textEnd), textStart)
    // Escapes never add newlines, so value and source must agree; bail out
    // on anything unexpected rather than guess at offsets.
    if (breaks.length !== parts.length - 1) return null
    parts.forEach((part, index) => {
      const last = index === breaks.length
      // CRLF sources keep `\r` in the value; it belongs to the separator.
      const value = last ? part : part.replace(/\r$/, '')
      if (value) current.children.push({ type: 'text', value })
      if (last) return
      const newline = breaks[index]
      closeLine(body[newline - 1] === '\r' ? newline - 1 : newline, newline + 1)
    })
  }
  current.end = end
  lines.push(current)
  // A hard break or newline at either edge would leave an empty line; keep
  // such paragraphs whole.
  if (lines.some((line) => line.children.length === 0)) return null
  return lines
}

function lineColumn(body: string, offset: number, baseLine: number, baseOffset: number): { line: number; column: number } {
  let line = baseLine
  for (let i = body.indexOf('\n', baseOffset); i !== -1 && i < offset; i = body.indexOf('\n', i + 1)) line += 1
  return { line, column: offset - (body.lastIndexOf('\n', offset - 1) + 1) + 1 }
}

export function splitSoftLineParagraphs(children: RootContent[], body: string): RootContent[] {
  const out: RootContent[] = []
  for (const child of children) {
    const lines = child.type === 'paragraph' ? paragraphLines(child, body) : null
    if (!lines || lines.length < 2) {
      out.push(child)
      continue
    }
    const baseLine = child.position?.start.line ?? 1
    const baseOffset = offsetOf(child, 'start') ?? 0
    lines.forEach((line, index) => {
      out.push({
        type: 'paragraph',
        children: line.children,
        position: {
          start: { ...lineColumn(body, line.start, baseLine, baseOffset), offset: line.start },
          end: { ...lineColumn(body, line.end, baseLine, baseOffset), offset: line.end }
        },
        ...(index > 0 ? { data: { workSoftLine: true } } : {})
      } as Paragraph)
    })
  }
  return out
}
