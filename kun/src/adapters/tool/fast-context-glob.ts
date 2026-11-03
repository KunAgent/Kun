import { join, relative, resolve } from 'node:path'
import type { FastContextRunScope } from '../../ports/tool-host.js'
import type { SourceCommandCapture } from './builtin-tool-types.js'
import { FAST_CONTEXT_CANDIDATE_FILE_LIMIT } from './builtin-tool-types.js'
import { normalizeToolPath } from './builtin-tool-utils.js'
import {
  compileFastContextGlob,
  getFastContextFileIndex,
  matchFastContextIndex,
  walkFastContextFiles,
  type FastContextFileIndex
} from './fast-context-file-index.js'
import { withFastContextProcessSlot } from './fast-context-process-slots.js'
import { fastContextPatternTerms, isUnderFastContextHint, rankFastContextFiles } from './fast-context-ranking.js'
import {
  fastContextRipgrepWalkArgs,
  isFastContextDiscoveryExcluded,
  type EffectiveFastContextSearchBounds
} from './fast-context-search-bounds.js'

export type FastContextGlobRequest = {
  pattern: string
  root: string
  absolutePath: string
  relativePath: string
  bounds: EffectiveFastContextSearchBounds
  rg: string | null
  capture: SourceCommandCapture
  signal: AbortSignal
  run: FastContextRunScope | undefined
}

export type FastContextGlobOutcome = {
  entries: Array<{ path: string; relative_path: string }>
  backend: 'index' | 'rg' | 'scan'
  indexBackend?: FastContextFileIndex['backend']
  candidateFiles: number
  commandOutputTruncated: boolean
  commandTimedOut: boolean
}

const SCAN_WALK_LIMIT = 20_000

async function liveRipgrepGlob(request: FastContextGlobRequest): Promise<{
  files: string[]
  outputTruncated: boolean
  timedOut: boolean
}> {
  const target = request.relativePath.startsWith('..') ? request.absolutePath : (normalizeToolPath(request.relativePath) || '.')
  const result = await withFastContextProcessSlot(request.signal, () => request.capture(request.rg!, [
    '--files',
    ...fastContextRipgrepWalkArgs(request.bounds, request.root),
    '--sort', 'path',
    '-g', request.pattern,
    '--', target
  ], {
    cwd: request.root,
    signal: request.signal,
    maxOutputBytes: request.bounds.maxOutputBytes,
    timeoutMs: request.bounds.timeoutMs,
    maxLines: FAST_CONTEXT_CANDIDATE_FILE_LIMIT,
    lowPriority: true
  }))
  const files = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeToolPath(relative(request.root, resolve(request.root, line.replace(/^\.\//, ''))) || '.'))
    .filter((path) => !isFastContextDiscoveryExcluded(path, request.relativePath, request.bounds))
  if (result.timedOut && request.run) request.run.timedOutCommands += 1
  return { files, outputTruncated: result.outputTruncated, timedOut: result.timedOut }
}

/**
 * Fast Context glob. The cached workspace index answers most globs without a
 * process; a live, scoped rg listing covers what the index cannot (files added
 * since it was built, explicitly named excluded directories, or an index that
 * stopped at its ceiling). Results are ranked, not alphabetical.
 */
export async function runFastContextGlob(request: FastContextGlobRequest): Promise<FastContextGlobOutcome> {
  const index = await getFastContextFileIndex(request.root, { rg: request.rg, capture: request.capture, bounds: request.bounds })
  let files = index ? matchFastContextIndex(index, { searchRoot: request.relativePath, pattern: request.pattern }) : []
  let backend: FastContextGlobOutcome['backend'] = 'index'
  let commandOutputTruncated = index?.truncated ?? false
  let commandTimedOut = index?.timedOut ?? false
  const incomplete = !index || index.truncated || index.timedOut
  if (files.length === 0 || incomplete) {
    if (request.rg) {
      const live = await liveRipgrepGlob(request)
      if (live.files.length > 0 || files.length === 0) {
        files = live.files
        backend = 'rg'
        commandOutputTruncated = live.outputTruncated
        commandTimedOut = live.timedOut
      }
    } else if (!index || files.length === 0) {
      const matcher = compileFastContextGlob(request.pattern)
      files = (await walkFastContextFiles(request.absolutePath, request.bounds, SCAN_WALK_LIMIT))
        .filter((below) => matcher.test(below))
        .map((below) => normalizeToolPath(relative(request.root, join(request.absolutePath, below))))
      backend = 'scan'
    }
  }
  const hints = request.run?.hintPaths ?? []
  const ranked = rankFastContextFiles(files, (path) => path, {
    pattern: fastContextPatternTerms(request.pattern.replace(/[*?[\]{}!]/g, ' '), true),
    query: request.run?.queryTerms ?? []
  }, (path) => ({ hinted: isUnderFastContextHint(path, hints) }))
  return {
    entries: ranked.map((path) => ({ path: resolve(request.root, path), relative_path: path })),
    backend,
    ...(index ? { indexBackend: index.backend } : {}),
    candidateFiles: files.length,
    commandOutputTruncated,
    commandTimedOut
  }
}
