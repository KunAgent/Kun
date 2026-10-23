import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = resolve('src/renderer/src')
const SOURCE_FILE = /\.(ts|tsx)$/
const TEST_FILE = /\.test\.tsx?$/

// Color utilities that accept a theme color (`bg-ds-card`, `hover:border-ds-border`).
const COLOR_UTILITY = '(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|caret|accent|decoration|shadow)'
// The key stops at a word boundary; `${...}` template fragments are skipped.
const DS_COLOR_CLASS = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*${COLOR_UTILITY}-ds-([a-zA-Z0-9-]+?)(?:/\\d+)?(?![\\w$-])`, 'g')

/**
 * `ds-*` names that tailwind.config.js does not define, with how many class
 * uses existed when this guard landed. Tailwind generates nothing for them,
 * so those surfaces silently lose their color. Counts may only go down:
 * define the key (and check each surface) or switch the class to a real one.
 */
const KNOWN_UNDEFINED: Readonly<Record<string, number>> = {
  'surface-subtle': 70,
  'card-muted': 34,
  heading: 32,
  accent: 17,
  surface: 8,
  raised: 8,
  bg: 5,
  text: 4,
  'warning-soft': 3,
  'surface-card': 3,
  error: 3,
  'surface-elevated': 2,
  focus: 2,
  active: 2,
  control: 1,
  'control-foreground': 1,
  dangerSoft: 1,
  link: 1,
  'accent-soft': 1,
  'surface-hover': 1,
  panel: 1
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : []
  })
}

describe('Tailwind ds-* color classes', () => {
  it('only uses ds-* color names that tailwind.config.js defines', async () => {
    const configUrl = pathToFileURL(resolve('tailwind.config.js')).href
    const config = (await import(configUrl)).default as { theme: { extend: { colors: { ds: Record<string, string> } } } }
    const defined = new Set(Object.keys(config.theme.extend.colors.ds))
    expect(defined.has('border-strong')).toBe(true)

    const uses = new Map<string, string[]>()
    for (const path of sourceFiles(RENDERER_ROOT)) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(DS_COLOR_CLASS)) {
        const key = match[1]!
        if (defined.has(key)) continue
        uses.set(key, [...(uses.get(key) ?? []), relative(RENDERER_ROOT, path)])
      }
    }
    const regressions = [...uses].flatMap(([key, files]) => {
      const allowed = KNOWN_UNDEFINED[key] ?? 0
      return files.length > allowed
        ? [`ds-${key}: ${files.length} uses (allowed ${allowed}) in ${[...new Set(files)].join(', ')}`]
        : []
    })
    expect(regressions).toEqual([])
  })
})
