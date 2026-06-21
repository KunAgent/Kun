import type { DesignArtifactNode } from './design-types'

export type DesignNodeResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export type ResizeDesignArtifactNodeOptions = {
  node: DesignArtifactNode
  handle: DesignNodeResizeHandle
  deltaX: number
  deltaY: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

const DEFAULT_MIN_WIDTH = 280
const DEFAULT_MIN_HEIGHT = 220
const DEFAULT_MAX_WIDTH = 1800
const DEFAULT_MAX_HEIGHT = 1600

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resizeDesignArtifactNode(
  options: ResizeDesignArtifactNodeOptions
): Pick<DesignArtifactNode, 'x' | 'y' | 'width' | 'height' | 'sizeMode'> {
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT
  const { node, handle, deltaX, deltaY } = options
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')

  let width = node.width
  let height = node.height
  let x = node.x
  let y = node.y

  if (east) {
    width = clamp(node.width + deltaX, minWidth, maxWidth)
  } else if (west) {
    width = clamp(node.width - deltaX, minWidth, maxWidth)
    x = node.x + node.width - width
  }

  if (south) {
    height = clamp(node.height + deltaY, minHeight, maxHeight)
  } else if (north) {
    height = clamp(node.height - deltaY, minHeight, maxHeight)
    y = node.y + node.height - height
  }

  return {
    x,
    y,
    width,
    height,
    sizeMode: north || south ? 'manual' : 'auto'
  }
}
