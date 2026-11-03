import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SourceCommandCapture } from './builtin-tool-types.js'
import {
  clearFastContextFileIndexCache,
  compileFastContextGlob,
  fastContextTopDirectories,
  getFastContextFileIndex,
  isFastContextIndexableRoot,
  matchFastContextIndex,
  peekFastContextFileIndex,
  type FastContextFileIndex
} from './fast-context-file-index.js'
import { fastContextSearchBounds } from './fast-context-search-bounds.js'
import { buildFastContextWorkspaceSkeleton } from './fast-context-workspace-skeleton.js'

const bounds = fastContextSearchBounds({ fastContext: true })!
const noCapture: SourceCommandCapture = async () => {
  throw new Error('no helper processes expected')
}

function index(files: string[], extra: Partial<FastContextFileIndex> = {}): FastContextFileIndex {
  return { root: '/w', files, truncated: false, timedOut: false, backend: 'rg', builtAt: Date.now(), ...extra }
}

describe('Fast Context file index', () => {
  const workspaces: string[] = []
  afterEach(async () => {
    clearFastContextFileIndexCache()
    await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('builds from the packaged rg once and serves later calls from cache', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fc-index-rg-'))
    workspaces.push(workspace)
    let calls = 0
    const capture: SourceCommandCapture = async (_file, args, options) => {
      calls += 1
      expect(args[0]).toBe('--files')
      expect(options).toMatchObject({ cwd: workspace, lowPriority: true })
      return { stdout: './src/b.ts\n./src/a.ts\n./.claude/x.md\n./node_modules/p/i.js\n', stderr: '', exitCode: 0, outputTruncated: false, timedOut: false }
    }
    const first = await getFastContextFileIndex(workspace, { rg: '/fake/rg', capture, bounds })
    const second = await getFastContextFileIndex(workspace, { rg: '/fake/rg', capture, bounds })
    expect(first?.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(second).toBe(first)
    expect(peekFastContextFileIndex(workspace)).toBe(first)
    expect(calls).toBe(1)
  })

  it('falls back to a bounded walk that prunes excluded directories when rg and git are unavailable', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-fc-index-walk-'))
    workspaces.push(workspace)
    await Promise.all(['src', 'node_modules/pkg', '.vscode', 'dist'].map((dir) => mkdir(join(workspace, dir), { recursive: true })))
    await Promise.all([
      writeFile(join(workspace, 'src', 'keep.ts'), ''),
      writeFile(join(workspace, 'README.md'), ''),
      writeFile(join(workspace, 'node_modules', 'pkg', 'index.js'), ''),
      writeFile(join(workspace, '.vscode', 'settings.json'), ''),
      writeFile(join(workspace, 'dist', 'bundle.js'), '')
    ])
    const built = await getFastContextFileIndex(workspace, { rg: null, capture: noCapture, bounds })
    expect(built).toMatchObject({ backend: 'scan', files: ['README.md', 'src/keep.ts'] })
  })

  it('never lists a home directory or filesystem root', async () => {
    expect(isFastContextIndexableRoot(homedir())).toBe(false)
    expect(isFastContextIndexableRoot('/')).toBe(false)
    expect(isFastContextIndexableRoot(join(tmpdir(), 'project'))).toBe(true)
    await expect(getFastContextFileIndex(homedir(), { rg: '/fake/rg', capture: noCapture, bounds })).resolves.toBeNull()
  })

  it('compiles rg-style globs with braces, double stars, and basename matching', () => {
    expect(compileFastContextGlob('*.{ts,tsx}').test('src/deep/a.tsx')).toBe(true)
    expect(compileFastContextGlob('*.{ts,tsx}').test('src/a.js')).toBe(false)
    expect(compileFastContextGlob('src/**/*.test.ts').test('src/a/b/c.test.ts')).toBe(true)
    expect(compileFastContextGlob('src/**/*.test.ts').test('src/c.test.ts')).toBe(true)
    expect(compileFastContextGlob('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(compileFastContextGlob('fast-context-*').test('kun/src/fast-context-grep.ts')).toBe(true)
    expect(compileFastContextGlob('[ab].md').test('docs/b.md')).toBe(true)
  })

  it('matches globs below a search root and summarises top-level directories', () => {
    const listing = index(['src/a.ts', 'src/sub/b.ts', 'kun/src/c.ts', 'kun/src/d.ts', 'kun/e.json', 'README.md'])
    expect(matchFastContextIndex(listing, { searchRoot: 'src', pattern: '*.ts' })).toEqual(['src/a.ts', 'src/sub/b.ts'])
    expect(matchFastContextIndex(listing, { searchRoot: 'kun', pattern: 'src/*.ts' })).toEqual(['kun/src/c.ts', 'kun/src/d.ts'])
    expect(matchFastContextIndex(listing, { searchRoot: '.', pattern: null })).toHaveLength(6)
    expect(fastContextTopDirectories(listing)).toEqual(['kun/', 'src/'])
  })
})

describe('Fast Context workspace overview', () => {
  it('lists file types, top-level directories with children, and root files within 2 KB', () => {
    const files = [
      ...Array.from({ length: 30 }, (_, n) => `kun/src/loop/f${n}.ts`),
      ...Array.from({ length: 10 }, (_, n) => `kun/tests/t${n}.ts`),
      ...Array.from({ length: 5 }, (_, n) => `src/renderer/r${n}.tsx`),
      'package.json',
      'README.md'
    ]
    const text = buildFastContextWorkspaceSkeleton(index(files))
    expect(text).toContain('Workspace overview (47 searchable files')
    expect(text).toContain('File types: ts 40, tsx 5')
    expect(text).toContain('- kun/ 40: src/ 30, tests/ 10')
    expect(text).toContain('Root files: package.json, README.md')
    expect(text).not.toContain('This workspace is large')
    expect(text.length).toBeLessThanOrEqual(2_000)
  })

  it('warns the child when the workspace is too large for unscoped greps', () => {
    const text = buildFastContextWorkspaceSkeleton(index(Array.from({ length: 50_001 }, (_, n) => `pkg${n % 40}/f${n}.ts`)))
    expect(text).toContain('This workspace is large')
    expect(text.length).toBeLessThanOrEqual(2_000)
  })
})
