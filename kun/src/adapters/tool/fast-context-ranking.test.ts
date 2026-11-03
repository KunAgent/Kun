import { describe, expect, it } from 'vitest'
import {
  fastContextPatternTerms,
  fastContextQueryTerms,
  fastContextWords,
  isUnderFastContextHint,
  rankFastContextFiles,
  scoreFastContextPath
} from './fast-context-ranking.js'

describe('Fast Context ranking', () => {
  it('splits identifiers, paths, and prose into comparable words', () => {
    expect(fastContextWords('FastContextSourceSemaphore')).toEqual(['fast', 'context', 'source', 'semaphore', 'fastcontextsourcesemaphore'])
    expect(fastContextWords('kun/src/loop/fast-context-source-semaphore.ts')).toEqual(
      expect.arrayContaining(['kun', 'src', 'loop', 'fast', 'context', 'source', 'semaphore', 'ts'])
    )
    expect(fastContextWords('HTTPServer')).toEqual(['http', 'server', 'httpserver'])
  })

  it('keeps informative query terms and ignores stop words, numbers, and CJK prose', () => {
    const terms = fastContextQueryTerms(['Where is the 预算 enforced for fast_context source tools in 2026?'])
    expect(terms).toEqual(expect.arrayContaining(['enforced', 'fast', 'context', 'source', 'tools']))
    expect(terms).not.toContain('where')
    expect(terms).not.toContain('the')
    expect(terms).not.toContain('2026')
    expect(fastContextPatternTerms('\\bresolveCursorSdk\\w+', false)).toEqual(expect.arrayContaining(['resolve', 'cursor', 'sdk']))
  })

  it('ranks implementation files ahead of tests, docs, and data for the same pattern', () => {
    const terms = { pattern: fastContextPatternTerms('RuntimeEventRecorder', true), query: fastContextQueryTerms(['How are runtime events persisted?']) }
    const ranked = rankFastContextFiles([
      'docs/runtime-events.md',
      'kun/src/__tests__/runtime-event-recorder.test.ts',
      'kun/benchmarks/runtime-event-recorder.json',
      'kun/src/services/runtime-event-recorder.ts'
    ], (path) => path, terms)
    expect(ranked[0]).toBe('kun/src/services/runtime-event-recorder.ts')
    expect(ranked.at(-1)).not.toBe('kun/src/services/runtime-event-recorder.ts')
  })

  it('does not demote tests when the task is about tests', () => {
    const terms = { pattern: ['recorder'], query: fastContextQueryTerms(['Which tests cover the recorder?']) }
    expect(scoreFastContextPath('src/recorder.test.ts', terms)).toBeGreaterThan(
      scoreFastContextPath('src/recorder.test.ts', { pattern: ['recorder'], query: [] })
    )
  })

  it('boosts definitions and hinted paths, and orders ties by path', () => {
    const terms = { pattern: [], query: [] }
    const ranked = rankFastContextFiles(['b/x.ts', 'a/x.ts', 'c/x.ts', 'd/x.ts'], (path) => path, terms, (path) => ({
      definition: path === 'c/x.ts',
      hinted: path === 'd/x.ts'
    }))
    expect(ranked).toEqual(['c/x.ts', 'd/x.ts', 'a/x.ts', 'b/x.ts'])
  })

  it('matches hint paths as files or directory prefixes only', () => {
    expect(isUnderFastContextHint('src/shared/a.ts', ['src/shared'])).toBe(true)
    expect(isUnderFastContextHint('src/shared', ['src/shared'])).toBe(true)
    expect(isUnderFastContextHint('src/shared-utils/a.ts', ['src/shared'])).toBe(false)
  })
})
