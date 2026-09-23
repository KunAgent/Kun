import { describe, expect, it } from 'vitest'
import { resolveRemoteSurface, type RemoteSurfaceEnvironment } from './remote-surface'

const desktop: RemoteSurfaceEnvironment = {
  remote: true,
  viewportWidth: 1280,
  coarsePointer: false,
  screenWidth: 1920,
  screenHeight: 1080
}

describe('remote surface selection', () => {
  it.each([320, 375, 390, 430, 767])('uses mobile at %ipx', (viewportWidth) => {
    expect(resolveRemoteSurface({ ...desktop, viewportWidth })).toBe('mobile')
  })

  it('keeps wide browsers on desktop at the boundary', () => {
    expect(resolveRemoteSurface({ ...desktop, viewportWidth: 768 })).toBe('desktop')
  })

  it('never changes Electron to the mobile shell', () => {
    expect(resolveRemoteSurface({
      remote: false, viewportWidth: 320, coarsePointer: true, screenWidth: 390, screenHeight: 844
    })).toBe('desktop')
  })

  it('keeps a phone on mobile in landscape', () => {
    expect(resolveRemoteSurface({
      ...desktop, viewportWidth: 844, coarsePointer: true, screenWidth: 844, screenHeight: 390
    })).toBe('mobile')
  })

  it('does not classify a large touch tablet as a phone', () => {
    expect(resolveRemoteSurface({
      ...desktop, viewportWidth: 1024, coarsePointer: true, screenWidth: 1024, screenHeight: 768
    })).toBe('desktop')
  })

  it.each([0, -1, NaN, Infinity])('ignores unavailable screen dimensions: %s', (dimension) => {
    expect(resolveRemoteSurface({
      ...desktop, coarsePointer: true, screenWidth: dimension, screenHeight: 390
    })).toBe('desktop')
  })

  it('requires a coarse pointer for the screen-size fallback', () => {
    expect(resolveRemoteSurface({ ...desktop, screenWidth: 390, screenHeight: 844 })).toBe('desktop')
  })
})
