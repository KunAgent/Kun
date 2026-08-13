import { describe, expect, it } from 'vitest'
import { ngrams } from './memory-scoring.js'

describe('ngrams', () => {
  it('tokenizes ASCII words into trigrams', () => {
    expect(Array.from(ngrams('fix error')).sort()).toEqual(['err', 'fix', 'ror', 'rro'])
  })

  it('lowercases and drops words shorter than 3 chars', () => {
    // "TS" (2 chars) is below the 3-char word boundary and dropped entirely.
    expect(Array.from(ngrams('Fix TS ERROR')).sort()).toEqual(['err', 'fix', 'ror', 'rro'])
  })

  it('splits a short CJK continuation into a single bigram', () => {
    const grams = ngrams('继续')
    expect(Array.from(grams).sort()).toEqual(['继续'])
    expect(grams.size).toBe(1)
  })
})
