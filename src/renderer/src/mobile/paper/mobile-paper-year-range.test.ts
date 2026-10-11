import { describe, expect, it } from 'vitest'
import { mobilePaperYearRange } from './mobile-paper-year-range'

describe('mobile paper year scope', () => {
  it('accepts an open interval and a valid closed interval', () => {
    expect(mobilePaperYearRange('', '')).toEqual({ yearFrom: undefined, yearTo: undefined })
    expect(mobilePaperYearRange('2022', '2025')).toEqual({ yearFrom: 2022, yearTo: 2025 })
  })
  it('rejects inverted, non-integer and out-of-range years', () => {
    for (const [from, to] of [['2025', '2020'], ['abc', '2024'], ['1850', ''], ['', '3000'], ['2020.5', '']]) {
      expect(mobilePaperYearRange(from, to)).toBeNull()
    }
  })
})
