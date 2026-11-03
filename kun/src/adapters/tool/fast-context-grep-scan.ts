import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { GrepMatch } from './builtin-tool-types.js'
import { FAST_CONTEXT_RANKED_FILE_LIMIT } from './builtin-tool-types.js'
import { isBinaryBuffer, normalizeToolPath } from './builtin-tool-utils.js'
import {
  compileFastContextGlob,
  getFastContextFileIndex,
  matchFastContextIndex,
  walkFastContextFiles
} from './fast-context-file-index.js'
import type { FastContextGrepOutcome, FastContextGrepRequest } from './fast-context-grep.js'
import { isUnderFastContextHint, rankFastContextFiles, type FastContextRankingTerms } from './fast-context-ranking.js'
import { boundFastContextMatch } from './fast-context-search-bounds.js'

const SCAN_WALK_LIMIT = 20_000

/**
 * In-process grep for hosts without the packaged rg. Candidates come from the
 * workspace file index (git-aware, so .gitignore is honoured) and are read in
 * relevance order, so the byte budget is spent on likely files first instead
 * of the alphabetically first ten thousand paths.
 */
export async function scanFastContextGrep(
  request: FastContextGrepRequest,
  input: {
    relativePath: string
    hints: readonly string[]
    definitionPaths: ReadonlySet<string>
    terms: FastContextRankingTerms
    singleFile: boolean
  }
): Promise<FastContextGrepOutcome> {
  const atRoot = input.relativePath === '.' || input.relativePath === ''
  let candidates: string[]
  if (input.singleFile) {
    candidates = [input.relativePath]
  } else {
    const index = await getFastContextFileIndex(request.root, { rg: null, capture: request.capture, bounds: request.bounds })
    candidates = index ? matchFastContextIndex(index, { searchRoot: input.relativePath, pattern: request.glob }) : []
    if (candidates.length === 0 && (!atRoot || !index)) {
      // No index (an unindexable root), or a target outside it (outside the
      // workspace, or an explicitly named discovery-only excluded directory).
      const glob = request.glob ? compileFastContextGlob(request.glob) : null
      candidates = (await walkFastContextFiles(request.absolutePath, request.bounds, SCAN_WALK_LIMIT))
        .filter((below) => !glob || glob.test(below))
        .map((below) => normalizeToolPath(relative(request.root, join(request.absolutePath, below))))
    }
  }
  const ranked = rankFastContextFiles(candidates, (path) => path, input.terms, (path) => ({
    definition: input.definitionPaths.has(path),
    hinted: isUnderFastContextHint(path, input.hints)
  }))
  const perFile: GrepMatch[][] = []
  let scannedBytes = 0
  let skippedLargeFiles = 0
  let scanByteLimitReached = false
  for (const path of ranked) {
    if (perFile.length >= FAST_CONTEXT_RANKED_FILE_LIMIT || scanByteLimitReached) break
    if (request.signal.aborted) throw new Error('command aborted')
    const absolutePath = resolve(request.root, path)
    const fileStat = await stat(absolutePath).catch(() => null)
    if (!fileStat?.isFile()) continue
    if (fileStat.size > request.maxFileBytes) {
      skippedLargeFiles += 1
      continue
    }
    if (scannedBytes + fileStat.size > request.maxTotalBytes) {
      scanByteLimitReached = true
      break
    }
    const buffer = await readFile(absolutePath).catch(() => null)
    if (!buffer) continue
    scannedBytes += buffer.length
    if (isBinaryBuffer(buffer)) continue
    const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').split('\n')
    const found: GrepMatch[] = []
    for (let index = 0; index < lines.length && found.length < request.scanLimit; index += 1) {
      const line = lines[index] ?? ''
      request.matcher.lastIndex = 0
      const result = request.matcher.exec(line)
      if (!result) continue
      found.push(boundFastContextMatch({
        path: absolutePath,
        relative_path: path,
        line: index + 1,
        column: result.index + 1,
        text: line
      }, request.bounds))
    }
    if (found.length) perFile.push(found)
  }
  const cap = perFile.length ? Math.max(5, Math.ceil(request.scanLimit / perFile.length)) : 0
  const matches: GrepMatch[] = []
  for (const found of perFile) {
    for (const match of found.slice(0, cap)) {
      if (matches.length >= request.scanLimit) break
      matches.push(match)
    }
  }
  return {
    kind: 'matches',
    backend: 'scan',
    matches,
    meta: {
      scope: input.singleFile || !atRoot ? 'path' : 'workspace',
      candidateFiles: candidates.length,
      candidateFilesTruncated: false,
      definitionFiles: input.definitionPaths.size,
      commandOutputTruncated: false,
      commandTimedOut: false,
      skippedLargeFiles,
      scanByteLimitReached
    }
  }
}
