import type { IBufferLine, IDecoration, Terminal } from '@xterm/xterm'

/**
 * Find-in-terminal over the active buffer. Soft-wrapped rows are searched as
 * one logical line and every match maps back to cell columns, so wide (CJK)
 * characters select correctly.
 */
export type TerminalSearchOptions = {
  caseSensitive: boolean
  regex: boolean
}

export type TerminalSearchMatch = {
  row: number
  col: number
  length: number
}

export type TerminalSearchResult = {
  index: number
  count: number
  limited: boolean
  invalid: boolean
}

const MAX_MATCHES = 1_000
const MAX_HIGHLIGHTS = 200

export type Segment = { row: number; text: string; columns: number[] }

/** Characters of one row plus the cell column each character starts at. */
export function rowSegment(line: IBufferLine, row: number, cols: number): Segment {
  let text = ''
  const columns: number[] = []
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x)
    if (!cell) break
    const width = cell.getWidth()
    if (width === 0) continue
    const chars = cell.getChars() || ' '
    for (const char of chars) {
      text += char
      columns.push(x)
    }
  }
  return { row, text, columns }
}

export function buildSearchPattern(query: string, options: TerminalSearchOptions): RegExp | null {
  if (!query) return null
  try {
    const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** Every match in the buffer, top to bottom. */
export function findMatches(term: Terminal, pattern: RegExp): { matches: TerminalSearchMatch[]; limited: boolean } {
  const buffer = term.buffer.active
  const matches: TerminalSearchMatch[] = []
  let group: Segment[] = []
  const flush = (): boolean => {
    if (!group.length) return false
    const text = group.map((segment) => segment.text).join('')
    const offsets: Array<{ segment: Segment; start: number }> = []
    let cursor = 0
    for (const segment of group) {
      offsets.push({ segment, start: cursor })
      cursor += segment.text.length
    }
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      if (!match[0]) {
        pattern.lastIndex += 1
        continue
      }
      const owner = [...offsets].reverse().find((entry) => entry.start <= match!.index)!
      const local = match.index - owner.start
      const endOwner = [...offsets].reverse().find((entry) => entry.start <= match!.index + match![0].length - 1)!
      const endLocal = match.index + match[0].length - 1 - endOwner.start
      const col = owner.segment.columns[local] ?? 0
      const endCol = (endOwner.segment.columns[endLocal] ?? col) + 1
      const length = (endOwner.segment.row - owner.segment.row) * term.cols + endCol - col
      matches.push({ row: owner.segment.row, col, length: Math.max(1, length) })
      if (matches.length >= MAX_MATCHES) return true
    }
    group = []
    return false
  }
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    if (!line.isWrapped && flush()) return { matches, limited: true }
    group.push(rowSegment(line, row, term.cols))
  }
  return { matches, limited: flush() }
}

export class TerminalSearchController {
  private matches: TerminalSearchMatch[] = []
  private index = -1
  private highlights: IDecoration[] = []
  private lastKey = ''

  constructor(private readonly term: Terminal, private readonly colors: () => { match: string; active: string }) {}

  search(query: string, options: TerminalSearchOptions, direction: 'next' | 'previous' | 'same' = 'same'): TerminalSearchResult {
    const pattern = buildSearchPattern(query, options)
    if (!pattern) {
      this.clear()
      return { index: -1, count: 0, limited: false, invalid: Boolean(query) }
    }
    const key = `${query}\u0000${options.caseSensitive}\u0000${options.regex}`
    let limited = false
    if (key !== this.lastKey || direction === 'same') {
      const found = findMatches(this.term, pattern)
      this.matches = found.matches
      limited = found.limited
      this.lastKey = key
      this.index = this.matches.length ? this.nearestToViewport() : -1
    } else if (this.matches.length) {
      const step = direction === 'next' ? 1 : -1
      this.index = (this.index + step + this.matches.length) % this.matches.length
    }
    this.render()
    return { index: this.index, count: this.matches.length, limited, invalid: false }
  }

  private nearestToViewport(): number {
    const top = this.term.buffer.active.viewportY
    const index = this.matches.findIndex((match) => match.row >= top)
    return index === -1 ? this.matches.length - 1 : index
  }

  private render(): void {
    this.disposeHighlights()
    const current = this.matches[this.index]
    if (!current) {
      this.term.clearSelection()
      return
    }
    const buffer = this.term.buffer.active
    const cursorLine = buffer.baseY + buffer.cursorY
    const { match, active } = this.colors()
    const start = Math.max(0, this.index - MAX_HIGHLIGHTS / 2)
    for (const [offset, entry] of this.matches.slice(start, start + MAX_HIGHLIGHTS).entries()) {
      const marker = this.term.registerMarker(entry.row - cursorLine)
      if (!marker) continue
      const isCurrent = start + offset === this.index
      const decoration = this.term.registerDecoration({
        marker,
        x: entry.col,
        width: Math.min(entry.length, this.term.cols - entry.col),
        backgroundColor: isCurrent ? active : match,
        layer: 'bottom'
      })
      if (decoration) {
        decoration.onDispose(() => marker.dispose())
        this.highlights.push(decoration)
      } else {
        marker.dispose()
      }
    }
    this.term.select(current.col, current.row, current.length)
    const viewport = buffer.viewportY
    if (current.row < viewport || current.row >= viewport + this.term.rows) {
      this.term.scrollToLine(Math.max(0, current.row - Math.floor(this.term.rows / 2)))
    }
  }

  private disposeHighlights(): void {
    for (const decoration of this.highlights.splice(0)) decoration.dispose()
  }

  clear(): void {
    this.disposeHighlights()
    this.matches = []
    this.index = -1
    this.lastKey = ''
    this.term.clearSelection()
  }
}
