import { describe, expect, it } from 'vitest'
import { windTileAlpha } from './glyph-wind-mask'

describe('glyph wind tile', () => {
  it('covers only part of the tile with soft gusts', () => {
    let covered = 0
    let total = 0
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const alpha = windTileAlpha(x / 64, y / 64)
        expect(alpha).toBeGreaterThanOrEqual(0)
        expect(alpha).toBeLessThanOrEqual(1)
        total += 1
        if (alpha > 0.05) covered += 1
      }
    }
    expect(covered / total).toBeGreaterThan(0.08)
    expect(covered / total).toBeLessThan(0.45)
  })

  it('repeats seamlessly across tile edges', () => {
    for (let step = 0; step < 16; step += 1) {
      const t = step / 16
      expect(windTileAlpha(0, t)).toBeCloseTo(windTileAlpha(1, t), 6)
      expect(windTileAlpha(t, 0)).toBeCloseTo(windTileAlpha(t, 1), 6)
    }
  })
})
