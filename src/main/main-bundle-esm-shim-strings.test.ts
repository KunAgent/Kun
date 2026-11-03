import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// electron-vite's `vite:esm-shim` finds the last static import with a regex over
// the bundled chunk and inserts its CommonJS shim right after it. A string that
// ends in "import" just before its quote matches that regex, so the shim lands
// inside the next string and the main build fails with "Unterminated string literal".
const SHIM_TRIGGER = /(?:^|[\s;])import\s*['"]/u
const BUNDLED_ROOTS = ['src/main', 'src/shared', 'src/preload']

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : []
  })
}

describe('main bundle ESM shim safety', () => {
  it('keeps string literals from reading as a static import', () => {
    const repository = process.cwd()
    const offenders = BUNDLED_ROOTS.flatMap((root) => sources(join(repository, root))).flatMap((file) =>
      readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
        const code = line.trim()
        if (code.startsWith('import') || code.startsWith('//') || code.startsWith('*')) return []
        return SHIM_TRIGGER.test(line) ? [`${relative(repository, file)}:${index + 1}: ${code}`] : []
      }))
    expect(offenders).toEqual([])
  })
})
