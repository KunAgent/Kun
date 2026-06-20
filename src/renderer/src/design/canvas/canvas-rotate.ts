/**
 * Pure rotation math for the canvas. The angle between two vectors (from the
 * pivot to the start point and from the pivot to the current point) tells us
 * how much the pointer has moved around the pivot since pointerdown.
 */

const RAD2DEG = 180 / Math.PI

export function angleFromPivot(pivotX: number, pivotY: number, x: number, y: number): number {
  return Math.atan2(y - pivotY, x - pivotX) * RAD2DEG
}

/** Normalize any angle to [0, 360). */
export function normalizeAngle(deg: number): number {
  const n = deg % 360
  return n < 0 ? n + 360 : n
}

/**
 * Given the angle from pivot to pointerdown, the current angle from pivot to
 * the moving pointer, and the shape's starting rotation, return the new rotation
 * in degrees. Cmd snaps to 45° steps, Shift snaps to 15°.
 */
export function computeRotation(
  startAngleFromPivot: number,
  currentAngleFromPivot: number,
  startRotation: number,
  modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}
): number {
  const delta = currentAngleFromPivot - startAngleFromPivot
  let next = startRotation + delta
  if (modifiers.metaKey || modifiers.ctrlKey) {
    next = Math.round(next / 45) * 45
  } else if (modifiers.shiftKey) {
    next = Math.round(next / 15) * 15
  }
  return normalizeAngle(next)
}
