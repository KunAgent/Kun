import { normalizeToolPath } from './builtin-tool-utils.js'

/**
 * Relevance ranking for Fast Context candidate files. Plain path order puts
 * `__tests__/`, `benchmarks/`, `docs/`, and `e2e/` ahead of `src/` in most
 * repositories, so a 30-match page often missed the implementation file. The
 * score below favours files whose path shares words with the search pattern
 * and the task text, files that define the searched symbol, and files under
 * paths the parent already pointed at; it demotes tests, docs, and data files
 * unless the task is about them.
 */

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'any', 'are', 'before', 'but', 'can', 'code', 'does',
  'each', 'file', 'files', 'find', 'for', 'from', 'get', 'has', 'have', 'how', 'into', 'its',
  'just', 'line', 'lines', 'look', 'make', 'more', 'not', 'only', 'other', 'out', 'over', 'path',
  'repo', 'repository', 'return', 'same', 'should', 'show', 'some', 'such', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'this', 'those', 'through', 'use', 'used', 'uses',
  'using', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'within',
  'without', 'you', 'your', 'inspect', 'explain', 'trace', 'locate', 'evidence', 'implementation',
  'exact', 'relevant', 'cite', 'summarize', 'task'
])

const TEST_SEGMENTS = new Set([
  '__tests__', '__mocks__', '__snapshots__', '__fixtures__', 'test', 'tests', 'spec', 'specs',
  'fixture', 'fixtures', 'e2e', 'bench', 'benchmark', 'benchmarks', 'example', 'examples', 'demo',
  'demos', 'stories', 'storybook', 'mocks', 'testdata', 'testing', 'smoke'
])
const DOC_SEGMENTS = new Set(['doc', 'docs', 'documentation', 'changelog', 'changelogs', 'release', 'releases'])
const DATA_EXTENSIONS = new Set(['json', 'lock', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'txt', 'snap', 'svg', 'xml', 'log'])
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'rst', 'adoc'])
const TEST_TERMS = new Set(['test', 'tests', 'spec', 'specs', 'vitest', 'jest', 'fixture', 'fixtures', 'e2e', 'bench', 'benchmark'])
const DOC_TERMS = new Set(['doc', 'docs', 'readme', 'documentation', 'changelog', 'markdown', 'guide'])
const DATA_TERMS = new Set(['json', 'yaml', 'yml', 'toml', 'config', 'configuration', 'lock', 'manifest', 'package', 'settings'])

const MAX_TERMS = 48

/** Splits identifiers and prose into lowercase words (camelCase, snake, kebab, paths). */
export function fastContextWords(text: string): string[] {
  const words: string[] = []
  for (const chunk of text.split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue
    const parts = chunk
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ')
    for (const part of parts) {
      const lowered = part.toLowerCase()
      if (lowered) words.push(lowered)
    }
    // Keep the compound too, so `FastContext` also matches `fastcontext.ts`.
    if (parts.length > 1) words.push(chunk.toLowerCase())
  }
  return words
}

/** Search terms from task titles and queries (deduplicated, bounded). */
export function fastContextQueryTerms(texts: readonly string[]): string[] {
  const terms = new Set<string>()
  for (const text of texts) {
    for (const word of fastContextWords(text)) {
      if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue
      terms.add(word)
      if (terms.size >= MAX_TERMS) return [...terms]
    }
  }
  return [...terms]
}

/** Identifier words in a grep pattern, ignoring regex escapes and operators. */
export function fastContextPatternTerms(pattern: string, literal: boolean): string[] {
  const source = literal ? pattern : pattern.replace(/\\[a-zA-Z]/g, ' ')
  return fastContextQueryTerms([source])
}

export type FastContextRankingTerms = {
  pattern: readonly string[]
  query: readonly string[]
}

export type FastContextFileSignals = {
  /** Matching lines reported by the candidate scan. */
  matchCount?: number
  /** The symbol index lists a definition of the searched identifier here. */
  definition?: boolean
  /** The file is under a path the parent marked as relevant. */
  hinted?: boolean
}

function pathWordSet(relativePath: string): Set<string> {
  return new Set(fastContextWords(normalizeToolPath(relativePath)))
}

function extensionOf(relativePath: string): string {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function isTestPath(segments: readonly string[], base: string): boolean {
  if (segments.some((segment) => TEST_SEGMENTS.has(segment.toLowerCase()))) return true
  return /(?:^|[._-])(?:test|tests|spec|specs|bench|stories|story)(?:[._-]|$)/i.test(base) || /^test_/i.test(base)
}

function mentions(terms: FastContextRankingTerms, vocabulary: ReadonlySet<string>): boolean {
  return terms.query.some((term) => vocabulary.has(term)) || terms.pattern.some((term) => vocabulary.has(term))
}

/** Higher is more relevant. Deterministic and cheap: no file I/O. */
export function scoreFastContextPath(
  relativePath: string,
  terms: FastContextRankingTerms,
  signals: FastContextFileSignals = {}
): number {
  const normalized = normalizeToolPath(relativePath)
  const segments = normalized.split('/')
  const base = segments[segments.length - 1] ?? normalized
  const words = pathWordSet(normalized)
  const baseWords = new Set(fastContextWords(base))
  let score = 0
  for (const term of terms.pattern) {
    if (baseWords.has(term)) score += 4
    else if (words.has(term)) score += 2
  }
  let queryHits = 0
  for (const term of terms.query) {
    if (queryHits >= 4) break
    if (words.has(term)) {
      score += baseWords.has(term) ? 1.5 : 1
      queryHits += 1
    }
  }
  if (signals.matchCount && signals.matchCount > 0) score += Math.log2(1 + Math.min(signals.matchCount, 50)) * 0.8
  if (signals.definition) score += 6
  if (signals.hinted) score += 4
  if (isTestPath(segments.slice(0, -1), base) && !mentions(terms, TEST_TERMS)) score -= 4
  if (segments.slice(0, -1).some((segment) => DOC_SEGMENTS.has(segment.toLowerCase())) && !mentions(terms, DOC_TERMS)) score -= 2.5
  const extension = extensionOf(normalized)
  if (DOC_EXTENSIONS.has(extension) && !mentions(terms, DOC_TERMS)) score -= 1.5
  if (DATA_EXTENSIONS.has(extension) && !mentions(terms, DATA_TERMS)) score -= 1.5
  if (/\.d\.ts$/i.test(base) || /(?:^|\/)(?:generated|gen|__generated__)\//i.test(normalized)) score -= 1
  score -= 0.15 * Math.max(0, segments.length - 1)
  return score
}

/** True when `relativePath` is a hint path or lies beneath one. */
export function isUnderFastContextHint(relativePath: string, hintPaths: readonly string[]): boolean {
  const normalized = normalizeToolPath(relativePath)
  return hintPaths.some((hint) => {
    const prefix = normalizeToolPath(hint)
    return prefix === '.' || normalized === prefix || normalized.startsWith(`${prefix}/`)
  })
}

/** Stable relevance order: score descending, then path ascending. */
export function rankFastContextFiles<T>(
  entries: readonly T[],
  pathOf: (entry: T) => string,
  terms: FastContextRankingTerms,
  signalsOf: (entry: T) => FastContextFileSignals = () => ({})
): T[] {
  return entries
    .map((entry) => ({ entry, path: normalizeToolPath(pathOf(entry)), score: scoreFastContextPath(pathOf(entry), terms, signalsOf(entry)) }))
    .sort((left, right) => right.score - left.score || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map(({ entry }) => entry)
}
