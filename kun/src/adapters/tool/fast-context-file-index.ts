import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import type { SourceCommandCapture } from './builtin-tool-types.js'
import { normalizeToolPath } from './builtin-tool-utils.js'
import { fastContextGitStamp, findFastContextGitDirectory, runFastContextGit, splitGitPaths } from './fast-context-git.js'
import { withFastContextProcessSlot } from './fast-context-process-slots.js'
import {
  fastContextRipgrepWalkArgs,
  isFastContextDiscoveryExcluded,
  type EffectiveFastContextSearchBounds
} from './fast-context-search-bounds.js'

/**
 * Cached list of the workspace's searchable files. One listing serves every
 * glob in a run (no per-call tree walk), the workspace overview handed to the
 * retrieval child, and the large-workspace guard. Sources, in order: the
 * packaged rg (`--files`, honours .gitignore/.ignore/.kunignore), then
 * `git ls-files` when rg is unavailable, then a bounded directory walk.
 */
export type FastContextFileIndex = {
  readonly root: string
  /** Workspace-relative, `/`-separated, sorted. */
  readonly files: readonly string[]
  /** True when the listing stopped at the file ceiling. */
  readonly truncated: boolean
  readonly timedOut: boolean
  readonly backend: 'rg' | 'git' | 'scan'
  readonly builtAt: number
}

export type FastContextFileIndexOptions = {
  rg: string | null
  capture: SourceCommandCapture
  bounds: EffectiveFastContextSearchBounds
}

export const FAST_CONTEXT_FILE_INDEX_MAX_FILES = 200_000
const FAST_CONTEXT_SCAN_INDEX_MAX_FILES = 20_000
const INDEX_FRESH_MS = 15_000
const INDEX_MAX_AGE_MS = 120_000
const INDEX_IDLE_EVICT_MS = 5 * 60_000
const INDEX_MAX_WORKSPACES = 2
const INDEX_BUILD_TIMEOUT_MS = 20_000

type CacheEntry = { index: FastContextFileIndex; stamp?: string; checkedAt: number; lastUsedAt: number }

const cache = new Map<string, CacheEntry>()
const builds = new Map<string, Promise<FastContextFileIndex | null>>()
let evictionTimer: ReturnType<typeof setTimeout> | undefined

function scheduleEviction(): void {
  if (evictionTimer) return
  evictionTimer = setTimeout(() => {
    evictionTimer = undefined
    const now = Date.now()
    for (const [root, entry] of cache) {
      if (now - entry.lastUsedAt > INDEX_IDLE_EVICT_MS) cache.delete(root)
    }
    if (cache.size > 0) scheduleEviction()
  }, INDEX_IDLE_EVICT_MS)
  evictionTimer.unref?.()
}

function remember(root: string, index: FastContextFileIndex, stamp: string | undefined): void {
  const now = Date.now()
  cache.delete(root)
  cache.set(root, { index, ...(stamp ? { stamp } : {}), checkedAt: now, lastUsedAt: now })
  while (cache.size > INDEX_MAX_WORKSPACES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  scheduleEviction()
}

/**
 * A home directory or filesystem root is not a project: listing it would walk
 * the whole disk. Such workspaces keep the live, scoped searches instead.
 */
export function isFastContextIndexableRoot(root: string): boolean {
  const normalized = resolve(root)
  if (parse(normalized).root === normalized) return false
  try {
    if (normalized === resolve(homedir())) return false
  } catch {
    // No resolvable home directory: nothing to compare against.
  }
  return true
}

/** Cached index without building or revalidating it (may be stale). */
export function peekFastContextFileIndex(root: string): FastContextFileIndex | null {
  const entry = cache.get(root)
  if (!entry) return null
  entry.lastUsedAt = Date.now()
  return entry.index
}

/** Returns a fresh-enough index, building it at most once concurrently. */
export async function getFastContextFileIndex(
  root: string,
  options: FastContextFileIndexOptions
): Promise<FastContextFileIndex | null> {
  if (!isFastContextIndexableRoot(root)) return null
  const entry = cache.get(root)
  const now = Date.now()
  if (entry) {
    entry.lastUsedAt = now
    if (now - entry.checkedAt < INDEX_FRESH_MS) return entry.index
    if (now - entry.index.builtAt < INDEX_MAX_AGE_MS && entry.stamp) {
      const stamp = await fastContextGitStamp(root)
      if (stamp === entry.stamp) {
        entry.checkedAt = Date.now()
        return entry.index
      }
    }
  }
  const pending = builds.get(root)
  if (pending) return pending
  const build = (async () => {
    const stamp = await fastContextGitStamp(root)
    const index = await buildFastContextFileIndex(root, options)
    if (index) remember(root, index, stamp)
    // A failed rebuild keeps serving the previous listing rather than none.
    return index ?? cache.get(root)?.index ?? null
  })().finally(() => builds.delete(root))
  builds.set(root, build)
  return build
}

/** Test seam: forget every cached index. */
export function clearFastContextFileIndexCache(): void {
  cache.clear()
}

function keepFile(relativePath: string, bounds: EffectiveFastContextSearchBounds): string | null {
  const normalized = normalizeToolPath(relativePath.replace(/^\.\//, ''))
  if (!normalized || normalized === '.') return null
  return isFastContextDiscoveryExcluded(normalized, '.', bounds) ? null : normalized
}

function finish(
  root: string,
  candidates: Iterable<string>,
  bounds: EffectiveFastContextSearchBounds,
  backend: FastContextFileIndex['backend'],
  limit: number,
  flags: { truncated: boolean; timedOut: boolean }
): FastContextFileIndex {
  const files: string[] = []
  let truncated = flags.truncated
  for (const candidate of candidates) {
    const kept = keepFile(candidate, bounds)
    if (!kept) continue
    if (files.length >= limit) {
      truncated = true
      break
    }
    files.push(kept)
  }
  files.sort()
  return { root, files, truncated, timedOut: flags.timedOut, backend, builtAt: Date.now() }
}

async function buildFastContextFileIndex(
  root: string,
  options: FastContextFileIndexOptions
): Promise<FastContextFileIndex | null> {
  // Index builds are shared by every caller, so one caller aborting must not
  // cancel them; they carry their own timeout instead.
  const signal = new AbortController().signal
  if (options.rg) {
    const rg = options.rg
    try {
      const result = await withFastContextProcessSlot(signal, () => options.capture(
        rg,
        ['--files', ...fastContextRipgrepWalkArgs(options.bounds, root), '--threads', '2', '--', '.'],
        {
          cwd: root,
          signal,
          maxOutputBytes: 64 * 1024 * 1024,
          maxLines: FAST_CONTEXT_FILE_INDEX_MAX_FILES + 1,
          timeoutMs: INDEX_BUILD_TIMEOUT_MS,
          lowPriority: true
        }
      ))
      if (result.stdout.trim() || result.exitCode === 0 || result.exitCode === 1) {
        return finish(root, result.stdout.split(/\r?\n/), options.bounds, 'rg', FAST_CONTEXT_FILE_INDEX_MAX_FILES, {
          truncated: result.outputTruncated || result.lineLimitReached === true,
          timedOut: result.timedOut
        })
      }
    } catch {
      // Fall through to git or the bounded walk.
    }
  }
  if (await findFastContextGitDirectory(root)) {
    const listed = await runFastContextGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], options.capture, {
      maxOutputBytes: 64 * 1024 * 1024,
      timeoutMs: INDEX_BUILD_TIMEOUT_MS
    })
    if (listed.ok) {
      return finish(root, splitGitPaths(listed.stdout), options.bounds, 'git', FAST_CONTEXT_FILE_INDEX_MAX_FILES, {
        truncated: listed.truncated,
        timedOut: false
      })
    }
  }
  try {
    const walked = await walkFastContextFiles(root, options.bounds, FAST_CONTEXT_SCAN_INDEX_MAX_FILES + 1)
    return finish(root, walked, options.bounds, 'scan', FAST_CONTEXT_SCAN_INDEX_MAX_FILES, { truncated: false, timedOut: false })
  } catch {
    return null
  }
}

/**
 * Bounded breadth-first listing below `base` (paths relative to it) that
 * prunes every Fast Context excluded directory name.
 */
export async function walkFastContextFiles(
  base: string,
  bounds: EffectiveFastContextSearchBounds,
  limit: number
): Promise<string[]> {
  const root = base
  const files: string[] = []
  const queue: string[] = ['']
  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()!
    const entries = await readdir(join(root, current), { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relativePath = current ? `${current}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const lowered = entry.name.toLowerCase()
        if (bounds.excludedDirectoryNames.has(lowered) || bounds.discoveryExcludedDirectoryNames.has(lowered)) continue
        queue.push(relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
        if (files.length >= limit) break
      }
    }
  }
  return files
}

type CompiledGlob = { test: (relativePath: string) => boolean }

function expandBraces(pattern: string, budget = 64): string[] {
  const open = pattern.indexOf('{')
  if (open < 0) return [pattern]
  const close = pattern.indexOf('}', open)
  if (close < 0) return [pattern]
  const head = pattern.slice(0, open)
  const tail = pattern.slice(close + 1)
  const out: string[] = []
  for (const option of pattern.slice(open + 1, close).split(',')) {
    for (const expanded of expandBraces(`${head}${option}${tail}`, budget)) {
      out.push(expanded)
      if (out.length >= budget) return out
    }
  }
  return out
}

function globBodyToRegExp(glob: string): string {
  let out = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!
    if (char === '*') {
      if (glob[index + 1] === '*') {
        const slash = glob[index + 2] === '/'
        out += slash ? '(?:.*/)?' : '.*'
        index += slash ? 2 : 1
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if (char === '[') {
      const end = glob.indexOf(']', index + 1)
      if (end < 0) {
        out += '\\['
      } else {
        const body = glob.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')
        out += `[${body}]`
        index = end
      }
    } else {
      out += /[.+^${}()|\\]/.test(char) ? `\\${char}` : char
    }
  }
  return out
}

/** rg-style glob: braces, `**`, `*`, `?`, classes; slash-free globs match basenames. */
export function compileFastContextGlob(pattern: string): CompiledGlob {
  const trimmed = pattern.trim().replace(/^\.\//, '')
  const alternatives = expandBraces(trimmed)
  const basenameOnly = !trimmed.includes('/')
  const expression = new RegExp(`^(?:${alternatives.map(globBodyToRegExp).join('|')})$`, 'i')
  return {
    test: (relativePath) => {
      const normalized = normalizeToolPath(relativePath)
      const target = basenameOnly ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized
      return expression.test(target)
    }
  }
}

/** Indexed files under `searchRoot` (workspace-relative) matching `pattern`. */
export function matchFastContextIndex(
  index: FastContextFileIndex,
  input: { searchRoot: string; pattern?: string | null }
): string[] {
  const root = normalizeToolPath(input.searchRoot)
  const atRoot = root === '.' || root === ''
  const matcher = input.pattern ? compileFastContextGlob(input.pattern) : null
  const out: string[] = []
  for (const file of index.files) {
    if (!atRoot && file !== root && !file.startsWith(`${root}/`)) continue
    if (matcher) {
      const below = atRoot ? file : file === root ? file.slice(file.lastIndexOf('/') + 1) : file.slice(root.length + 1)
      if (!matcher.test(below) && !matcher.test(file)) continue
    }
    out.push(file)
  }
  return out
}

/** Top-level directories by indexed file count (used in scope hints). */
export function fastContextTopDirectories(index: FastContextFileIndex | null, limit = 12): string[] {
  if (!index) return []
  const counts = new Map<string, number>()
  for (const file of index.files) {
    const slash = file.indexOf('/')
    if (slash > 0) counts.set(file.slice(0, slash), (counts.get(file.slice(0, slash)) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name]) => `${name}/`)
}
