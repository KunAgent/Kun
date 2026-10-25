import hljs from 'highlight.js/lib/common'
import { visual } from './visual-system.js'

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/
const FENCE_ONLY_LINE = /^ {0,3}(?:`{3,}|~{3,})(?:[^\r\n]*)$/u
const HIGHLIGHT_FRAGMENT = /<span class="([^"]+)">|<\/span>|&(?:#\d+|#x[\da-f]+|[a-z]+);|[^<&]+|[<&]/giu

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  'f#': 'fsharp',
  'js': 'javascript',
  'jsx': 'javascript',
  'py': 'python',
  'rb': 'ruby',
  'sh': 'bash',
  'shell': 'bash',
  'ts': 'typescript',
  'tsx': 'typescript'
}

type FenceState = {
  marker: '`' | '~'
  length: number
}

const styleForScopes = (scopes: readonly string[]): ((value: string) => string) | undefined => {
  const names = scopes.flatMap((scope) => scope.split(/\s+/u))
  if (names.some((name) => name.includes('comment') || name === 'quote')) return visual.muted
  if (names.some((name) => name.includes('keyword') || name === 'doctag')) {
    return (value) => visual.brand(visual.strong(value))
  }
  if (names.some((name) => name.includes('string') || name === 'regexp')) return visual.success
  if (names.some((name) => name === 'number' || name === 'symbol' || name === 'bullet')) return visual.focus
  if (names.some((name) => name === 'literal' || name === 'meta')) return visual.warning
  if (names.some((name) => name.includes('title') || name === 'section')) {
    return (value) => visual.focus(visual.strong(value))
  }
  if (names.some((name) => name.includes('type') || name.includes('class'))) return visual.warning
  if (names.some((name) => name.includes('attr') || name.includes('property'))) return visual.focus
  if (names.some((name) => name.includes('variable') || name === 'params')) return visual.user
  if (names.some((name) => name.includes('built_in') || name.includes('builtin'))) return visual.brand
  return undefined
}

const decodeHtmlEntity = (value: string): string => {
  switch (value) {
    case '&amp;': return '&'
    case '&lt;': return '<'
    case '&gt;': return '>'
    case '&quot;': return '"'
    case '&#39;':
    case '&apos;': return "'"
  }
  if (/^&#x[\da-f]+;$/iu.test(value)) {
    return String.fromCodePoint(Number.parseInt(value.slice(3, -1), 16))
  }
  if (/^&#\d+;$/u.test(value)) {
    return String.fromCodePoint(Number.parseInt(value.slice(2, -1), 10))
  }
  return value
}

const highlightHtmlToAnsi = (html: string): string => {
  const scopes: string[] = []
  let output = ''
  for (const match of html.matchAll(HIGHLIGHT_FRAGMENT)) {
    const fragment = match[0]
    if (fragment.startsWith('<span ')) {
      scopes.push(match[1] ?? '')
      continue
    }
    if (fragment === '</span>') {
      scopes.pop()
      continue
    }
    const text = fragment.startsWith('&') ? decodeHtmlEntity(fragment) : fragment
    const style = styleForScopes(scopes)
    output += style ? style(text) : text
  }
  return output
}

export const codeFenceLanguage = (info?: string): string => {
  const token = info?.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
  return LANGUAGE_ALIASES[token] ?? token
}

export function highlightTerminalCode(code: string, info?: string): string[] {
  const language = codeFenceLanguage(info)
  if (!language || language === 'text' || language === 'plaintext' || !hljs.getLanguage(language)) {
    return code.split('\n')
  }
  try {
    return highlightHtmlToAnsi(
      hljs.highlight(code, { language, ignoreIllegals: true }).value
    ).split('\n')
  } catch {
    return code.split('\n')
  }
}

/**
 * A bare opening fence looks exactly like a closing fence. Label only
 * presentation-time bare openings so block splitting and code headers can tell
 * them apart without changing the stored Markdown.
 */
export function normalizeTerminalCodeFences(markdown: string): string {
  let openFence: FenceState | undefined
  return markdown.split(/(?<=\n)/u).map((rawLine) => {
    const newline = rawLine.endsWith('\r\n') ? '\r\n' : rawLine.endsWith('\n') ? '\n' : ''
    const line = newline ? rawLine.slice(0, -newline.length) : rawLine
    const match = FENCE_LINE.exec(line)
    if (!match) return rawLine

    const markerText = match[2]!
    const marker = markerText[0] as '`' | '~'
    const info = match[3] ?? ''
    if (openFence) {
      if (
        marker === openFence.marker &&
        markerText.length >= openFence.length &&
        info.trim().length === 0
      ) {
        openFence = undefined
      }
      return rawLine
    }

    if (marker === '`' && info.includes('`')) return rawLine
    openFence = { marker, length: markerText.length }
    if (info.trim().length > 0) return rawLine
    return `${match[1]}${markerText}text${newline}`
  }).join('')
}

export function terminalAssistantMarkdown(markdown: string, running: boolean): string {
  const normalized = normalizeTerminalCodeFences(markdown)
  if (!running) return normalized
  const lastLine = normalized.split(/\r?\n/u).at(-1) ?? ''
  return FENCE_ONLY_LINE.test(lastLine)
    ? `${normalized}\n▍`
    : `${normalized} ▍`
}
