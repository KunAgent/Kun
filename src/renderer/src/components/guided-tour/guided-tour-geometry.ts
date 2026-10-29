export type GuidedTourSide = 'right' | 'left' | 'top' | 'bottom'

export type Box = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

export type CoachPlacement = {
  spot: Box
  popover: { left: number; top: number }
  side: GuidedTourSide
  /** Caret position along the popover edge that faces the spot, in px. */
  caret: number
}

const SPOT_PAD = 6
const EDGE = 12
const GAP = 14
/** A long list only needs its top shown; the bubble explains the rest. */
const MAX_SPOT_HEIGHT = 260

/**
 * Converts a target's client rect into the overlay's own layout pixels. The
 * app zooms <body>, so client rects and CSS lengths differ by that factor;
 * dividing by the overlay's rect/clientWidth ratio keeps both sides in one space.
 */
export function toOverlayBox(target: Box, overlay: Box, overlayClientWidth: number): Box {
  const scale = overlayClientWidth > 0 ? overlay.width / overlayClientWidth : 1
  const ratio = scale > 0 ? scale : 1
  return {
    left: (target.left - overlay.left) / ratio,
    top: (target.top - overlay.top) / ratio,
    width: target.width / ratio,
    height: target.height / ratio
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function spotFor(target: Box, viewport: Size): Box {
  const left = clamp(target.left - SPOT_PAD, 4, viewport.width - 8)
  const top = clamp(target.top - SPOT_PAD, 4, viewport.height - 8)
  const right = clamp(target.left + target.width + SPOT_PAD, left + 4, viewport.width - 4)
  const bottom = clamp(target.top + target.height + SPOT_PAD, top + 4, viewport.height - 4)
  return { left, top, width: right - left, height: Math.min(bottom - top, MAX_SPOT_HEIGHT) }
}

function fits(side: GuidedTourSide, spot: Box, pop: Size, viewport: Size): boolean {
  switch (side) {
    case 'right': return spot.left + spot.width + GAP + pop.width <= viewport.width - EDGE
    case 'left': return spot.left - GAP - pop.width >= EDGE
    case 'top': return spot.top - GAP - pop.height >= EDGE
    case 'bottom': return spot.top + spot.height + GAP + pop.height <= viewport.height - EDGE
  }
}

const FALLBACKS: Record<GuidedTourSide, GuidedTourSide[]> = {
  right: ['right', 'bottom', 'left', 'top'],
  left: ['left', 'bottom', 'right', 'top'],
  top: ['top', 'bottom', 'left', 'right'],
  bottom: ['bottom', 'top', 'right', 'left']
}

/** Puts the bubble beside the spot on the preferred side, flipping when it would leave the window. */
export function placeCoach(target: Box, viewport: Size, pop: Size, preferred: GuidedTourSide): CoachPlacement {
  const spot = spotFor(target, viewport)
  const side = FALLBACKS[preferred].find((candidate) => fits(candidate, spot, pop, viewport)) ?? preferred
  let left: number
  let top: number
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? spot.left + spot.width + GAP : spot.left - GAP - pop.width
    top = clamp(spot.top, EDGE, viewport.height - EDGE - pop.height)
  } else {
    left = clamp(spot.left, EDGE, viewport.width - EDGE - pop.width)
    top = side === 'top' ? spot.top - GAP - pop.height : spot.top + spot.height + GAP
  }
  left = clamp(left, EDGE, viewport.width - EDGE - pop.width)
  top = clamp(top, EDGE, viewport.height - EDGE - pop.height)
  const caret = side === 'right' || side === 'left'
    ? clamp(Math.min(spot.top + 20, spot.top + spot.height / 2) - top, 16, pop.height - 16)
    : clamp(Math.min(spot.left + 40, spot.left + spot.width / 2) - left, 18, pop.width - 18)
  return { spot, popover: { left, top }, side, caret }
}
