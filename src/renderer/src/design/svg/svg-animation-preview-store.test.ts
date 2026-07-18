import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  controlSvgAnimationPreview,
  publishSvgAnimationPreview,
  registerSvgAnimationPreviewController,
  resetSvgAnimationPreviewStore,
  useSvgAnimationPreviewStore
} from './svg-animation-preview-store'

beforeEach(() => resetSvgAnimationPreviewStore())

describe('SVG animation preview bridge', () => {
  it('publishes bounded transient state and routes player commands', () => {
    const play = vi.fn()
    const pause = vi.fn()
    const restart = vi.fn()
    const seek = vi.fn()
    const setRate = vi.fn()
    const unregister = registerSvgAnimationPreviewController('svg-frame', {
      play,
      pause,
      restart,
      seek,
      setRate
    })

    publishSvgAnimationPreview({
      shapeId: 'svg-frame',
      artifactId: 'animated-logo',
      title: 'Animated logo',
      status: 'ready',
      animationCount: 24,
      durationMs: 5_000,
      loopsIndefinitely: true,
      currentTimeMs: 1_250,
      playing: false,
      rate: 1
    })

    expect(useSvgAnimationPreviewStore.getState().previews['svg-frame']).toMatchObject({
      animationCount: 24,
      durationMs: 5_000,
      currentTimeMs: 1_250
    })
    expect(controlSvgAnimationPreview('svg-frame', { type: 'play' })).toBe(true)
    expect(controlSvgAnimationPreview('svg-frame', { type: 'pause' })).toBe(true)
    expect(controlSvgAnimationPreview('svg-frame', { type: 'restart' })).toBe(true)
    expect(controlSvgAnimationPreview('svg-frame', { type: 'seek', timeMs: 2_000 })).toBe(true)
    expect(controlSvgAnimationPreview('svg-frame', { type: 'set-rate', rate: 2 })).toBe(true)
    expect(play).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(restart).toHaveBeenCalledOnce()
    expect(seek).toHaveBeenCalledWith(2_000)
    expect(setRate).toHaveBeenCalledWith(2)

    unregister()
    expect(useSvgAnimationPreviewStore.getState().previews['svg-frame']).toBeUndefined()
    expect(controlSvgAnimationPreview('svg-frame', { type: 'play' })).toBe(false)
  })

  it('publishes an indefinite player time within its representative cycle', () => {
    publishSvgAnimationPreview({
      shapeId: 'long-running-svg',
      artifactId: 'clock',
      title: 'Clock',
      status: 'ready',
      animationCount: 1,
      durationMs: 5_000,
      loopsIndefinitely: true,
      currentTimeMs: 612_345,
      playing: true,
      rate: 1
    })

    expect(useSvgAnimationPreviewStore.getState().previews['long-running-svg']?.currentTimeMs).toBe(2_345)
  })

  it('ignores stale unregister callbacks after a portal remount', () => {
    const firstCleanup = registerSvgAnimationPreviewController('svg-frame', {
      play: vi.fn(), pause: vi.fn(), restart: vi.fn(), seek: vi.fn(), setRate: vi.fn()
    })
    const secondPlay = vi.fn()
    const secondCleanup = registerSvgAnimationPreviewController('svg-frame', {
      play: secondPlay, pause: vi.fn(), restart: vi.fn(), seek: vi.fn(), setRate: vi.fn()
    })
    publishSvgAnimationPreview({
      shapeId: 'svg-frame', artifactId: 'new', title: 'New', status: 'ready',
      animationCount: 1, durationMs: 1_000, loopsIndefinitely: true,
      currentTimeMs: 0, playing: false, rate: 1
    })

    firstCleanup()
    expect(controlSvgAnimationPreview('svg-frame', { type: 'play' })).toBe(true)
    expect(secondPlay).toHaveBeenCalledOnce()
    expect(useSvgAnimationPreviewStore.getState().previews['svg-frame']).toBeDefined()
    secondCleanup()
  })
})
