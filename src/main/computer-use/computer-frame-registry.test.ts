import { describe, expect, it } from 'vitest'
import { ComputerFrameError, ComputerFrameRegistry } from './computer-frame-registry'

describe('ComputerFrameRegistry', () => {
  it('maps screenshot coordinates into the native desktop space', () => {
    const registry = new ComputerFrameRegistry(30_000, 8, () => 1_000)
    const frame = registry.register({
      sessionId: 'session-a',
      image: { width: 1_280, height: 720, mimeType: 'image/png' },
      nativeDesktop: { width: 2_560, height: 1_440 }
    })

    expect(registry.resolve('session-a', frame.frameId, { x: 640, y: 360 })).toMatchObject({
      x: 1_280,
      y: 720,
      frame: { frameId: frame.frameId }
    })
  })

  it('uses the most recently registered frame when captures share a millisecond', () => {
    const registry = new ComputerFrameRegistry(30_000, 8, () => 1_000)
    registry.register({
      sessionId: 'session-a',
      image: { width: 100, height: 100, mimeType: 'image/png' },
      nativeDesktop: { width: 100, height: 100 }
    })
    const newest = registry.register({
      sessionId: 'session-a',
      image: { width: 50, height: 50, mimeType: 'image/png' },
      nativeDesktop: { width: 200, height: 200 }
    })

    expect(registry.latest('session-a')?.frameId).toBe(newest.frameId)
    expect(registry.resolve('session-a', undefined, { x: 25, y: 25 })).toMatchObject({
      x: 100,
      y: 100,
      frame: { frameId: newest.frameId }
    })
  })

  it('rejects expired, cross-session, and out-of-frame coordinates', () => {
    let now = 1_000
    const registry = new ComputerFrameRegistry(100, 8, () => now)
    const frame = registry.register({
      sessionId: 'session-a',
      image: { width: 100, height: 50, mimeType: 'image/png' },
      nativeDesktop: { width: 200, height: 100 }
    })

    expect(() => registry.resolve('session-b', frame.frameId, { x: 1, y: 1 }))
      .toThrow(ComputerFrameError)
    expect(() => registry.resolve('session-a', frame.frameId, { x: 100, y: 1 }))
      .toThrow('outside the screenshot frame')
    now = 1_101
    expect(() => registry.resolve('session-a', frame.frameId, { x: 1, y: 1 }))
      .toThrow('expired')
  })
})
