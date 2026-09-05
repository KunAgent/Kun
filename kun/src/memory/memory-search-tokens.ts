import type { MemoryRecord } from '../contracts/memory.js'

export const MEMORY_MAX_RECORD_SEARCH_TOKENS = 512
export const MEMORY_MAX_QUERY_SEARCH_TOKENS = 128

export type MemorySearchTokenResult = {
  tokens: string[]
  truncated: boolean
}

export function memorySearchTokens(
  input: string,
  maxTokens = MEMORY_MAX_RECORD_SEARCH_TOKENS
): MemorySearchTokenResult {
  const limit = Math.max(0, Math.floor(maxTokens))
  const tokens: string[] = []
  const seen = new Set<string>()
  let truncated = false
  const add = (token: string): boolean => {
    if (!token || seen.has(token)) return true
    if (tokens.length >= limit) {
      truncated = true
      return false
    }
    seen.add(token)
    tokens.push(token)
    return true
  }
  const normalized = input.normalize('NFKC').toLocaleLowerCase('en-US')
  const cjkRuns = normalized.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu) ?? []
  const latinSource = normalized.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu, ' ')
  const words = latinSource.match(/[\p{L}\p{N}_]+/gu) ?? []
  outer: for (const word of words) {
    if (!add(`w${word}`)) break
    if (word.length <= 3) continue
    for (let index = 0; index + 3 <= word.length; index += 1) {
      if (!add(`g${word.slice(index, index + 3)}`)) break outer
    }
  }
  outer: for (const run of cjkRuns) {
    if (run.length === 1) {
      if (!add(`c${run}`)) break
      continue
    }
    for (let index = 0; index + 2 <= run.length; index += 1) {
      if (!add(`c${run.slice(index, index + 2)}`)) break outer
    }
  }
  return { tokens, truncated }
}

export function memoryRecordSearchTokens(record: MemoryRecord): MemorySearchTokenResult {
  const sourceLabels = record.sources.map((source) => `${source.kind} ${source.locator ?? ''}`)
  return memorySearchTokens([
    record.content,
    record.tags.join(' '),
    record.type,
    ...sourceLabels
  ].join('\n'))
}

/** Produces FTS syntax only from generated tokens, never from raw user text. */
export function ftsQueryFromTokens(tokens: readonly string[]): string {
  return tokens
    .filter((token) => /^[\p{L}\p{N}_]+$/u.test(token))
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ')
}

export function lexicalTokenCoverage(queryTokens: readonly string[], recordTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 0
  const recordSet = new Set(recordTokens)
  let overlap = 0
  for (const token of queryTokens) if (recordSet.has(token)) overlap += 1
  return clamp01(overlap / queryTokens.length)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
