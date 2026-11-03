import { cellWidth } from './layout.js'

// SGR-only styling is the contract for line formatters that predate the
// opentui renderer (usage, quota, graph and inspection reports). Other escape
// families never reach these helpers because sanitizeTerminalText runs first.
const SGR_PATTERN = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'gu')
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

export function stripSgr(value: string): string {
  return value.replace(SGR_PATTERN, '')
}

export function visibleWidth(value: string): number {
  return cellWidth(stripSgr(value))
}

type Token = { kind: 'sgr'; value: string } | { kind: 'text'; value: string; width: number }

function tokenize(value: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of value.matchAll(SGR_PATTERN)) {
    if (match.index > last) pushText(tokens, value.slice(last, match.index))
    tokens.push({ kind: 'sgr', value: match[0] })
    last = match.index + match[0].length
  }
  if (last < value.length) pushText(tokens, value.slice(last))
  return tokens
}

function pushText(tokens: Token[], text: string): void {
  const parts = segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text)
  for (const part of parts) tokens.push({ kind: 'text', value: part, width: cellWidth(part) })
}

/**
 * Clip a styled line to `maxWidth` terminal cells. Styling that was opened
 * before the cut is closed with a reset so a clipped row never bleeds into the
 * next one. The default ellipsis matches the formatter tests' expectations.
 */
export function truncateToWidth(
  value: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false
): string {
  if (maxWidth <= 0) return ''
  const total = visibleWidth(value)
  if (total <= maxWidth) return pad ? value + ' '.repeat(maxWidth - total) : value
  const ellipsisWidth = cellWidth(ellipsis)
  const clippedEllipsis = ellipsisWidth >= maxWidth ? '' : ellipsis
  const target = maxWidth - (clippedEllipsis ? ellipsisWidth : 0)
  let output = ''
  let used = 0
  let styled = false
  for (const token of tokenize(value)) {
    if (token.kind === 'sgr') {
      output += token.value
      styled = token.value !== '\x1b[0m'
      continue
    }
    if (used + token.width > target) break
    output += token.value
    used += token.width
  }
  const result = `${output}${styled ? '\x1b[0m' : ''}${clippedEllipsis}`
  const width = used + (clippedEllipsis ? ellipsisWidth : 0)
  return pad ? result + ' '.repeat(Math.max(0, maxWidth - width)) : result
}
