import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = resolve('src/renderer/src')
const SOURCE_FILE = /\.(css|ts|tsx)$/
const TEST_FILE = /\.test\.tsx?$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : []
  })
}

describe('renderer CSS token references', () => {
  it('only reads --ds-* custom properties without a fallback when something defines them', () => {
    const files = sourceFiles(RENDERER_ROOT).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    const defined = new Set<string>()
    for (const { text } of files) {
      // Stylesheet declarations, Tailwind arbitrary properties and React style keys.
      for (const match of text.matchAll(/(--ds-[a-zA-Z0-9-]+)['"]?\s*:/g)) defined.add(match[1])
      for (const match of text.matchAll(/setProperty\(\s*['"`](--ds-[a-zA-Z0-9-]+)['"`]/g)) defined.add(match[1])
    }
    // Tailwind's `ds-*` color names (ds-muted, ds-ink, ds-hover, ...) are not
    // CSS variables; an undefined var() drops the declaration silently.
    const undefinedReads = files.flatMap(({ path, text }) =>
      [...text.matchAll(/var\(\s*(--ds-[a-zA-Z0-9-]+)\s*\)/g)]
        .filter((match) => !defined.has(match[1]))
        .map((match) => `${relative(RENDERER_ROOT, path)}: ${match[1]}`)
    )
    expect(undefinedReads).toEqual([])
  })
})
