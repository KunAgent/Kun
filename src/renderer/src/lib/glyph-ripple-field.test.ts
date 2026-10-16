import { describe, expect, it } from 'vitest'
import { crestStrength, litStrength, patchLevel, rippleLifetimeMs } from './glyph-ripple-field'

const ripple = { id: 1, x: 0, y: 0, startedAt: 0, reach: 600 }
const frontRadius = (age: number): number => 600 * (1 - Math.pow(1 - age / 1700, 3))

describe('glyph ripple wave', () => {
  it('peaks the crest on the expanding front and fades it out by the end of travel', () => {
    expect(crestStrength(ripple, frontRadius(300), 300)).toBeGreaterThan(0.5)
    expect(crestStrength(ripple, 590, 300)).toBe(0)
    expect(crestStrength(ripple, 300, 1700)).toBe(0)
    expect(crestStrength(ripple, 10, -5)).toBe(0)
  })

  it('lights the field only behind the front, then dissolves back to nothing', () => {
    expect(litStrength(ripple, frontRadius(400) + 20, 400)).toBe(0)
    expect(litStrength(ripple, 20, 400)).toBeGreaterThan(0.5)
    expect(litStrength(ripple, 20, 1800)).toBeGreaterThan(0.1)
    expect(litStrength(ripple, 20, 3600)).toBeLessThan(0.01)
    expect(litStrength(ripple, 600, 4000)).toBe(0)
  })

  it('ends every ripple after travel plus the dissolve', () => {
    expect(rippleLifetimeMs()).toBeGreaterThanOrEqual(5000)
    expect(rippleLifetimeMs()).toBeLessThan(5600)
  })

  it('keeps every lit cell visible but uneven, so the fade leaves patches', () => {
    let low = 0
    let high = 0
    for (let y = 0; y < 900; y += 15) {
      for (let x = 0; x < 1400; x += 7) {
        const level = patchLevel(x, y, 3)
        expect(level).toBeGreaterThanOrEqual(0.16)
        expect(level).toBeLessThanOrEqual(1)
        if (level < 0.3) low += 1
        if (level > 0.8) high += 1
      }
    }
    expect(low).toBeGreaterThan(0)
    expect(high).toBeGreaterThan(0)
  })
})
