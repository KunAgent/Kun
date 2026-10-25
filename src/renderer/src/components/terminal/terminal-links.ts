import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { rowSegment } from './terminal-search'

/**
 * File references in terminal output (`src/a.ts:42:7`, `./b.md`, absolute
 * paths). Clicking previews the file inside Kun; Cmd/Ctrl-click opens it in
 * the preferred editor. URLs are handled by the web-links addon.
 */
export type TerminalFileLink = {
  path: string
  line?: number
  column?: number
}

export type TerminalLinkHandlers = {
  /** Directory relative paths resolve against (the shell's cwd). */
  resolveBase: () => string | undefined
  onOpen: (link: TerminalFileLink, event: MouseEvent) => void
  onHover?: (link: TerminalFileLink, event: MouseEvent) => void
  onLeave?: () => void
}

// A path needs a directory part or a known extension so plain words do not
// light up. Trailing punctuation is trimmed after matching.
const FILE_REFERENCE = /(?:^|[\s('"`[<{=])((?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?|(?:~|\.{1,2})?\/(?:[\w.@+-]+\/)+[\w.@+-]+)/g
const URL_LIKE = /^[a-z][\w+.-]*:\/\//i
const VERSION_LIKE = /^v?\d+(?:\.\d+)+$/

export function parseFileReferences(text: string): Array<TerminalFileLink & { start: number; length: number }> {
  const links: Array<TerminalFileLink & { start: number; length: number }> = []
  FILE_REFERENCE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_REFERENCE.exec(text))) {
    let token = match[1]!
    const start = match.index + match[0].length - token.length
    token = token.replace(/[.,;:)\]}>'"`]+$/, (tail) => (/^:\d/.test(tail) ? tail : ''))
    const before = text.slice(Math.max(0, start - 3), start)
    if (!token || URL_LIKE.test(text.slice(start)) || before.endsWith('://') || VERSION_LIKE.test(token)) continue
    if (/^\d+(\.\d+)*[a-z]*$/i.test(token)) continue
    const position = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(token)!
    const path = position[1]!
    if (!path || path === '.' || path === '..' || path === '/') continue
    links.push({
      path,
      ...(position[2] ? { line: Number(position[2]) } : {}),
      ...(position[3] ? { column: Number(position[3]) } : {}),
      start,
      length: token.length
    })
  }
  return links
}

export function resolveTerminalPath(path: string, base: string | undefined, home?: string): string {
  if (path.startsWith('~/') && home) return `${home}${path.slice(1)}`
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || !base) return path
  const parts = `${base.replace(/\/+$/, '')}/${path}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') {
      if (!resolved.length) resolved.push('')
      continue
    }
    if (part === '..') {
      if (resolved.length > 1) resolved.pop()
      continue
    }
    resolved.push(part)
  }
  return resolved.join('/') || '/'
}

export function createFileLinkProvider(term: Terminal, handlers: TerminalLinkHandlers): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }
      // Map string offsets to cell columns so wide characters do not shift links.
      const { text, columns } = rowSegment(line, bufferLineNumber - 1, term.cols)
      const links: ILink[] = parseFileReferences(text).map((reference) => {
        const target: TerminalFileLink = {
          path: resolveTerminalPath(reference.path, handlers.resolveBase()),
          ...(reference.line ? { line: reference.line } : {}),
          ...(reference.column ? { column: reference.column } : {})
        }
        return {
          range: {
            start: { x: (columns[reference.start] ?? reference.start) + 1, y: bufferLineNumber },
            end: { x: (columns[reference.start + reference.length - 1] ?? reference.start + reference.length - 1) + 1, y: bufferLineNumber }
          },
          text: text.slice(reference.start, reference.start + reference.length),
          decorations: { underline: true, pointerCursor: true },
          activate: (event) => handlers.onOpen(target, event),
          hover: (event) => handlers.onHover?.(target, event),
          leave: () => handlers.onLeave?.()
        }
      })
      callback(links.length ? links : undefined)
    }
  }
}

/** Loopback dev-server URLs open in Kun's preview; everything else in the browser. */
export function isLocalPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(parsed.hostname)
  } catch {
    return false
  }
}
