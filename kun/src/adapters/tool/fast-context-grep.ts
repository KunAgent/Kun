import { stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { FastContextRunScope } from '../../ports/tool-host.js'
import type { GrepMatch, SourceCommandCapture } from './builtin-tool-types.js'
import {
  FAST_CONTEXT_CANDIDATE_FILE_LIMIT,
  FAST_CONTEXT_CANDIDATE_MAX_COUNT_PER_FILE,
  FAST_CONTEXT_LARGE_WORKSPACE_FILE_COUNT,
  FAST_CONTEXT_RANKED_FILE_LIMIT,
  FAST_CONTEXT_TIMEOUTS_BEFORE_SCOPE_REQUIRED
} from './builtin-tool-types.js'
import { normalizeToolPath } from './builtin-tool-utils.js'
import { fastContextTopDirectories, peekFastContextFileIndex } from './fast-context-file-index.js'
import { scanFastContextGrep } from './fast-context-grep-scan.js'
import { withFastContextProcessSlot } from './fast-context-process-slots.js'
import {
  fastContextPatternTerms,
  isUnderFastContextHint,
  rankFastContextFiles,
  type FastContextRankingTerms
} from './fast-context-ranking.js'
import {
  boundFastContextMatch,
  fastContextRipgrepWalkArgs,
  fastContextScopeHint,
  isFastContextDiscoveryExcluded,
  type EffectiveFastContextSearchBounds,
  type FastContextScopeHint,
  type FastContextScopeHintReason
} from './fast-context-search-bounds.js'
import { fastContextIdentifierOf, peekFastContextSymbolIndex } from './fast-context-symbol-index.js'

export type FastContextGrepRequest = {
  pattern: string
  glob: string | null
  ignoreCase: boolean
  literal: boolean
  /** JS twin of the pattern, used for columns and the scan fallback. */
  matcher: RegExp
  root: string
  absolutePath: string
  /** Workspace-relative target; `.` is the workspace root. */
  relativePath: string
  /** True when the model passed `path`; false lets Fast Context pick the scope. */
  pathExplicit: boolean
  bounds: EffectiveFastContextSearchBounds
  rg: string | null
  capture: SourceCommandCapture
  signal: AbortSignal
  run: FastContextRunScope | undefined
  /** Matches to collect: the visible page plus one to detect truncation. */
  scanLimit: number
  maxFileBytes: number
  maxTotalBytes: number
}

export type FastContextGrepScope = 'path' | 'workspace' | 'hint_paths' | 'definition_scope'

export type FastContextGrepMeta = {
  scope: FastContextGrepScope
  candidateFiles: number
  candidateFilesTruncated: boolean
  definitionFiles: number
  commandOutputTruncated: boolean
  commandTimedOut: boolean
  skippedLargeFiles: number
  scanByteLimitReached: boolean
  scopeHint?: FastContextScopeHint
}

export type FastContextGrepOutcome =
  | { kind: 'matches'; backend: 'rg' | 'scan'; matches: GrepMatch[]; meta: FastContextGrepMeta }
  | { kind: 'scope_required'; hint: FastContextScopeHint }

export type FastContextCandidate = {
  /** Workspace-relative path. */
  path: string
  matchCount: number
  definition: boolean
  hinted: boolean
}

type CommandFlags = { outputTruncated: boolean; timedOut: boolean; lineLimitReached: boolean }

const isRoot = (relativePath: string) => {
  const normalized = normalizeToolPath(relativePath)
  return normalized === '.' || normalized === ''
}

function under(path: string, searchRoot: string): boolean {
  return isRoot(searchRoot) || isUnderFastContextHint(path, [searchRoot])
}

/** Workspace-relative path for rg output that may be `./x`, `x`, or absolute. */
function workspaceRelative(root: string, printed: string): string {
  return normalizeToolPath(relative(root, resolve(root, printed.replace(/^\.\//, ''))) || '.')
}

/** Argument for a search root: relative inside the workspace, absolute outside. */
function searchArgument(root: string, relativePath: string): string {
  return relativePath.startsWith('..') ? resolve(root, relativePath) : (normalizeToolPath(relativePath) || '.')
}

function contentFlags(request: FastContextGrepRequest): string[] {
  return [...(request.ignoreCase ? ['--ignore-case'] : []), ...(request.literal ? ['--fixed-strings'] : [])]
}

async function runRg(
  request: FastContextGrepRequest,
  args: string[],
  maxLines: number | undefined
): Promise<{ stdout: string } & CommandFlags> {
  const result = await withFastContextProcessSlot(request.signal, () => request.capture(request.rg!, args, {
    cwd: request.root,
    signal: request.signal,
    maxOutputBytes: request.bounds.maxOutputBytes,
    timeoutMs: request.bounds.timeoutMs,
    lowPriority: true,
    ...(maxLines !== undefined ? { maxLines } : {})
  }))
  return {
    stdout: result.stdout,
    outputTruncated: result.outputTruncated,
    timedOut: result.timedOut,
    lineLimitReached: result.lineLimitReached === true
  }
}

/** Phase one: which files match, and how often (capped per file). */
async function countCandidates(
  request: FastContextGrepRequest,
  searchRoots: readonly string[],
  searchRootForExclusion: string
): Promise<{ candidates: Map<string, number> } & CommandFlags> {
  const result = await runRg(request, [
    ...fastContextRipgrepWalkArgs(request.bounds, request.root),
    '--count', '--with-filename', '--null', '--sort', 'path',
    '--max-count', String(FAST_CONTEXT_CANDIDATE_MAX_COUNT_PER_FILE),
    ...contentFlags(request),
    ...(request.glob ? ['-g', request.glob] : []),
    '-e', request.pattern,
    '--', ...searchRoots.map((path) => searchArgument(request.root, path))
  ], FAST_CONTEXT_CANDIDATE_FILE_LIMIT)
  const candidates = new Map<string, number>()
  for (const row of result.stdout.split('\n')) {
    const separator = row.lastIndexOf('\0')
    if (separator <= 0) continue
    const path = workspaceRelative(request.root, row.slice(0, separator))
    const count = Number(row.slice(separator + 1).trim())
    if (!Number.isFinite(count) || count <= 0) continue
    if (isFastContextDiscoveryExcluded(path, searchRootForExclusion, request.bounds)) continue
    candidates.set(path, Math.max(candidates.get(path) ?? 0, count))
  }
  return { candidates, ...result }
}

/** Phase two: matching lines from the chosen files only, in rank order. */
async function collectLines(
  request: FastContextGrepRequest,
  files: readonly string[]
): Promise<{ matches: GrepMatch[] } & CommandFlags> {
  if (files.length === 0) return { matches: [], outputTruncated: false, timedOut: false, lineLimitReached: false }
  const perFile = Math.max(5, Math.ceil(request.scanLimit / files.length))
  const result = await runRg(request, [
    '--no-config', '--line-number', '--with-filename', '--null', '--no-heading',
    '--max-count', String(perFile),
    '--max-columns', String(request.bounds.maxTextCharacters), '--max-columns-preview',
    ...contentFlags(request),
    '-e', request.pattern,
    '--', ...files.map((path) => searchArgument(request.root, path))
  ], undefined)
  const byFile = new Map<string, GrepMatch[]>()
  for (const row of result.stdout.split('\n')) {
    const separator = row.indexOf('\0')
    if (separator <= 0) continue
    const relativePath = workspaceRelative(request.root, row.slice(0, separator))
    const rest = row.slice(separator + 1)
    const colon = rest.indexOf(':')
    const line = Number(rest.slice(0, colon))
    if (colon <= 0 || !Number.isInteger(line) || line <= 0) continue
    const text = rest.slice(colon + 1).replace(/\r$/, '')
    request.matcher.lastIndex = 0
    const column = request.matcher.exec(text)?.index ?? 0
    const match: GrepMatch = {
      path: resolve(request.root, relativePath),
      relative_path: relativePath,
      line,
      column: column + 1,
      text
    }
    const list = byFile.get(relativePath) ?? []
    list.push(boundFastContextMatch(match, request.bounds))
    byFile.set(relativePath, list)
  }
  const matches: GrepMatch[] = []
  for (const file of files) {
    for (const match of (byFile.get(normalizeToolPath(file)) ?? []).sort((left, right) => left.line - right.line)) {
      if (matches.length >= request.scanLimit) break
      matches.push(match)
    }
  }
  return { matches, ...result }
}

function rankingTerms(request: FastContextGrepRequest): FastContextRankingTerms {
  return { pattern: fastContextPatternTerms(request.pattern, request.literal), query: request.run?.queryTerms ?? [] }
}

export function rankFastContextCandidates(
  candidates: readonly FastContextCandidate[],
  terms: FastContextRankingTerms
): FastContextCandidate[] {
  return rankFastContextFiles(candidates, (entry) => entry.path, terms, (entry) => ({
    matchCount: entry.matchCount,
    definition: entry.definition,
    hinted: entry.hinted
  }))
}

function emptyMeta(scope: FastContextGrepScope): FastContextGrepMeta {
  return {
    scope,
    candidateFiles: 0,
    candidateFilesTruncated: false,
    definitionFiles: 0,
    commandOutputTruncated: false,
    commandTimedOut: false,
    skippedLargeFiles: 0,
    scanByteLimitReached: false
  }
}

/** Fast Context grep: bounded, ranked, and scoped before it walks anything. */
export async function runFastContextGrep(request: FastContextGrepRequest): Promise<FastContextGrepOutcome> {
  const target = await stat(request.absolutePath).catch(() => null)
  if (!target) return { kind: 'matches', backend: request.rg ? 'rg' : 'scan', matches: [], meta: emptyMeta('path') }
  const relativePath = normalizeToolPath(request.relativePath) || '.'
  const terms = rankingTerms(request)
  if (target.isFile()) {
    if (!request.rg) {
      return scanFastContextGrep(request, { relativePath, hints: [], definitionPaths: new Set(), terms, singleFile: true })
    }
    const lines = await collectLines(request, [relativePath])
    noteTimeout(request, lines.timedOut)
    return {
      kind: 'matches',
      backend: 'rg',
      matches: lines.matches,
      meta: {
        ...emptyMeta('path'),
        candidateFiles: lines.matches.length ? 1 : 0,
        commandOutputTruncated: lines.outputTruncated,
        commandTimedOut: lines.timedOut
      }
    }
  }
  const atRoot = isRoot(relativePath)
  // An omitted path lets Fast Context choose the scope (hint paths, then the
  // directories that define a searched identifier). An explicit path,
  // including ".", is honoured exactly as given.
  const autoScope = atRoot && !request.pathExplicit
  const hints = autoScope ? [...(request.run?.hintPaths ?? [])] : []
  const identifier = fastContextIdentifierOf(request.pattern, request.literal)
  const definitions = identifier
    ? (peekFastContextSymbolIndex(request.root)?.lookup(identifier, request.ignoreCase) ?? [])
      .filter((entry) => under(entry.path, relativePath) && !isFastContextDiscoveryExcluded(entry.path, relativePath, request.bounds))
    : []
  const definitionPaths = new Set(definitions.map((entry) => entry.path))
  const definitionScopes = autoScope ? fastContextDefinitionScopes(definitionPaths) : []
  const guardReason = atRoot && !request.glob ? largeWorkspaceReason(request) : null
  const refuse = (reason: FastContextScopeHintReason): FastContextGrepOutcome => ({
    kind: 'scope_required',
    hint: fastContextScopeHint(reason, '.', fastContextTopDirectories(peekFastContextFileIndex(request.root)))
  })

  if (!request.rg) {
    if (guardReason && hints.length === 0 && definitionScopes.length === 0) return refuse(guardReason)
    return scanFastContextGrep(request, { relativePath, hints, definitionPaths, terms, singleFile: false })
  }

  let scope: FastContextGrepScope = atRoot ? 'workspace' : 'path'
  let phase: CandidatePhase | undefined
  let scopeHint: FastContextScopeHint | undefined
  let partialHinted: CandidatePhase | undefined
  if (hints.length > 0) {
    const hinted = await countCandidates(request, hints, relativePath)
    noteTimeout(request, hinted.timedOut)
    const total = [...hinted.candidates.values()].reduce((sum, count) => sum + count, 0)
    if (hinted.candidates.size >= 3 || total >= 10) {
      phase = hinted
      scope = 'hint_paths'
    } else {
      partialHinted = hinted
    }
  }
  if (!phase && definitionScopes.length > 0) {
    phase = await countCandidates(request, definitionScopes, relativePath)
    noteTimeout(request, phase.timedOut)
    for (const [path, count] of partialHinted?.candidates ?? []) {
      if (!phase.candidates.has(path)) phase.candidates.set(path, count)
    }
    scope = 'definition_scope'
    scopeHint = fastContextScopeHint('definition_scope', definitionScopes.join(', '))
  }
  if (!phase && guardReason) {
    if (!partialHinted || partialHinted.candidates.size === 0) return refuse(guardReason)
    phase = partialHinted
    scope = 'hint_paths'
    scopeHint = fastContextScopeHint(guardReason, '.', fastContextTopDirectories(peekFastContextFileIndex(request.root)))
  }
  if (!phase) {
    phase = await countCandidates(request, [relativePath], relativePath)
    noteTimeout(request, phase.timedOut)
  }
  const candidates = new Map<string, FastContextCandidate>()
  for (const [path, matchCount] of phase.candidates) {
    candidates.set(path, { path, matchCount, definition: definitionPaths.has(path), hinted: isUnderFastContextHint(path, hints) })
  }
  for (const path of definitionPaths) {
    if (!candidates.has(path)) candidates.set(path, { path, matchCount: 0, definition: true, hinted: isUnderFastContextHint(path, hints) })
  }
  const ranked = rankFastContextCandidates([...candidates.values()], terms)
  const chosen = ranked.slice(0, FAST_CONTEXT_RANKED_FILE_LIMIT).map((entry) => entry.path)
  const lines = await collectLines(request, chosen)
  noteTimeout(request, lines.timedOut)
  const timedOut = phase.timedOut || lines.timedOut
  if (timedOut) {
    scopeHint = fastContextScopeHint('timeout', relativePath, atRoot ? fastContextTopDirectories(peekFastContextFileIndex(request.root)) : [])
  } else if (phase.lineLimitReached) {
    scopeHint = fastContextScopeHint('candidate_limit', relativePath)
  }
  return {
    kind: 'matches',
    backend: 'rg',
    matches: lines.matches,
    meta: {
      scope,
      candidateFiles: candidates.size,
      candidateFilesTruncated: phase.lineLimitReached,
      definitionFiles: definitionPaths.size,
      commandOutputTruncated: phase.outputTruncated || lines.outputTruncated,
      commandTimedOut: timedOut,
      skippedLargeFiles: 0,
      scanByteLimitReached: false,
      ...(scopeHint ? { scopeHint } : {})
    }
  }
}

type CandidatePhase = Awaited<ReturnType<typeof countCandidates>>

function largeWorkspaceReason(request: FastContextGrepRequest): FastContextScopeHintReason | null {
  if ((request.run?.timedOutCommands ?? 0) >= FAST_CONTEXT_TIMEOUTS_BEFORE_SCOPE_REQUIRED) return 'repeated_timeouts'
  const index = peekFastContextFileIndex(request.root)
  return index && (index.files.length > FAST_CONTEXT_LARGE_WORKSPACE_FILE_COUNT || index.truncated)
    ? 'large_workspace'
    : null
}

/**
 * Package-level directories (first two path segments) that hold the known
 * definitions. Nested scopes collapse into their parent; more than four
 * distinct packages means the identifier is too widespread to pre-scope.
 */
export function fastContextDefinitionScopes(paths: Iterable<string>): string[] {
  const scopes = new Set<string>()
  for (const path of paths) {
    const segments = normalizeToolPath(path).split('/')
    const directory = segments.slice(0, -1).slice(0, 2).join('/')
    scopes.add(directory || segments.join('/'))
  }
  const kept: string[] = []
  for (const scope of [...scopes].sort((left, right) => left.length - right.length || left.localeCompare(right))) {
    if (!kept.some((parent) => scope === parent || scope.startsWith(`${parent}/`))) kept.push(scope)
  }
  return kept.length <= 4 ? kept : []
}

function noteTimeout(request: FastContextGrepRequest, timedOut: boolean): void {
  if (timedOut && request.run) request.run.timedOutCommands += 1
}
