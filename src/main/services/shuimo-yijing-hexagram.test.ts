import { describe, expect, it } from 'vitest'
import {
  calculateMeihuaHexagram,
  kingWenOrdinalFor,
  lunarInputFromDate
} from './shuimo-yijing-hexagram'

const EXPECTED_KING_WEN_BY_UPPER_LOWER = [
  [1, 10, 13, 25, 44, 6, 33, 12],
  [43, 58, 49, 17, 28, 47, 31, 45],
  [14, 38, 30, 21, 50, 64, 56, 35],
  [34, 54, 55, 51, 32, 40, 62, 16],
  [9, 61, 37, 42, 57, 59, 53, 20],
  [5, 60, 63, 3, 48, 29, 39, 8],
  [26, 41, 22, 27, 18, 4, 52, 23],
  [11, 19, 36, 24, 46, 7, 15, 2]
] as const

describe('calculateMeihuaHexagram', () => {
  it('calculates the trigrams, moving line, and King Wen ordinal', () => {
    expect(calculateMeihuaHexagram({
      yearBranch: 1,
      lunarMonth: 1,
      lunarDay: 1,
      timeBranch: 1
    })).toEqual({
      upperTrigram: 3,
      lowerTrigram: 4,
      movingLine: 4,
      ordinal: 21
    })
  })

  it('maps zero remainders to the final trigram and moving line', () => {
    expect(calculateMeihuaHexagram({
      yearBranch: 12,
      lunarMonth: 8,
      lunarDay: 4,
      timeBranch: 12
    })).toEqual({
      upperTrigram: 8,
      lowerTrigram: 4,
      movingLine: 6,
      ordinal: 24
    })
  })

  it('treats a leap-month-style negative lunar month as its absolute month', () => {
    expect(calculateMeihuaHexagram({
      yearBranch: 1,
      lunarMonth: -1,
      lunarDay: 1,
      timeBranch: 1
    })).toEqual({
      upperTrigram: 3,
      lowerTrigram: 4,
      movingLine: 4,
      ordinal: 21
    })
  })
})

describe('lunarInputFromDate', () => {
  it('adapts Lunar New Year at midnight using local civil time', () => {
    expect(lunarInputFromDate(new Date(2026, 1, 17, 0, 0, 0))).toEqual({
      yearBranch: 7,
      lunarMonth: 1,
      lunarDay: 1,
      timeBranch: 1
    })
  })

  it('keeps the civil lunar day during the late Zi hour', () => {
    expect(lunarInputFromDate(new Date(2026, 1, 17, 23, 30, 0))).toMatchObject({
      lunarDay: 1,
      timeBranch: 1
    })
  })

  it('normalizes a verified leap lunar month while preserving calendar fields', () => {
    expect(lunarInputFromDate(new Date(2025, 6, 25, 12, 0, 0))).toEqual({
      yearBranch: 6,
      lunarMonth: 6,
      lunarDay: 1,
      timeBranch: 7
    })
  })

  it('rejects an invalid date with a clear error', () => {
    expect(() => lunarInputFromDate(new Date(Number.NaN))).toThrow(/Invalid date/)
  })
})

describe('kingWenOrdinalFor', () => {
  it('matches the canonical ordinal for every upper/lower trigram pair', () => {
    for (const [upperIndex, expectedRow] of EXPECTED_KING_WEN_BY_UPPER_LOWER.entries()) {
      for (const [lowerIndex, expectedOrdinal] of expectedRow.entries()) {
        expect(kingWenOrdinalFor(upperIndex + 1, lowerIndex + 1)).toBe(expectedOrdinal)
      }
    }
  })

  it('maps every upper/lower trigram pair to a unique ordinal from 1 through 64', () => {
    const ordinals = new Set<number>()

    for (let upperTrigram = 1; upperTrigram <= 8; upperTrigram += 1) {
      for (let lowerTrigram = 1; lowerTrigram <= 8; lowerTrigram += 1) {
        ordinals.add(kingWenOrdinalFor(upperTrigram, lowerTrigram))
      }
    }

    expect([...ordinals].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 64 }, (_, index) => index + 1)
    )
  })

  it('rejects unknown trigram pairs', () => {
    expect(() => kingWenOrdinalFor(0, 0)).toThrow(/Unknown trigram pair/)
  })
})
