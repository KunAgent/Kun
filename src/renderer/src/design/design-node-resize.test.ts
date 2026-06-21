import { describe, expect, it } from 'vitest'
import { resizeDesignArtifactNode } from './design-node-resize'
import type { DesignArtifactNode } from './design-types'

const node: DesignArtifactNode = {
  x: 100,
  y: 120,
  width: 420,
  height: 340,
  sizeMode: 'auto'
}

describe('resizeDesignArtifactNode', () => {
  it('resizes east while keeping height auto-measured', () => {
    expect(
      resizeDesignArtifactNode({
        node,
        handle: 'e',
        deltaX: 240,
        deltaY: 80
      })
    ).toEqual({
      x: 100,
      y: 120,
      width: 660,
      height: 340,
      sizeMode: 'auto'
    })
  })

  it('resizes west from the opposite edge', () => {
    expect(
      resizeDesignArtifactNode({
        node,
        handle: 'w',
        deltaX: 60,
        deltaY: 0
      })
    ).toEqual({
      x: 160,
      y: 120,
      width: 360,
      height: 340,
      sizeMode: 'auto'
    })
  })

  it('resizes a corner into manual sizing', () => {
    expect(
      resizeDesignArtifactNode({
        node,
        handle: 'se',
        deltaX: 424,
        deltaY: 188
      })
    ).toEqual({
      x: 100,
      y: 120,
      width: 844,
      height: 528,
      sizeMode: 'manual'
    })
  })

  it('clamps north-west resize and preserves the opposite corner', () => {
    expect(
      resizeDesignArtifactNode({
        node,
        handle: 'nw',
        deltaX: 300,
        deltaY: 220
      })
    ).toEqual({
      x: 240,
      y: 240,
      width: 280,
      height: 220,
      sizeMode: 'manual'
    })
  })
})
