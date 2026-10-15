import { describe, expect, it } from 'vitest'
import { crestStrength, rippleLifetimeMs, troughDepth } from './glyph-ripple-field'

const ripple = { id: 1, x: 0, y: 0, startedAt: 0, reach: 600 }

describe('glyph ripple wave', () => {
  it('peaks the crest on the expanding front and fades it out by the end of travel', () => {
    const early = 300
    const atFront = crestStrength(ripple, 600 * (1 - Math.pow(1 - early / 1700, 3)), early)
    expect(atFront).toBeGreaterThan(0.5)
    expect(crestStrength(ripple, 590, early)).toBe(0)
    expect(crestStrength(ripple, 300, 1700)).toBe(0)
    expect(crestStrength(ripple, 10, -5)).toBe(0)
  })

  it('opens a trough only behind the front and refills it afterwards', () => {
    expect(troughDepth(ripple, 400, 100)).toBe(0)
    expect(troughDepth(ripple, 20, 200)).toBeGreaterThan(0.5)
    expect(troughDepth(ripple, 20, 1700)).toBeLessThan(0.01)
    expect(troughDepth(ripple, 600, 2500)).toBe(0)
  })

  it('ends every ripple after travel plus refill', () => {
    expect(rippleLifetimeMs()).toBeGreaterThanOrEqual(2800)
    expect(rippleLifetimeMs()).toBeLessThan(3200)
  })
})
