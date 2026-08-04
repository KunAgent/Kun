import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const GRAPH_SOURCE_ROOTS = [
  resolve(REPOSITORY_ROOT, 'kun/src/graph'),
  resolve(REPOSITORY_ROOT, 'src/renderer/src/components/graph'),
  resolve(REPOSITORY_ROOT, 'src/renderer/src/graph')
]
const GRAPH_ENTRY_DIRECTORIES = [
  resolve(REPOSITORY_ROOT, 'kun/src/adapters/tool'),
  resolve(REPOSITORY_ROOT, 'kun/src/contracts'),
  resolve(REPOSITORY_ROOT, 'kun/src/server'),
  resolve(REPOSITORY_ROOT, 'kun/src/server/routes')
]
const GRAPH_ENTRY_FILES = [
  resolve(REPOSITORY_ROOT, 'src/shared/app-settings-graph.ts'),
  resolve(REPOSITORY_ROOT, 'src/shared/app-settings-graph.test.ts'),
  resolve(REPOSITORY_ROOT, 'src/main/ipc/app-ipc-schemas/settings-graph.ts'),
  resolve(REPOSITORY_ROOT, 'src/renderer/src/components/settings-section-graph-panel.tsx')
]
const SOURCE_FILE_PATTERN = /\.[cm]?[tj]sx?$/
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[tj]sx?$/

function collectSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (SOURCE_FILE_PATTERN.test(fullPath) && !TEST_FILE_PATTERN.test(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

function isGraphEntryFile(file: string): boolean {
  const name = basename(file)
  return name.startsWith('graph-') || name.startsWith('graph.')
}

function lineCount(file: string): number {
  const source = readFileSync(file, 'utf8')
  if (source.length === 0) return 0
  return source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
}

describe('Graph module boundaries', () => {
  it('keeps Graph implementation files at or below 700 lines', () => {
    const files = [
      ...GRAPH_SOURCE_ROOTS.flatMap(collectSourceFiles),
      ...GRAPH_ENTRY_DIRECTORIES.flatMap((directory) =>
        collectSourceFiles(directory).filter(isGraphEntryFile)
      ),
      ...GRAPH_ENTRY_FILES
    ]
    const oversized = [...new Set(files)]
      .filter((file) => !TEST_FILE_PATTERN.test(file))
      .map((file) => ({
        file: relative(REPOSITORY_ROOT, file).replaceAll('\\', '/'),
        lines: lineCount(file)
      }))
      .filter(({ lines }) => lines > 700)

    expect(oversized).toEqual([])
  })
})
