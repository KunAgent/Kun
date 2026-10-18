import { normalizeTerminalCodeFences } from './markdown-code.js'

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/u

/**
 * Split assistant Markdown at blank lines outside fenced code. Every block
 * except a still-growing tail is final, so streaming answers can be written
 * to the terminal scrollback paragraph by paragraph without ever reflowing
 * text that was already printed.
 */
export function splitStableMarkdown(markdown: string, streaming: boolean): { blocks: string[]; stable: number } {
  const lines = normalizeTerminalCodeFences(markdown).replaceAll('\r\n', '\n').split('\n')
  // A trailing newline only ends the current line; it is not a blank line,
  // so it must not close the block (the next line may continue a list).
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  const blocks: string[] = []
  let current: string[] = []
  let fence: { marker: string; length: number } | undefined
  const flush = (): void => {
    while (current.length && current.at(-1)!.trim() === '') current.pop()
    if (current.length) blocks.push(current.join('\n'))
    current = []
  }
  for (const line of lines) {
    const match = FENCE_LINE.exec(line)
    if (fence) {
      current.push(line)
      if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length && !match[2]!.trim()) {
        fence = undefined
        // A closed fence is always its own block so it can be rendered as
        // highlighted code rather than inline Markdown.
        flush()
      }
      continue
    }
    if (match && !(match[1]![0] === '`' && match[2]!.includes('`'))) {
      flush()
      fence = { marker: match[1]![0]!, length: match[1]!.length }
      current.push(line)
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  const endsWithOpenBlock = current.some((line) => line.trim() !== '') || Boolean(fence)
  flush()
  if (!streaming) return { blocks, stable: blocks.length }
  return { blocks, stable: endsWithOpenBlock ? Math.max(0, blocks.length - 1) : blocks.length }
}

export type MarkdownBlock =
  | { kind: 'code'; language: string; code: string; closed: boolean }
  | { kind: 'markdown'; text: string }

/** Classify one block from splitStableMarkdown. */
export function classifyMarkdownBlock(block: string): MarkdownBlock {
  const lines = block.split('\n')
  const open = FENCE_LINE.exec(lines[0] ?? '')
  if (!open) return { kind: 'markdown', text: block }
  const marker = open[1]!
  const last = lines.length > 1 ? FENCE_LINE.exec(lines.at(-1)!) : null
  const closed = Boolean(last && last[1]![0] === marker[0] && last[1]!.length >= marker.length && !last[2]!.trim())
  return {
    kind: 'code',
    language: open[2]!.trim().split(/\s+/u)[0] ?? '',
    code: lines.slice(1, closed ? -1 : undefined).join('\n'),
    closed
  }
}

