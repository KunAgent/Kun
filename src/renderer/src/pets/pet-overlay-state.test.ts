import { describe, expect, it } from 'vitest'
import { effectivePetBusinessState, nextDragDirection, resolveOverlayAnimationState } from './pet-overlay-state'

describe('resolveOverlayAnimationState', () => {
  it('uses the business state when idle', () => {
    expect(resolveOverlayAnimationState({
      resizeMode: false,
      dragging: false,
      dragDirection: 'right',
      hover: false,
      effectiveBusinessState: 'waiting'
    })).toBe('waiting')
  })

  it('uses jumping while hovering over an otherwise idle pet', () => {
    expect(resolveOverlayAnimationState({
      resizeMode: false,
      dragging: false,
      dragDirection: 'right',
      hover: true,
      effectiveBusinessState: 'idle'
    })).toBe('jumping')
  })

  it('uses directional running while dragging', () => {
    expect(resolveOverlayAnimationState({
      resizeMode: false,
      dragging: true,
      dragDirection: 'left',
      hover: true,
      effectiveBusinessState: 'running'
    })).toBe('running-left')
    expect(resolveOverlayAnimationState({
      resizeMode: false,
      dragging: true,
      dragDirection: 'right',
      hover: true,
      effectiveBusinessState: 'running'
    })).toBe('running-right')
  })

  it('keeps the current business state while resizing', () => {
    expect(resolveOverlayAnimationState({
      resizeMode: true,
      dragging: true,
      dragDirection: 'left',
      hover: true,
      effectiveBusinessState: 'review'
    })).toBe('review')
  })

  it('waves only for a first awake with no visible notification', () => {
    expect(effectivePetBusinessState({ activeStatus: null, welcomeUntilMs: 9_000, nowMs: 1_000 })).toBe('waving')
    expect(effectivePetBusinessState({ activeStatus: 'running', welcomeUntilMs: 9_000, nowMs: 1_000 })).toBe('running')
    expect(effectivePetBusinessState({ activeStatus: null, welcomeUntilMs: 9_000, nowMs: 9_000 })).toBe('idle')
    expect(nextDragDirection('right', -2)).toBe('left')
    expect(nextDragDirection('left', 0)).toBe('left')
  })
})
