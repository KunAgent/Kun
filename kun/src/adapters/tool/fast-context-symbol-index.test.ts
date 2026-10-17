import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RG_EXECUTABLE_CANDIDATES, type SourceCommandCapture } from './builtin-tool-types.js'
import { resolveRipgrepExecutable, spawnCapture } from './builtin-tool-utils.js'
import { fastContextSearchBounds } from './fast-context-search-bounds.js'
import {
  clearFastContextSymbolIndexCache,
  fastContextIdentifierOf,
  peekFastContextSymbolIndex,
  warmFastContextSymbolIndex
} from './fast-context-symbol-index.js'

const rg = resolveRipgrepExecutable({ candidates: RG_EXECUTABLE_CANDIDATES, allowPathFallback: false })
const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
const bounds = fastContextSearchBounds({ fastContext: true })!

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

function git(root: string, ...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgSign=false', ...args], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

describe('fastContextIdentifierOf', () => {
  it('recognises bare names, word searches, and declaration searches', () => {
    expect(fastContextIdentifierOf('RuntimeEventRecorder', false)).toBe('RuntimeEventRecorder')
    expect(fastContextIdentifierOf('\\bspawnCapture\\b', false)).toBe('spawnCapture')
    expect(fastContextIdentifierOf('export function buildIndex\\(', false)).toBe('buildIndex')
    expect(fastContextIdentifierOf('class\\s+Foo', false)).toBe('Foo')
    expect(fastContextIdentifierOf('foo.*bar', false)).toBeNull()
    expect(fastContextIdentifierOf('ab', true)).toBeNull()
  })
})

describe('Fast Context symbol index', () => {
  const roots: string[] = []
  afterEach(async () => {
    clearFastContextSymbolIndexCache()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it.skipIf(!rg)('extracts top-level definitions across languages but skips tests and locals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-fc-symbols-'))
    roots.push(root)
    await write(root, {
      'src/recorder.ts': 'export class RuntimeEventRecorder {}\nexport const DEFAULT_URL = "x"\nfunction helper() {\n  const local = 1\n}\n',
      'src/recorder.test.ts': 'export class OnlyInTests {}\n',
      'py/app.py': 'class Service:\n    def handle(self):\n        pass\n',
      'go/main.go': 'package main\nfunc (s *Server) Serve() {}\ntype Server struct{}\n',
      'rs/lib.rs': 'pub(crate) async fn fetch_all() {}\npub struct Store;\n',
      'node_modules/pkg/index.ts': 'export class Dependency {}\n'
    })
    await warmFastContextSymbolIndex(root, { rg, capture: spawnCapture, bounds })
    const index = peekFastContextSymbolIndex(root)!
    expect(index.lookup('RuntimeEventRecorder')).toEqual([{ path: 'src/recorder.ts', line: 1 }])
    expect(index.lookup('DEFAULT_URL')).toEqual([{ path: 'src/recorder.ts', line: 2 }])
    expect(index.lookup('helper')).toHaveLength(1)
    expect(index.lookup('local')).toEqual([])
    expect(index.lookup('OnlyInTests')).toEqual([])
    expect(index.lookup('Dependency')).toEqual([])
    expect(index.lookup('handle')).toEqual([{ path: 'py/app.py', line: 2 }])
    expect(index.lookup('Serve')).toEqual([{ path: 'go/main.go', line: 2 }])
    expect(index.lookup('fetch_all')).toEqual([{ path: 'rs/lib.rs', line: 1 }])
    expect(index.lookup('runtimeeventrecorder', true)).toEqual([{ path: 'src/recorder.ts', line: 1 }])
  })

  it.skipIf(!rg)('persists to the runtime data directory and reloads without rescanning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-fc-symbols-persist-'))
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-fc-symbols-data-'))
    roots.push(root, dataDir)
    await write(root, { 'src/a.ts': 'export function alpha() {}\n' })
    await warmFastContextSymbolIndex(root, { rg, capture: spawnCapture, bounds, dataDir })
    const persisted = await readdir(join(dataDir, 'fast-context'))
    expect(persisted.some((name) => /^symbols-[0-9a-f]+\.json$/.test(name))).toBe(true)
    clearFastContextSymbolIndexCache()
    const refuse: SourceCommandCapture = async () => {
      throw new Error('a warm start must not rescan')
    }
    await warmFastContextSymbolIndex(root, { rg, capture: refuse, bounds, dataDir })
    expect(peekFastContextSymbolIndex(root)?.lookup('alpha')).toEqual([{ path: 'src/a.ts', line: 1 }])
  })

  it.skipIf(!rg || !hasGit)('refreshes only changed and untracked files in a git workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-fc-symbols-git-'))
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-fc-symbols-git-data-'))
    roots.push(root, dataDir)
    await write(root, { 'src/a.ts': 'export function alpha() {}\n', 'src/keep.ts': 'export function kept() {}\n' })
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'init')
    await warmFastContextSymbolIndex(root, { rg, capture: spawnCapture, bounds, dataDir })
    expect(peekFastContextSymbolIndex(root)?.lookup('alpha')).toHaveLength(1)

    await write(root, { 'src/a.ts': 'export function alphaRenamed() {}\n', 'src/b.ts': 'export function beta() {}\n' })
    clearFastContextSymbolIndexCache()
    const rgCalls: string[][] = []
    const recording: SourceCommandCapture = async (file, args, options) => {
      if (file === rg) rgCalls.push(args)
      return spawnCapture(file, args, options)
    }
    await warmFastContextSymbolIndex(root, { rg, capture: recording, bounds, dataDir })
    const index = peekFastContextSymbolIndex(root)!
    expect(index.lookup('alpha')).toEqual([])
    expect(index.lookup('alphaRenamed')).toEqual([{ path: 'src/a.ts', line: 1 }])
    expect(index.lookup('beta')).toEqual([{ path: 'src/b.ts', line: 1 }])
    expect(index.lookup('kept')).toEqual([{ path: 'src/keep.ts', line: 1 }])
    expect(rgCalls).toHaveLength(1)
    expect(rgCalls[0]).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']))
    expect(rgCalls[0]).not.toContain('src/keep.ts')
    expect(existsSync(join(root, '.git', 'index.lock'))).toBe(false)
  })

  it('does nothing without the packaged rg', async () => {
    await warmFastContextSymbolIndex('/nonexistent-root', { rg: null, capture: spawnCapture, bounds })
    expect(peekFastContextSymbolIndex('/nonexistent-root')).toBeNull()
  })
})
