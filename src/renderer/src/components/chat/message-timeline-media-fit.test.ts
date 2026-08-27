import { describe, expect, it } from 'vitest'
import {
  mediaTileDisplaySize,
  mediaTileFitConstraints
} from './message-timeline-media-logic'

describe('mediaTileDisplaySize', () => {
  const constraints = { maxWidth: 320, maxHeight: 256 }

  it('shrinks large images proportionally to fit the max width', () => {
    expect(mediaTileDisplaySize({ width: 1280, height: 640 }, constraints)).toEqual({
      width: 320,
      height: 160
    })
  })

  it('shrinks tall images proportionally to fit the max height', () => {
    expect(mediaTileDisplaySize({ width: 400, height: 1600 }, constraints)).toEqual({
      width: 64,
      height: 256
    })
  })

  it('never upscales small images', () => {
    expect(mediaTileDisplaySize({ width: 120, height: 80 }, constraints)).toEqual({
      width: 120,
      height: 80
    })
  })

  it('keeps images that exactly match the constraints at natural size', () => {
    expect(mediaTileDisplaySize({ width: 320, height: 256 }, constraints)).toEqual({
      width: 320,
      height: 256
    })
  })

  it('clamps degenerate natural sizes to a minimal tile', () => {
    expect(mediaTileDisplaySize({ width: 0, height: 0 }, constraints)).toEqual({
      width: 1,
      height: 1
    })
  })
})

describe('mediaTileFitConstraints', () => {
  it('uses the widest constraints for a single user image', () => {
    expect(mediaTileFitConstraints('user', 1)).toEqual({ maxWidth: 320, maxHeight: 256 })
  })

  it('uses tighter constraints for multiple user images', () => {
    expect(mediaTileFitConstraints('user', 3)).toEqual({ maxWidth: 224, maxHeight: 160 })
  })

  it('matches the tool tile box', () => {
    expect(mediaTileFitConstraints('tool', 1)).toEqual({ maxWidth: 160, maxHeight: 128 })
  })

  it('matches the conversation tile box', () => {
    expect(mediaTileFitConstraints('conversation', 1)).toEqual({ maxWidth: 208, maxHeight: 208 })
  })
})
