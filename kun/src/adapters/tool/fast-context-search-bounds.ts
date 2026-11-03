import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastContextSearchOptions, GrepMatch } from './builtin-tool-types.js'
import {
  FAST_CONTEXT_DISCOVERY_EXCLUDED_DIRECTORY_NAMES,
  FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES,
  FAST_CONTEXT_EXCLUDED_FILE_GLOBS,
  FAST_CONTEXT_GREP_MAX_MATCHES,
  FAST_CONTEXT_GREP_MAX_TEXT_CHARACTERS,
  FAST_CONTEXT_IGNORE_FILE_NAME,
  FAST_CONTEXT_MAX_SCAN_FILE_SIZE,
  FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES,
  FAST_CONTEXT_SEARCH_TIMEOUT_MS
} from './builtin-tool-types.js'
import { normalizePositiveInteger, normalizeToolPath } from './builtin-tool-utils.js'

export type EffectiveFastContextSearchBounds = {
  maxMatches: number
  maxTextCharacters: number
  maxOutputBytes: number
  timeoutMs: number
  /** Never searched or read, even when targeted explicitly. */
  excludedDirectoryNames: ReadonlySet<string>
  /** Pruned only while walking recursively from a parent directory. */
  discoveryExcludedDirectoryNames: ReadonlySet<string>
  /** Original-case names for rg globs, which match case-sensitively. */
  walkExcludedDirectoryNames: readonly string[]
}

type FastContextToolContext = { fastContext?: boolean }

/**
 * Applies only when the child runtime marks this individual dispatch as Fast
 * Context. Construction options can tighten the values but never relax the
 * published ceilings.
 */
export function fastContextSearchBounds(
  context: object,
  options: FastContextSearchOptions | undefined = undefined
): EffectiveFastContextSearchBounds | null {
  if ((context as FastContextToolContext).fastContext !== true) return null
  const boundedPositive = (value: unknown, ceiling: number) =>
    Math.min(ceiling, normalizePositiveInteger(value, ceiling))
  const lowered = (values: readonly string[]) => new Set(
    values.map((value) => value.trim().toLowerCase()).filter(Boolean)
  )
  const extraNames = (options?.excludedDirectoryNames ?? []).map((value) => value.trim()).filter(Boolean)
  return {
    maxMatches: boundedPositive(options?.maxMatches, FAST_CONTEXT_GREP_MAX_MATCHES),
    maxTextCharacters: boundedPositive(options?.maxTextCharacters, FAST_CONTEXT_GREP_MAX_TEXT_CHARACTERS),
    maxOutputBytes: boundedPositive(options?.maxOutputBytes, FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES),
    timeoutMs: boundedPositive(options?.timeoutMs, FAST_CONTEXT_SEARCH_TIMEOUT_MS),
    excludedDirectoryNames: lowered([...FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES, ...(options?.excludedDirectoryNames ?? [])]),
    discoveryExcludedDirectoryNames: lowered(FAST_CONTEXT_DISCOVERY_EXCLUDED_DIRECTORY_NAMES),
    walkExcludedDirectoryNames: [...new Set([
      ...FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES,
      ...FAST_CONTEXT_DISCOVERY_EXCLUDED_DIRECTORY_NAMES,
      ...extraNames
    ])]
  }
}

/** Hard exclusion check on a workspace-relative path (dependency, build, VCS). */
export function isFastContextExcludedPath(relativePath: string, bounds: EffectiveFastContextSearchBounds): boolean {
  return normalizeToolPath(relativePath)
    .split('/')
    .some((component) => bounds.excludedDirectoryNames.has(component.toLowerCase()))
}

/**
 * Discovery check on a path relative to the directory being searched. Hard
 * names always apply; discovery-only names apply below the search root, so an
 * explicit `.vscode` or `.claude/skills` root still yields its own files.
 */
export function isFastContextDiscoveryExcluded(
  workspaceRelativePath: string,
  searchRootRelativePath: string,
  bounds: EffectiveFastContextSearchBounds
): boolean {
  if (isFastContextExcludedPath(workspaceRelativePath, bounds)) return true
  const normalized = normalizeToolPath(workspaceRelativePath)
  const root = normalizeToolPath(searchRootRelativePath)
  const below = root === '.' || root === ''
    ? normalized
    : normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
  const components = below.split('/')
  // The final component is the file itself; only its parent directories prune.
  return components
    .slice(0, -1)
    .some((component) => bounds.discoveryExcludedDirectoryNames.has(component.toLowerCase()))
}

/**
 * Shared rg flags for every recursive Fast Context walk: prune excluded
 * directories instead of matching every file inside them, skip binary/media
 * bundles and oversized files by name or size before they are opened, and
 * honour an optional workspace `.kunignore` (rg also honours `.ignore`).
 */
export function fastContextRipgrepWalkArgs(bounds: EffectiveFastContextSearchBounds, workspaceRoot: string): string[] {
  const directoryGlobs = bounds.walkExcludedDirectoryNames.flatMap((name) => ['-g', `!${name}/`])
  const fileGlobs = FAST_CONTEXT_EXCLUDED_FILE_GLOBS.flatMap((glob) => ['-g', glob])
  const ignoreFile = join(workspaceRoot, FAST_CONTEXT_IGNORE_FILE_NAME)
  return [
    '--no-config',
    '--hidden',
    '--max-filesize',
    FAST_CONTEXT_MAX_SCAN_FILE_SIZE,
    ...directoryGlobs,
    ...fileGlobs,
    ...(existsSync(ignoreFile) ? ['--ignore-file', ignoreFile] : [])
  ]
}

/** fd equivalents for hosts that configure an explicit fd executable. */
export function fastContextFdExcludes(bounds: EffectiveFastContextSearchBounds): string[] {
  return bounds.walkExcludedDirectoryNames.flatMap((name) => ['--exclude', name])
}

function truncateFastContextText(
  text: string,
  maximumCharacters: number
): { text: string; truncated: boolean } {
  const characters = Array.from(text)
  if (characters.length <= maximumCharacters) return { text, truncated: false }
  return { text: characters.slice(0, maximumCharacters).join(''), truncated: true }
}

export function boundFastContextMatch(match: GrepMatch, bounds: EffectiveFastContextSearchBounds): GrepMatch {
  const text = truncateFastContextText(match.text, bounds.maxTextCharacters)
  const contextBefore = match.context_before?.map((line) =>
    truncateFastContextText(line, bounds.maxTextCharacters).text
  )
  const contextAfter = match.context_after?.map((line) =>
    truncateFastContextText(line, bounds.maxTextCharacters).text
  )
  return {
    ...match,
    text: text.text,
    ...(text.truncated ? { text_truncated: true } : {}),
    ...(contextBefore ? { context_before: contextBefore } : {}),
    ...(contextAfter ? { context_after: contextAfter } : {})
  }
}

export function fastContextPageContext<T extends { sourceResultBudgetTokens?: number }>(
  context: T,
  fastContext: EffectiveFastContextSearchBounds | null
): T {
  if (!fastContext) return context
  // Leave room for result metadata around the paged entries themselves.
  const outputBudgetTokens = Math.max(1, Math.floor((fastContext.maxOutputBytes - 4_096) / 3))
  return {
    ...context,
    sourceResultBudgetTokens: Math.min(context.sourceResultBudgetTokens ?? outputBudgetTokens, outputBudgetTokens)
  }
}

export type FastContextScopeHintReason =
  | 'definition_scope'
  | 'timeout'
  | 'candidate_limit'
  | 'large_workspace'
  | 'repeated_timeouts'

export type FastContextScopeHint = {
  reason: FastContextScopeHintReason
  searched: string
  suggestion: string
  directories?: string[]
}

const SCOPE_SUGGESTIONS: Record<FastContextScopeHintReason, string> = {
  definition_scope: 'Searched only the directories that define this identifier. Pass path "." or another directory to search elsewhere, for example for call sites.',
  timeout: 'The search hit its time limit before covering the tree. Retry with a narrower path or a file glob such as "*.ts".',
  candidate_limit: 'Too many files matched to rank them all. Add a path or a glob, or use a more specific pattern.',
  large_workspace: 'This workspace is too large for an unscoped root search. Pass a path (see directories) or a glob.',
  repeated_timeouts: 'Earlier searches in this run timed out. Unscoped root searches are disabled; pass a path or a glob.'
}

/** Structured, model-actionable advice attached when a search was cut short. */
export function fastContextScopeHint(
  reason: FastContextScopeHintReason,
  searched: string,
  directories: readonly string[] = []
): FastContextScopeHint {
  return {
    reason,
    searched: normalizeToolPath(searched) || '.',
    suggestion: SCOPE_SUGGESTIONS[reason],
    ...(directories.length ? { directories: directories.slice(0, 12) } : {})
  }
}
