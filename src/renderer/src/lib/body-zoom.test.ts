import { describe, expect, it } from 'vitest'
import { bodyZoom, toLayoutPx } from './body-zoom'

describe('bodyZoom', () => {
  it('returns 1 outside a DOM environment', () => {
    expect(bodyZoom()).toBe(1)
  })
})

describe('toLayoutPx', () => {
  it('divides visual px by the zoom factor', () => {
    expect(toLayoutPx(90, 0.9)).toBeCloseTo(100)
    expect(toLayoutPx(110, 1.1)).toBeCloseTo(100)
  })

  it('returns the value unchanged at zoom 1', () => {
    expect(toLayoutPx(123, 1)).toBe(123)
  })

  it('defaults to the current body zoom', () => {
    expect(toLayoutPx(42)).toBe(42)
  })
})
