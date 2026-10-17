import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAST_CONTEXT_MAX_SCAN_FILE_SIZE, type SourceCommandCapture } from './builtin-tool-types.js'
import { normalizeToolPath } from './builtin-tool-utils.js'
import { findFastContextGitDirectory, runFastContextGit, splitGitPaths } from './fast-context-git.js'
import {
  fastContextRipgrepWalkArgs,
  isFastContextDiscoveryExcluded,
  type EffectiveFastContextSearchBounds
} from './fast-context-search-bounds.js'

/**
 * Persistent definition index: top-level functions, classes, types, and
 * similar declarations extracted by one low-priority rg pass. Grep uses it to
 * rank the defining file first and, in very large workspaces, to answer an
 * identifier search without walking the tree at all. It is advisory only:
 * every definition is re-verified by the bounded line search before it is
 * returned, so a stale entry costs one cheap file probe, never a wrong answer.
 */

/** One shared capture group: the defined identifier. */
export const FAST_CONTEXT_DEFINITION_PATTERN = [
  '^(?:',
  '(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?',
  '(?:function\\*?|class|interface|type|enum|const|let|var|namespace)',
  '|[ \\t]*(?:async\\s+)?def|[ \\t]*class',
  '|[ \\t]*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:fn|struct|enum|trait|mod|impl)',
  '|func(?:\\s+\\([^)]*\\))?',
  '|[ \\t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|data|open|partial|override)\\s+)*',
  '(?:class|interface|enum|record|object|struct|protocol|fun|func)',
  ')\\s+([A-Za-z_$][\\w$]*)'
].join('')

const SOURCE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'kt', 'kts',
  'swift', 'rb', 'php', 'cs', 'scala', 'dart', 'vue', 'svelte'
]
const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS)
const DEFINITION_GLOBS = [
  `*.{${SOURCE_EXTENSIONS.join(',')}}`,
  '!*.{test,spec}.*',
  '!*_test.go',
  '!test_*.py',
  '!__tests__/',
  '!__mocks__/'
]

const MAX_DEFINITIONS_PER_NAME = 8
const MAX_TOTAL_DEFINITIONS = 400_000
const MAX_INCREMENTAL_FILES = 3_000
const INCREMENTAL_CHUNK = 400
const REFRESH_INTERVAL_MS = 60_000
const NON_GIT_REBUILD_MS = 10 * 60_000
const IDLE_EVICT_MS = 15 * 60_000
const BUILD_TIMEOUT_MS = 90_000
const PERSIST_VERSION = 1

export type FastContextDefinition = { path: string; line: number }

export type FastContextSymbolLookup = {
  readonly size: number
  readonly builtAt: number
  lookup(name: string, ignoreCase?: boolean): FastContextDefinition[]
}

export type FastContextSymbolIndexOptions = {
  rg: string | null
  capture: SourceCommandCapture
  bounds: EffectiveFastContextSearchBounds
  /** Kun runtime data root; when absent the index lives in memory only. */
  dataDir?: string
}

type State = {
  root: string
  files: string[]
  fileIds: Map<string, number>
  defs: Map<string, number[]>
  entries: number
  builtAt: number
  refreshedAt: number
  lastUsedAt: number
  gitHead?: string
  /** Files that differed from `gitHead` when indexed (dirty or untracked). */
  volatile: string[]
}

const memory = new Map<string, State>()
const inflight = new Map<string, Promise<void>>()
let buildChain: Promise<unknown> = Promise.resolve()
let evictionTimer: ReturnType<typeof setTimeout> | undefined

function scheduleEviction(): void {
  if (evictionTimer) return
  evictionTimer = setTimeout(() => {
    evictionTimer = undefined
    const now = Date.now()
    for (const [root, state] of memory) if (now - state.lastUsedAt > IDLE_EVICT_MS) memory.delete(root)
    if (memory.size > 0) scheduleEviction()
  }, IDLE_EVICT_MS)
  evictionTimer.unref?.()
}

function emptyState(root: string): State {
  const now = Date.now()
  return { root, files: [], fileIds: new Map(), defs: new Map(), entries: 0, builtAt: now, refreshedAt: now, lastUsedAt: now, volatile: [] }
}

function fileId(state: State, path: string): number {
  const existing = state.fileIds.get(path)
  if (existing !== undefined) return existing
  const id = state.files.length
  state.files.push(path)
  state.fileIds.set(path, id)
  return id
}

function addDefinition(state: State, name: string, path: string, line: number): void {
  if (state.entries >= MAX_TOTAL_DEFINITIONS) return
  const pairs = state.defs.get(name) ?? []
  if (pairs.length >= MAX_DEFINITIONS_PER_NAME * 2) return
  pairs.push(fileId(state, path), line)
  state.defs.set(name, pairs)
  state.entries += 1
}

function removeFiles(state: State, paths: ReadonlySet<string>): void {
  const ids = new Set<number>()
  for (const path of paths) {
    const id = state.fileIds.get(path)
    if (id !== undefined) ids.add(id)
  }
  if (ids.size === 0) return
  for (const [name, pairs] of state.defs) {
    const kept: number[] = []
    for (let index = 0; index < pairs.length; index += 2) {
      if (!ids.has(pairs[index]!)) kept.push(pairs[index]!, pairs[index + 1]!)
    }
    state.entries -= (pairs.length - kept.length) / 2
    if (kept.length === 0) state.defs.delete(name)
    else if (kept.length !== pairs.length) state.defs.set(name, kept)
  }
}

function view(state: State): FastContextSymbolLookup {
  const collect = (pairs: readonly number[] | undefined, out: FastContextDefinition[]) => {
    if (!pairs) return
    for (let index = 0; index < pairs.length && out.length < MAX_DEFINITIONS_PER_NAME; index += 2) {
      out.push({ path: state.files[pairs[index]!]!, line: pairs[index + 1]! })
    }
  }
  return {
    size: state.entries,
    builtAt: state.builtAt,
    lookup(name, ignoreCase = false) {
      state.lastUsedAt = Date.now()
      const out: FastContextDefinition[] = []
      if (!ignoreCase) {
        collect(state.defs.get(name), out)
        return out
      }
      const lowered = name.toLowerCase()
      for (const [candidate, pairs] of state.defs) {
        if (candidate.toLowerCase() === lowered) collect(pairs, out)
        if (out.length >= MAX_DEFINITIONS_PER_NAME) break
      }
      return out
    }
  }
}

/** Ready index for `root`, or null while it has not been built yet. */
export function peekFastContextSymbolIndex(root: string): FastContextSymbolLookup | null {
  const state = memory.get(root)
  return state ? view(state) : null
}

/**
 * Starts (or reuses) a background build/refresh. Callers do not need to await
 * it; Fast Context only consults an index that is already in memory.
 */
export function warmFastContextSymbolIndex(root: string, options: FastContextSymbolIndexOptions): Promise<void> {
  if (!options.rg) return Promise.resolve()
  const state = memory.get(root)
  if (state && Date.now() - state.refreshedAt < REFRESH_INTERVAL_MS) return Promise.resolve()
  const pending = inflight.get(root)
  if (pending) return pending
  // One symbol build at a time across all workspaces keeps the background
  // cost to a single low-priority helper.
  const run = buildChain.then(() => refresh(root, options)).catch(() => undefined)
  buildChain = run
  const tracked = run.finally(() => inflight.delete(root))
  inflight.set(root, tracked)
  return tracked
}

/** Test seam: drop in-memory indexes (persisted files are untouched). */
export function clearFastContextSymbolIndexCache(): void {
  memory.clear()
}

async function refresh(root: string, options: FastContextSymbolIndexOptions): Promise<void> {
  const current = memory.get(root) ?? await loadPersisted(root, options.dataDir)
  if (current) {
    const outcome = await refreshIncrementally(current, options)
    if (outcome !== 'rebuild') {
      current.refreshedAt = Date.now()
      current.lastUsedAt = Date.now()
      memory.set(root, current)
      scheduleEviction()
      if (outcome === 'changed') await persist(current, options.dataDir)
      return
    }
  }
  const built = await buildFull(root, options)
  if (!built) return
  memory.set(root, built)
  scheduleEviction()
  await persist(built, options.dataDir)
}

function isIndexableSource(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || !SOURCE_EXTENSION_SET.has(base.slice(dot + 1).toLowerCase())) return false
  if (/\.(?:test|spec)\./i.test(base) || /_test\.go$/.test(base) || /^test_.*\.py$/.test(base)) return false
  return !/(?:^|\/)(?:__tests__|__mocks__)\//.test(path)
}

function parseDefinitions(state: State, stdout: string, bounds: EffectiveFastContextSearchBounds): void {
  for (const row of stdout.split('\n')) {
    const separator = row.indexOf('\0')
    if (separator <= 0) continue
    const path = normalizeToolPath(row.slice(0, separator).replace(/^\.\//, ''))
    const rest = row.slice(separator + 1)
    const colon = rest.indexOf(':')
    const line = Number(rest.slice(0, colon))
    const name = rest.slice(colon + 1).trim()
    if (!Number.isInteger(line) || line <= 0 || !/^[A-Za-z_$][\w$]*$/.test(name)) continue
    if (isFastContextDiscoveryExcluded(path, '.', bounds)) continue
    addDefinition(state, name, path, line)
  }
}

function extractionArgs(): string[] {
  return ['--only-matching', '--replace', '$1', '--line-number', '--with-filename', '--null', '--no-heading', '--threads', '2']
}

async function extract(
  root: string,
  options: FastContextSymbolIndexOptions,
  args: string[],
  maxLines: number
): Promise<string | null> {
  try {
    const result = await options.capture(options.rg!, args, {
      cwd: root,
      lowPriority: true,
      maxOutputBytes: 48 * 1024 * 1024,
      maxLines,
      timeoutMs: BUILD_TIMEOUT_MS
    })
    if (result.timedOut) return null
    return result.stdout
  } catch {
    return null
  }
}

async function gitSnapshot(root: string, capture: SourceCommandCapture): Promise<{ head: string; volatile: string[] } | null> {
  if (!await findFastContextGitDirectory(root)) return null
  const head = await runFastContextGit(root, ['rev-parse', '--verify', 'HEAD'], capture, { maxOutputBytes: 4096 })
  const value = head.stdout.trim()
  if (!head.ok || !/^[0-9a-f]{40,64}$/.test(value)) return null
  const [dirty, untracked] = await Promise.all([
    runFastContextGit(root, ['diff', '--name-only', '--relative', '-z', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], capture),
    runFastContextGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], capture)
  ])
  if (!dirty.ok || !untracked.ok) return null
  return { head: value, volatile: [...new Set([...splitGitPaths(dirty.stdout), ...splitGitPaths(untracked.stdout)])].slice(0, MAX_INCREMENTAL_FILES) }
}

async function buildFull(root: string, options: FastContextSymbolIndexOptions): Promise<State | null> {
  const snapshot = await gitSnapshot(root, options.capture)
  const stdout = await extract(root, options, [
    ...fastContextRipgrepWalkArgs(options.bounds, root),
    ...DEFINITION_GLOBS.flatMap((glob) => ['-g', glob]),
    ...extractionArgs(),
    '-e', FAST_CONTEXT_DEFINITION_PATTERN,
    '--', '.'
  ], MAX_TOTAL_DEFINITIONS * 2)
  if (stdout === null) return null
  const state = emptyState(root)
  parseDefinitions(state, stdout, options.bounds)
  if (snapshot) {
    state.gitHead = snapshot.head
    state.volatile = snapshot.volatile
  }
  return state
}

async function refreshIncrementally(
  state: State,
  options: FastContextSymbolIndexOptions
): Promise<'unchanged' | 'changed' | 'rebuild'> {
  if (!state.gitHead) return Date.now() - state.builtAt < NON_GIT_REBUILD_MS ? 'unchanged' : 'rebuild'
  const snapshot = await gitSnapshot(state.root, options.capture)
  if (!snapshot) return 'rebuild'
  const since = await runFastContextGit(
    state.root,
    ['diff', '--name-only', '--relative', '-z', '--no-ext-diff', '--no-textconv', state.gitHead, '--'],
    options.capture
  )
  if (!since.ok) return 'rebuild'
  const changed = new Set([...splitGitPaths(since.stdout), ...snapshot.volatile, ...state.volatile].map(normalizeToolPath))
  if (changed.size > MAX_INCREMENTAL_FILES) return 'rebuild'
  if (changed.size === 0 && snapshot.head === state.gitHead) return 'unchanged'
  removeFiles(state, changed)
  const present = [...changed].filter((path) => isIndexableSource(path) && existsSync(join(state.root, path)))
  for (let index = 0; index < present.length; index += INCREMENTAL_CHUNK) {
    const chunk = present.slice(index, index + INCREMENTAL_CHUNK)
    const stdout = await extract(state.root, options, [
      '--no-config', '--max-filesize', FAST_CONTEXT_MAX_SCAN_FILE_SIZE,
      ...extractionArgs(), '-e', FAST_CONTEXT_DEFINITION_PATTERN, '--', ...chunk
    ], MAX_TOTAL_DEFINITIONS)
    if (stdout === null) return 'rebuild'
    parseDefinitions(state, stdout, options.bounds)
  }
  state.gitHead = snapshot.head
  state.volatile = snapshot.volatile
  return 'changed'
}

function persistPath(root: string, dataDir: string): string {
  const key = createHash('sha256').update(root).digest('hex').slice(0, 24)
  return join(dataDir, 'fast-context', `symbols-${key}.json`)
}

type PersistedIndex = {
  version: number
  root: string
  builtAt: number
  gitHead?: string
  volatile: string[]
  files: string[]
  defs: Array<[string, number[]]>
}

async function persist(state: State, dataDir: string | undefined): Promise<void> {
  if (!dataDir) return
  const target = persistPath(state.root, dataDir)
  // Compact file ids so removed files do not accumulate across refreshes.
  const used = new Map<number, number>()
  const files: string[] = []
  const defs: Array<[string, number[]]> = []
  for (const [name, pairs] of state.defs) {
    const remapped: number[] = []
    for (let index = 0; index < pairs.length; index += 2) {
      let id = used.get(pairs[index]!)
      if (id === undefined) {
        id = files.length
        files.push(state.files[pairs[index]!]!)
        used.set(pairs[index]!, id)
      }
      remapped.push(id, pairs[index + 1]!)
    }
    defs.push([name, remapped])
  }
  const payload: PersistedIndex = {
    version: PERSIST_VERSION,
    root: state.root,
    builtAt: state.builtAt,
    ...(state.gitHead ? { gitHead: state.gitHead } : {}),
    volatile: state.volatile,
    files,
    defs
  }
  try {
    await mkdir(join(dataDir, 'fast-context'), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(payload), 'utf8')
    await rename(temporary, target)
  } catch {
    // A read-only or full data directory only loses the warm start.
  }
}

async function loadPersisted(root: string, dataDir: string | undefined): Promise<State | null> {
  if (!dataDir) return null
  try {
    const parsed = JSON.parse(await readFile(persistPath(root, dataDir), 'utf8')) as PersistedIndex
    if (parsed.version !== PERSIST_VERSION || parsed.root !== root || !Array.isArray(parsed.files) || !Array.isArray(parsed.defs)) return null
    const state = emptyState(root)
    state.builtAt = Number(parsed.builtAt) || Date.now()
    state.refreshedAt = 0
    if (typeof parsed.gitHead === 'string') state.gitHead = parsed.gitHead
    state.volatile = Array.isArray(parsed.volatile) ? parsed.volatile.filter((entry) => typeof entry === 'string') : []
    for (const [name, pairs] of parsed.defs) {
      if (typeof name !== 'string' || !Array.isArray(pairs)) continue
      for (let index = 0; index + 1 < pairs.length; index += 2) {
        const path = parsed.files[pairs[index]!]
        const line = pairs[index + 1]!
        if (typeof path === 'string' && Number.isInteger(line)) addDefinition(state, name, path, line)
      }
    }
    return state
  } catch {
    return null
  }
}

/**
 * Identifier a grep pattern is looking for, when it is one: a bare name, a
 * `\bname\b` word search, or a declaration such as `function name`.
 */
export function fastContextIdentifierOf(pattern: string, literal: boolean): string | null {
  let text = pattern.trim()
  if (!literal) text = text.replace(/\\b/g, '').replace(/\\s[+*]?/g, ' ').replace(/\\\(/g, '(')
  text = text.replace(/\($/, '').replace(/\s+/g, ' ').trim()
  const declaration = /^(?:export )?(?:default )?(?:async )?(?:function|class|interface|type|enum|const|let|var|def|fn|struct|trait|func|fun) ([A-Za-z_$][\w$]*)$/.exec(text)
  const name = declaration?.[1] ?? text
  return /^[A-Za-z_$][\w$]{2,}$/.test(name) ? name : null
}
