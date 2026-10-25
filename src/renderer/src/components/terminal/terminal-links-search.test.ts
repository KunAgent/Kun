// @vitest-environment jsdom
import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { isLocalPreviewUrl, parseFileReferences, resolveTerminalPath } from './terminal-links'
import { buildSearchPattern, findMatches } from './terminal-search'

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('terminal file links', () => {
  it('finds file references with line and column', () => {
    const links = parseFileReferences(' ❯ src/main/auth/callback.test.ts:94:31 failed (see ./README.md).')
    expect(links.map(({ path, line, column }) => ({ path, line, column }))).toEqual([
      { path: 'src/main/auth/callback.test.ts', line: 94, column: 31 },
      { path: './README.md', line: undefined, column: undefined }
    ])
  })

  it('ignores URLs, versions and plain words', () => {
    expect(parseFileReferences('see https://example.com/a/b.html and v3.2.4 and 1.84s')).toEqual([])
    expect(parseFileReferences('hello world')).toEqual([])
  })

  it('resolves relative paths against the shell directory', () => {
    expect(resolveTerminalPath('src/a.ts', '/w/app')).toBe('/w/app/src/a.ts')
    expect(resolveTerminalPath('../b.ts', '/w/app/pkg')).toBe('/w/app/b.ts')
    expect(resolveTerminalPath('/abs/c.ts', '/w')).toBe('/abs/c.ts')
    expect(resolveTerminalPath('~/d.ts', '/w', '/Users/me')).toBe('/Users/me/d.ts')
  })

  it('previews loopback URLs only', () => {
    expect(isLocalPreviewUrl('http://localhost:5173/')).toBe(true)
    expect(isLocalPreviewUrl('http://127.0.0.1:4173/x')).toBe(true)
    expect(isLocalPreviewUrl('https://kun.dev')).toBe(false)
  })
})

describe('terminal search', () => {
  it('builds literal and regex patterns', () => {
    expect(buildSearchPattern('a.b', { caseSensitive: false, regex: false })?.test('A.B')).toBe(true)
    expect(buildSearchPattern('a.b', { caseSensitive: true, regex: false })?.test('axb')).toBe(false)
    expect(buildSearchPattern('(', { caseSensitive: false, regex: true })).toBeNull()
  })

  it('maps matches to cell columns across wide characters and wraps', async () => {
    const term = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    await write(term, '中文 match\r\n0123456789abcdef\r\n')
    const { matches } = findMatches(term, buildSearchPattern('match', { caseSensitive: false, regex: false })!)
    expect(matches[0]).toEqual({ row: 0, col: 5, length: 5 })
    const wrapped = findMatches(term, buildSearchPattern('89ab', { caseSensitive: false, regex: false })!)
    expect(wrapped.matches[0]).toEqual({ row: 1, col: 8, length: 4 })
    term.dispose()
  })
})
