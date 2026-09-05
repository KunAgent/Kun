import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import type {
  FastContextSearchOptions,
  FindLocalToolOptions,
  GrepLocalToolOptions,
  GrepMatch,
  LsLocalToolOptions
} from './builtin-tool-types.js'
import {
  DEFAULT_GREP_MAX_FILE_BYTES,
  DEFAULT_GREP_MAX_CONTEXT_LINES,
  DEFAULT_GREP_MAX_TOTAL_BYTES,
  DEFAULT_LIST_LIMIT,
  FD_EXECUTABLE_CANDIDATES,
  FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES,
  FAST_CONTEXT_GREP_MAX_MATCHES,
  FAST_CONTEXT_GREP_MAX_TEXT_CHARACTERS,
  FAST_CONTEXT_GLOB_MAX_MATCHES,
  FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES,
  FAST_CONTEXT_SEARCH_TIMEOUT_MS,
  RG_EXECUTABLE_CANDIDATES
} from './builtin-tool-types.js'
import { defaultLsLocalToolOperations } from './builtin-tool-operations.js'
import {
  collectPaths,
  globToRegExp,
  isBinaryBuffer,
  listDirectoryWithOps,
  normalizeBoolean,
  normalizePositiveInteger,
  normalizeToolPath,
  resolveExecutable,
  resolveRipgrepExecutable,
  resolveWorkspacePath,
  spawnCapture,
  withToolBoundary
} from './builtin-tool-utils.js'

const MAX_SOURCE_SCAN_ENTRIES = 1_000_000
const FAST_CONTEXT_MAX_SOURCE_SCAN_ENTRIES = 10_000

type EffectiveFastContextSearchBounds = {
  maxMatches: number
  maxTextCharacters: number
  maxOutputBytes: number
  timeoutMs: number
  excludedDirectoryNames: ReadonlySet<string>
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
  const excludedDirectoryNames = new Set(
    [...FAST_CONTEXT_EXCLUDED_DIRECTORY_NAMES, ...(options?.excludedDirectoryNames ?? [])]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
  return {
    maxMatches: boundedPositive(options?.maxMatches, FAST_CONTEXT_GREP_MAX_MATCHES),
    maxTextCharacters: boundedPositive(options?.maxTextCharacters, FAST_CONTEXT_GREP_MAX_TEXT_CHARACTERS),
    maxOutputBytes: boundedPositive(options?.maxOutputBytes, FAST_CONTEXT_SEARCH_MAX_OUTPUT_BYTES),
    timeoutMs: boundedPositive(options?.timeoutMs, FAST_CONTEXT_SEARCH_TIMEOUT_MS),
    excludedDirectoryNames
  }
}

function isFastContextExcludedPath(relativePath: string, bounds: EffectiveFastContextSearchBounds): boolean {
  return normalizeToolPath(relativePath)
    .split('/')
    .some((component) => bounds.excludedDirectoryNames.has(component.toLowerCase()))
}

function fastContextRipgrepExcludes(bounds: EffectiveFastContextSearchBounds): string[] {
  return [...bounds.excludedDirectoryNames].flatMap((name) => [
    `!${name}/**`,
    `!**/${name}/**`
  ])
}

function fastContextFdExcludes(bounds: EffectiveFastContextSearchBounds): string[] {
  return [...bounds.excludedDirectoryNames].flatMap((name) => ['--exclude', name])
}

function truncateFastContextText(
  text: string,
  maximumCharacters: number
): { text: string; truncated: boolean } {
  const characters = Array.from(text)
  if (characters.length <= maximumCharacters) return { text, truncated: false }
  return { text: characters.slice(0, maximumCharacters).join(''), truncated: true }
}

function boundFastContextMatch(match: GrepMatch, bounds: EffectiveFastContextSearchBounds): GrepMatch {
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

function sourceCommandOptions(
  context: { sourceResultBudgetTokens?: number; abortSignal: AbortSignal },
  fastContext: EffectiveFastContextSearchBounds | null
): { signal: AbortSignal; maxOutputBytes: number; timeoutMs?: number } {
  return {
    signal: context.abortSignal,
    maxOutputBytes: fastContext?.maxOutputBytes ?? sourceCaptureBytes(context),
    ...(fastContext ? { timeoutMs: fastContext.timeoutMs } : {})
  }
}

function fastContextPageContext<T extends { sourceResultBudgetTokens?: number }>(
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

function resolveSearchRipgrep(
  options: { rgExecutableCandidates?: string[] },
  fastContext: EffectiveFastContextSearchBounds | null
): string | null {
  // An explicit candidate list is a host override (including [] in tests), so
  // only the default path opts into the packaged Cursor SDK binary first.
  if (options.rgExecutableCandidates !== undefined) {
    return resolveExecutable(options.rgExecutableCandidates)
  }
  return resolveRipgrepExecutable({
    candidates: RG_EXECUTABLE_CANDIDATES,
    // Fast Context falls back to its bounded in-process scan when the
    // packaged binary is unavailable. Electron PATH is not a reliable or
    // safe dependency for retrieval children.
    allowPathFallback: !fastContext
  })
}

export function createLsLocalTool(options: LsLocalToolOptions = {}): LocalTool {
  const statOp = options.operations?.stat ?? defaultLsLocalToolOperations.stat!
  const readdirOp = options.operations?.readdir ?? defaultLsLocalToolOperations.readdir!
  return LocalToolHost.defineTool({
    name: 'ls',
    description: 'List directory contents. Returns entries sorted alphabetically and marks directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { type: 'number' }
      },
      required: [],
      additionalProperties: false
    },
    policy: 'auto', sideEffect: 'read-only',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
      const limit = normalizePositiveInteger(args.limit, options.defaultLimit ?? DEFAULT_LIST_LIMIT)
      const { workspaceRoot: root, absolutePath, relativePath } = await resolveWorkspacePath(rawPath, context)
      const targetStat = await statOp(absolutePath)
      if (!targetStat.isDirectory()) {
        return {
          output: {
            error: `not a directory: ${absolutePath}`,
            path: absolutePath
          },
          isError: true
        }
      }
      const entries = await listDirectoryWithOps(absolutePath, root, false, limit, statOp, readdirOp)
      return {
        output: {
          path: absolutePath,
          relative_path: relativePath,
          entries: entries.map((entry) => ({
            ...entry,
            display_name: entry.kind === 'directory' ? `${entry.name}/` : entry.name
          })),
          names: entries.map((entry) => (entry.kind === 'directory' ? `${entry.name}/` : entry.name)),
          truncated: entries.length >= limit,
          entry_limit_reached: entries.length >= limit ? limit : null
        }
      }
    })
  })
}

export const createLsTool = createLsLocalTool
export const createLsToolDefinition = createLsLocalTool

export function createGlobLocalTool(options: FindLocalToolOptions = {}): LocalTool {
  return createFileGlobLocalTool('glob', options, true)
}

/** Legacy direct-call compatibility. The model sees `glob`, not this alias. */
export function createFindLocalTool(options: FindLocalToolOptions = {}): LocalTool {
  return createFileGlobLocalTool('find', options, false)
}

function createFileGlobLocalTool(name: 'glob' | 'find', options: FindLocalToolOptions, advertised: boolean): LocalTool {
  return LocalToolHost.defineTool({
    name,
    description: 'Find workspace files by glob pattern. Returns stable cursor pages when more matches exist.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'number', description: 'Optional maximum entries for this page.' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous result for the same pattern and path.' }
      },
      required: ['pattern'],
      additionalProperties: false
    },
    policy: 'auto', sideEffect: 'read-only',
    ...(advertised ? {} : { modelAdvertised: false }),
    execute: async (args, context) => withToolBoundary(async () => {
      const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : ''
      if (!pattern) return { output: { error: 'pattern is required' }, isError: true }
      const rawPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
      const fastContext = fastContextSearchBounds(context, options.fastContext)
      const requestedLimit = normalizePositiveInteger(args.limit, options.defaultLimit ?? defaultSourcePageLimit(context))
      const limit = fastContext ? Math.min(requestedLimit, FAST_CONTEXT_GLOB_MAX_MATCHES) : requestedLimit
      const pageContext = fastContextPageContext(context, fastContext)
      const query = fastContext
        ? `${pattern}\u0000${rawPath}\u0000fast-context`
        : `${pattern}\u0000${rawPath}`
      const cursor = parseCursor(args.cursor, query)
      if (cursor instanceof Error) return { output: { code: 'invalid_cursor', error: cursor.message }, isError: true }
      if (fastContext && cursor > 0) return { output: { code: 'fast_context_cursor_unsupported', error: 'Fast Context does not paginate glob results; run a narrower targeted search instead', fast_context: true }, isError: true }
      const { workspaceRoot: root, absolutePath, relativePath } = await resolveWorkspacePath(rawPath, context)
      const matcher = globToRegExp(pattern.includes('/') ? pattern : `**/${pattern}`)
      const targetExcluded = fastContext && isFastContextExcludedPath(relative(root, absolutePath) || '.', fastContext)
      if (options.operations?.glob) {
        const rawMatches = targetExcluded ? [] : await options.operations.glob({
          pattern,
          path: absolutePath,
          limit: sourceScanLimit(cursor, limit)
        })
        const matches = fastContext
          ? rawMatches.filter((entry) => !isFastContextExcludedPath(entry.relative_path, fastContext))
          : rawMatches
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            pattern,
            ...pageSourceEntries(matches, cursor, limit, pageContext, query),
            backend: 'custom',
            ...(fastContext ? { fast_context: true, next_cursor: null } : {})
          }
        }
      }
      // Fast Context uses only packaged rg; unconfigured fd would use PATH.
      const fd = fastContext && options.fdExecutableCandidates === undefined
        ? null
        : resolveExecutable(options.fdExecutableCandidates ?? FD_EXECUTABLE_CANDIDATES)
      const rg = resolveSearchRipgrep(options, fastContext)
      const capture = options.operations?.spawnCapture ?? spawnCapture
      let matches: Array<{ path: string; relative_path: string }>
      let commandOutputTruncated = false, commandTimedOut = false
      if (targetExcluded) {
        matches = []
      } else if (fd) {
        const args = [
          '--glob',
          '--color=never',
          '--hidden',
          '--no-require-git',
          '--max-results',
          String(Math.min(
            sourceScanLimit(cursor, limit),
            fastContext ? FAST_CONTEXT_MAX_SOURCE_SCAN_ENTRIES : MAX_SOURCE_SCAN_ENTRIES
          )),
          ...(fastContext ? fastContextFdExcludes(fastContext) : []),
          '--',
          pattern,
          absolutePath
        ]
        const result = await capture(fd, args, { cwd: root, ...sourceCommandOptions(context, fastContext) })
        commandOutputTruncated = result.outputTruncated; commandTimedOut = result.timedOut
        const candidates = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        matches = candidates
          .map((path) => ({
            path: resolve(path),
            relative_path: normalizeToolPath(relative(root, resolve(path)) || '.')
          }))
          .filter((entry) => !fastContext || !isFastContextExcludedPath(entry.relative_path, fastContext))
          .slice(0, sourceScanLimit(cursor, limit))
      } else if (rg) {
        const result = await capture(
          rg,
          [
            '--files',
            '--hidden',
            '--sort',
            'path',
            ...(fastContext ? fastContextRipgrepExcludes(fastContext).flatMap((glob) => ['-g', glob]) : []),
            '-g',
            pattern,
            absolutePath
          ],
          { cwd: root, ...sourceCommandOptions(context, fastContext) }
        )
        commandOutputTruncated = result.outputTruncated; commandTimedOut = result.timedOut
        const candidates = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        matches = candidates
          .map((path) => ({
            path: resolve(path),
            relative_path: normalizeToolPath(relative(root, resolve(path)) || '.')
          }))
          .filter((entry) => !fastContext || !isFastContextExcludedPath(entry.relative_path, fastContext))
          .slice(0, sourceScanLimit(cursor, limit))
      } else {
        const paths = await collectPaths(absolutePath, {
          includeDirectories: false,
          limit: fastContext ? FAST_CONTEXT_MAX_SOURCE_SCAN_ENTRIES : Number.MAX_SAFE_INTEGER,
          ...(fastContext
            ? {
                signal: context.abortSignal,
                shouldSkipDirectory: (path) => isFastContextExcludedPath(relative(root, path) || '.', fastContext)
              }
            : {})
        })
        matches = paths
          .map((path) => ({ path, relative_path: normalizeToolPath(relative(root, path) || '.') }))
          .filter((entry) => !fastContext || !isFastContextExcludedPath(entry.relative_path, fastContext))
          .filter((entry) => matcher.test(entry.relative_path))
          .slice(0, sourceScanLimit(cursor, limit))
      }
      return {
        output: {
          path: absolutePath,
          relative_path: relativePath,
          pattern,
          ...pageSourceEntries(matches, cursor, limit, pageContext, query),
          backend: fd ? 'fd' : rg ? 'rg' : 'scan',
          result_limit_reached: null,
          ...(fastContext ? { fast_context: true, next_cursor: null, command_output_truncated: commandOutputTruncated, command_timed_out: commandTimedOut } : {})
        }
      }
    })
  })
}

export const createFindTool = createFindLocalTool
export const createFindToolDefinition = createFindLocalTool
export const createGlobTool = createGlobLocalTool
export const createGlobToolDefinition = createGlobLocalTool

type CursorPayload = { query: string; index: number }

function parseCursor(value: unknown, query: string): number | Error {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value !== 'string') return new Error('cursor must be a string')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload
    if (parsed.query !== query || !Number.isSafeInteger(parsed.index) || parsed.index < 0) {
      return new Error('cursor does not belong to this query')
    }
    return parsed.index
  } catch {
    return new Error('cursor is invalid')
  }
}

function makeCursor(query: string, index: number): string {
  return Buffer.from(JSON.stringify({ query, index } satisfies CursorPayload), 'utf8').toString('base64url')
}

function sourceCaptureBytes(context: { sourceResultBudgetTokens?: number }): number {
  return Math.max(2 * 1024 * 1024, Math.floor((context.sourceResultBudgetTokens ?? 128_000) * 24))
}

function defaultSourcePageLimit(context: { sourceResultBudgetTokens?: number }): number {
  return Math.max(1, Math.min(
    MAX_SOURCE_SCAN_ENTRIES,
    Math.floor((context.sourceResultBudgetTokens ?? 128_000) * 1.5)
  ))
}

function sourceScanLimit(cursor: number, pageLimit: number): number {
  return Math.min(MAX_SOURCE_SCAN_ENTRIES, Math.max(pageLimit + 1, cursor + pageLimit + 1))
}

function pageSourceEntries<T>(
  unsorted: readonly T[],
  cursor: number,
  requestedLimit: number,
  context: { sourceResultBudgetTokens?: number },
  query: string
): { matches: T[]; truncated: boolean; has_more: boolean; next_cursor: string | null } {
  const entries = [...unsorted].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const byteBudget = Math.max(512, Math.floor((context.sourceResultBudgetTokens ?? 128_000) * 3))
  const matches: T[] = []
  let used = 0
  for (let index = cursor; index < entries.length && matches.length < requestedLimit; index += 1) {
    const entry = entries[index]!
    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1
    if (matches.length > 0 && used + bytes > byteBudget) break
    matches.push(entry)
    used += bytes
  }
  const nextIndex = cursor + matches.length
  const hasMore = nextIndex < entries.length
  return { matches, truncated: hasMore, has_more: hasMore, next_cursor: hasMore ? makeCursor(query, nextIndex) : null }
}

export function createGrepLocalTool(options: GrepLocalToolOptions = {}): LocalTool {
  return LocalToolHost.defineTool({
    name: 'grep',
    description: 'Search file contents for a pattern and return matching lines with paths and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
        ignoreCase: { type: 'boolean' },
        literal: { type: 'boolean' },
        context: { type: 'number' },
        limit: { type: 'number' },
        cursor: { type: 'string', description: 'Opaque cursor from a previous identical grep query.' }
      },
      required: ['pattern'],
      additionalProperties: false
    },
    policy: 'auto', sideEffect: 'read-only',
    execute: async (args, context) => withToolBoundary(async () => {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      if (!pattern.trim()) return { output: { error: 'pattern is required' }, isError: true }
      const fastContext = fastContextSearchBounds(context, options.fastContext)
      const literal = normalizeBoolean(args.literal)
      const ignoreCase = normalizeBoolean(args.ignoreCase)
      const requestedContextLines = typeof args.context === 'number' && Number.isFinite(args.context) && args.context > 0
        ? Math.min(DEFAULT_GREP_MAX_CONTEXT_LINES, Math.floor(args.context))
        : 0
      // Fast Context uses read for surrounding code; grep evidence is one
      // bounded matching line rather than 20 neighbouring lines per match.
      const contextLines = fastContext ? 0 : requestedContextLines
      const glob = typeof args.glob === 'string' && args.glob.trim() ? args.glob.trim() : null
      const requestedLimit = normalizePositiveInteger(args.limit, options.defaultLimit ?? defaultSourcePageLimit(context))
      const limit = fastContext ? Math.min(requestedLimit, fastContext.maxMatches) : requestedLimit
      const pageContext = fastContextPageContext(context, fastContext)
      const maxFileBytes = fastContext
        ? Math.min(options.maxFileBytes ?? DEFAULT_GREP_MAX_FILE_BYTES, DEFAULT_GREP_MAX_FILE_BYTES)
        : options.maxFileBytes
      const maxTotalBytes = fastContext
        ? Math.min(options.maxTotalBytes ?? DEFAULT_GREP_MAX_TOTAL_BYTES, DEFAULT_GREP_MAX_TOTAL_BYTES)
        : options.maxTotalBytes
      const rawPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
      const query = JSON.stringify({
        pattern,
        rawPath,
        glob,
        ignoreCase,
        literal,
        context: contextLines,
        ...(fastContext ? { fastContext: true } : {})
      })
      const cursor = parseCursor(args.cursor, query)
      if (cursor instanceof Error) return { output: { code: 'invalid_cursor', error: cursor.message }, isError: true }
      if (fastContext && cursor > 0) return { output: { code: 'fast_context_cursor_unsupported', error: 'Fast Context does not paginate grep results; run a narrower targeted search instead', fast_context: true }, isError: true }
      const scanLimit = fastContext ? fastContext.maxMatches + 1 : sourceScanLimit(cursor, limit)
      const flags = ignoreCase ? 'i' : ''
      const effectiveMatcher = literal
        ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
        : new RegExp(pattern, flags)
      const globMatcher = glob ? globToRegExp(glob.includes('/') ? glob : `**/${glob}`) : null
      const { workspaceRoot: root, absolutePath, relativePath } = await resolveWorkspacePath(rawPath, context)
      const targetExcluded = fastContext && isFastContextExcludedPath(relative(root, absolutePath) || '.', fastContext)
      if (options.operations?.search) {
        const rawMatches = targetExcluded ? [] : await options.operations.search({
          pattern,
          path: absolutePath,
          glob,
          ignoreCase,
          literal,
          context: contextLines,
          limit: scanLimit
        })
        const matches = (fastContext
          ? rawMatches
            .filter((entry) => !isFastContextExcludedPath(entry.relative_path, fastContext))
            .slice(0, scanLimit)
            .map((entry) => boundFastContextMatch(entry, fastContext))
          : rawMatches)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            pattern,
            glob,
            ignore_case: ignoreCase,
            literal,
            context: contextLines,
            backend: 'custom',
            ...pageSourceEntries(matches, cursor, limit, pageContext, query),
            match_limit_reached: fastContext && matches.length > fastContext.maxMatches ? fastContext.maxMatches : null,
            ...(fastContext ? { fast_context: true, next_cursor: null } : {})
          }
        }
      }
      const matches: GrepMatch[] = []
      const linesByPath = new Map<string, string[] | null>()
      let scannedBytes = 0
      let skippedLargeFiles = 0
      let scanByteLimitReached = false
      let commandOutputTruncated = false
      let commandTimedOut = false
      const loadTextLines = async (candidatePath: string): Promise<string[] | null> => {
        if (linesByPath.has(candidatePath)) return linesByPath.get(candidatePath) ?? null
        try {
          const fileStat = await stat(candidatePath)
          const fileBytes = Math.max(0, fileStat.size)
          if (!fileStat.isFile() ||
            (maxFileBytes !== undefined && fileBytes > maxFileBytes) ||
            (maxTotalBytes !== undefined && scannedBytes + fileBytes > maxTotalBytes)) {
            if (fileStat.isFile() && maxFileBytes !== undefined && fileBytes > maxFileBytes) skippedLargeFiles += 1
            if (fileStat.isFile() && maxTotalBytes !== undefined && scannedBytes + fileBytes > maxTotalBytes) scanByteLimitReached = true
            linesByPath.set(candidatePath, null)
            return null
          }
          const buffer = await readFile(candidatePath)
          // Re-check after opening in case the file changed after stat().
          if ((maxFileBytes !== undefined && buffer.length > maxFileBytes) ||
            (maxTotalBytes !== undefined && scannedBytes + buffer.length > maxTotalBytes)) {
            if (maxFileBytes !== undefined && buffer.length > maxFileBytes) skippedLargeFiles += 1
            if (maxTotalBytes !== undefined && scannedBytes + buffer.length > maxTotalBytes) scanByteLimitReached = true
            linesByPath.set(candidatePath, null)
            return null
          }
          scannedBytes += buffer.length
          if (isBinaryBuffer(buffer)) {
            linesByPath.set(candidatePath, null)
            return null
          }
          const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').split('\n')
          linesByPath.set(candidatePath, lines)
          return lines
        } catch {
          // Files can legitimately disappear while rg/scan is walking a live
          // workspace. Treat that one path as unavailable rather than failing
          // the entire bounded search.
          linesByPath.set(candidatePath, null)
          return null
        }
      }
      const rg = resolveSearchRipgrep(options, fastContext)
      if (rg && !targetExcluded) {
        const rgArgs = ['--hidden', '--line-number', '--with-filename', '--color', 'never', '--sort', 'path']
        if (ignoreCase) rgArgs.push('--ignore-case')
        if (literal) rgArgs.push('--fixed-strings')
        if (fastContext) {
          rgArgs.push('--max-count', String(scanLimit))
          rgArgs.push('--max-columns', String(fastContext.maxTextCharacters))
          for (const excludedGlob of fastContextRipgrepExcludes(fastContext)) {
            rgArgs.push('-g', excludedGlob)
          }
        }
        if (glob) rgArgs.push('-g', glob)
        rgArgs.push(pattern, absolutePath)
        const result = await spawnCapture(rg, rgArgs, {
          cwd: root,
          ...sourceCommandOptions(context, fastContext)
        })
        commandOutputTruncated = result.outputTruncated
        commandTimedOut = result.timedOut
        const rows = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        for (const row of rows) {
          if (matches.length >= scanLimit) break
          const parsed = row.match(/^(.*?):(\d+):(.*)$/)
          if (!parsed) continue
          const candidatePath = resolve(parsed[1] ?? '')
          const lineNumber = Number(parsed[2] ?? '0')
          const lineText = parsed[3] ?? ''
          const candidateRelative = normalizeToolPath(relative(root, candidatePath) || '.')
          if (fastContext && isFastContextExcludedPath(candidateRelative, fastContext)) continue
          if (globMatcher && !globMatcher.test(candidateRelative)) continue
          const columnMatch = effectiveMatcher.exec(lineText)
          const lines = contextLines > 0 ? await loadTextLines(candidatePath) : null
          if (contextLines > 0 && !lines) continue
          const match: GrepMatch = {
            path: candidatePath,
            relative_path: candidateRelative,
            line: lineNumber,
            column: (columnMatch?.index ?? 0) + 1,
            text: lineText,
            ...(contextLines > 0
              ? {
                  context_before: lines!.slice(Math.max(0, lineNumber - 1 - contextLines), lineNumber - 1),
                  context_after: lines!.slice(lineNumber, lineNumber + contextLines)
                }
              : {})
          }
          matches.push(fastContext ? boundFastContextMatch(match, fastContext) : match)
        }
      } else {
        const candidates = targetExcluded ? [] : await collectPaths(absolutePath, {
          includeDirectories: false,
          limit: fastContext ? FAST_CONTEXT_MAX_SOURCE_SCAN_ENTRIES : Number.MAX_SAFE_INTEGER,
          ...(fastContext
            ? {
                signal: context.abortSignal,
                shouldSkipDirectory: (path) => isFastContextExcludedPath(relative(root, path) || '.', fastContext)
              }
            : {})
        })
        for (const candidatePath of candidates) {
          if (matches.length >= scanLimit) break
          const candidateRelative = normalizeToolPath(relative(root, candidatePath) || '.')
          if (fastContext && isFastContextExcludedPath(candidateRelative, fastContext)) continue
          if (globMatcher && !globMatcher.test(candidateRelative)) continue
          const lines = await loadTextLines(candidatePath)
          if (!lines) continue
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            const result = effectiveMatcher.exec(line)
            if (!result) continue
            const match: GrepMatch = {
              path: candidatePath,
              relative_path: candidateRelative,
              line: index + 1,
              column: (result.index ?? 0) + 1,
              text: line,
              ...(contextLines > 0
                ? {
                    context_before: lines.slice(Math.max(0, index - contextLines), index),
                    context_after: lines.slice(index + 1, index + 1 + contextLines)
                  }
                : {})
            }
            matches.push(fastContext ? boundFastContextMatch(match, fastContext) : match)
            if (matches.length >= scanLimit) break
          }
        }
      }
      return {
        output: {
          path: absolutePath,
          relative_path: relativePath,
          pattern,
          glob,
          ignore_case: ignoreCase,
          literal,
          context: contextLines,
          backend: rg ? 'rg' : 'scan',
          ...pageSourceEntries(matches, cursor, limit, pageContext, query),
          match_limit_reached: fastContext && matches.length > fastContext.maxMatches ? fastContext.maxMatches : null,
          skipped_large_files: skippedLargeFiles,
          scan_byte_limit_reached: scanByteLimitReached,
          command_output_truncated: commandOutputTruncated,
          ...(fastContext
            ? {
              fast_context: true, next_cursor: null,
                command_timed_out: commandTimedOut
              }
            : {})
        }
      }
    })
  })
}

export const createGrepTool = createGrepLocalTool
export const createGrepToolDefinition = createGrepLocalTool
