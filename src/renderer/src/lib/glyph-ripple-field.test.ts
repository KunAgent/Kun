import { describe, expect, it } from 'vitest'
import { crestStrength, litStrength, restingLevel, rippleLifetimeMs } from './glyph-ripple-field'

const ripple = { id: 1, x: 0, y: 0, startedAt: 0, reach: 600 }
const frontRadius = (age: number): number => 600 * (1 - Math.pow(1 - age / 1700, 3))

describe('glyph ripple wave', () => {
  it('peaks the crest on the expanding front and fades it out by the end of travel', () => {
    expect(crestStrength(ripple, frontRadius(300), 300)).toBeGreaterThan(0.5)
    expect(crestStrength(ripple, 590, 300)).toBe(0)
    expect(crestStrength(ripple, 300, 1700)).toBe(0)
    expect(crestStrength(ripple, 10, -5)).toBe(0)
  })

  it('lights the field only behind the front, then lets it settle back', () => {
    expect(litStrength(ripple, frontRadius(400) + 20, 400)).toBe(0)
    expect(litStrength(ripple, 20, 400)).toBeGreaterThan(0.5)
    expect(litStrength(ripple, 20, 2600)).toBeLessThan(0.01)
    expect(litStrength(ripple, 600, 3000)).toBe(0)
  })

  it('ends every ripple after travel plus the lit fade', () => {
    expect(rippleLifetimeMs()).toBeGreaterThanOrEqual(4000)
    expect(rippleLifetimeMs()).toBeLessThan(4600)
  })

  it('keeps the resting field sparse', () => {
    let shown = 0
    let total = 0
    for (let y = 0; y < 900; y += 15) {
      for (let x = 0; x < 1400; x += 7) {
        total += 1
        if (restingLevel(x, y, 0) > 0.02) shown += 1
      }
    }
    expect(shown / total).toBeGreaterThan(0.08)
    expect(shown / total).toBeLessThan(0.32)
  })
})
