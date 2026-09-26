/**
 * Comment-gutter anti-overlap layout (R1.4): each gutter card wants to sit at
 * its mark's anchor y; overlapping cards get pushed down greedily
 * (`top = max(anchorY, prevBottom + gap)`) and the whole stack shifts back up
 * when the last card would overflow the rail bottom. Pure function so the
 * geometry is unit-testable without the DOM.
 */
export function layoutCommentGutter(input: {
  /** Desired card tops (mark anchor y in container coordinates). */
  anchors: readonly number[]
  /** Measured card heights in the same order. */
  heights: readonly number[]
  /** Usable rail height; cards clamp inside [0, containerHeight]. */
  containerHeight: number
  /** Minimum vertical gap between cards (default 8). */
  gap?: number
}): number[] {
  const { anchors, heights, containerHeight } = input
  const gap = input.gap ?? 8
  if (anchors.length === 0) return []

  const tops: number[] = new Array(anchors.length)
  let previousBottom = -Infinity
  for (let i = 0; i < anchors.length; i += 1) {
    const top = Math.max(anchors[i], previousBottom + gap)
    tops[i] = top
    previousBottom = top + (heights[i] ?? 0)
  }

  // Overflow past the rail bottom: push the whole stack up, clamping at 0.
  const lastBottom = tops[tops.length - 1] + (heights[heights.length - 1] ?? 0)
  const overflow = lastBottom - containerHeight
  if (overflow > 0) {
    let shift = overflow
    if (tops[0] - shift < 0) shift = tops[0]
    for (let i = 0; i < tops.length; i += 1) tops[i] = Math.max(0, tops[i] - shift)
  }
  return tops
}
