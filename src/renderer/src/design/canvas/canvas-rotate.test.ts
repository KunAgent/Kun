import { describe, expect, it } from 'vitest'
import { angleFromPivot, computeRotation, normalizeAngle } from './canvas-rotate'

describe('normalizeAngle', () => {
  it('passes through values in [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(359.5)).toBeCloseTo(359.5)
  })
  it('wraps negatives', () => {
    expect(normalizeAngle(-10)).toBeCloseTo(350)
    expect(normalizeAngle(-720)).toBeCloseTo(0)
  })
  it('wraps overshoots', () => {
    expect(normalizeAngle(720)).toBeCloseTo(0)
    expect(normalizeAngle(450)).toBeCloseTo(90)
  })
})

describe('angleFromPivot', () => {
  it('0° points along +X from pivot', () => {
    expect(angleFromPivot(0, 0, 10, 0)).toBeCloseTo(0)
  })
  it('90° points along +Y (screen coords)', () => {
    expect(angleFromPivot(0, 0, 0, 10)).toBeCloseTo(90)
  })
  it('180° points along -X', () => {
    expect(angleFromPivot(0, 0, -10, 0)).toBeCloseTo(180)
  })
  it('-90° points along -Y', () => {
    expect(angleFromPivot(0, 0, 0, -10)).toBeCloseTo(-90)
  })
})

describe('computeRotation', () => {
  it('pointer moves the same angle as the start angle: no change', () => {
    expect(computeRotation(0, 0, 30)).toBeCloseTo(30)
    expect(computeRotation(45, 45, 0)).toBeCloseTo(0)
  })

  it('pointer rotates 45° clockwise: rotation += 45', () => {
    expect(computeRotation(0, 45, 0)).toBeCloseTo(45)
    expect(computeRotation(0, 45, 90)).toBeCloseTo(135)
  })

  it('wraps to [0, 360)', () => {
    expect(computeRotation(0, -10, 0)).toBeCloseTo(350)
    expect(computeRotation(0, 90, 280)).toBeCloseTo(10)
  })

  it('shift snaps to 15° steps', () => {
    expect(computeRotation(0, 22, 0, { shiftKey: true })).toBeCloseTo(15)
    expect(computeRotation(0, 23, 0, { shiftKey: true })).toBeCloseTo(30)
  })

  it('cmd/ctrl snaps to 45° steps', () => {
    expect(computeRotation(0, 23, 0, { metaKey: true })).toBeCloseTo(45)
    expect(computeRotation(0, 23, 0, { ctrlKey: true })).toBeCloseTo(45)
    expect(computeRotation(0, 22, 0, { metaKey: true })).toBeCloseTo(0)
    expect(computeRotation(0, 67, 0, { metaKey: true })).toBeCloseTo(45)
    expect(computeRotation(0, 68, 0, { metaKey: true })).toBeCloseTo(90)
  })

  it('meta takes precedence over shift', () => {
    expect(computeRotation(0, 30, 0, { metaKey: true, shiftKey: true })).toBeCloseTo(45)
  })
})
