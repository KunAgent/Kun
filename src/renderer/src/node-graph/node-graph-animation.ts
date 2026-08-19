/**
 * Motion for the graph canvas.
 *
 * All of it is time-in, numbers-out: the canvas owns the clock and the paint
 * pass stays a pure function of what this produces, which is what makes the
 * timings testable without a canvas or a frame loop.
 *
 * Durations follow the shell's own motion rule — subtle, fast, ease-out — and
 * every one of them collapses to its end state under `prefers-reduced-motion`,
 * so the reduced path shows the same graph, just without the travel.
 */

/** A node fading and scaling in. Long enough to read, short enough to ignore. */
export const NODE_GRAPH_ENTRY_MS = 320

/** Per-node stagger, so a fresh graph assembles instead of blinking on. */
export const NODE_GRAPH_STAGGER_MS = 16

/** Cap on the stagger, so a 400-node graph does not take seven seconds. */
export const NODE_GRAPH_STAGGER_STEPS = 14

/** Hover halo and lift. Under 200ms, or the pointer outruns it. */
export const NODE_GRAPH_HOVER_MS = 140

/** Dimming of everything unrelated to the focused node. */
export const NODE_GRAPH_DIM_MS = 180

/** Screen pixels a flow dash travels per second along a highlighted edge. */
export const NODE_GRAPH_FLOW_SPEED = 42

/** How much a hovered node grows, as a fraction of its radius. */
export const NODE_GRAPH_HOVER_LIFT = 0.16

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Ease-out cubic: quick to start, soft landing. The shell's default curve. */
export function easeOutCubic(progress: number): number {
  const t = clamp01(progress)
  return 1 - (1 - t) ** 3
}

/** Linear progress of a transition, clamped at both ends. */
export function transitionProgress(now: number, startedAt: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1
  return clamp01((now - startedAt) / durationMs)
}

/** One frame's worth of motion, read by the painter. */
export type NodeGraphMotionFrame = {
  /** 0..1 entry progress for a node, already eased. */
  entry: (nodeId: string) => number
  /** 0..1 strength of the hover halo and lift. */
  hover: number
  /**
   * 0..1 strength of the dimming applied to everything unrelated, easing up on
   * focus and back down on blur.
   */
  dim: number
  /**
   * The node the dimming is organised around: the focused one, or the one still
   * fading out. Null once nothing is highlighted at all.
   */
  focus: string | null
  /** Screen-pixel offset of the marching dashes on a highlighted edge. */
  flow: number
  /** True when nothing is left to animate, so the canvas can stop painting. */
  settled: boolean
}

function settledFrame(focus: string | null): NodeGraphMotionFrame {
  return { entry: () => 1, hover: 1, dim: focus === null ? 0 : 1, focus, flow: 0, settled: true }
}

/**
 * Tracks what is currently in motion.
 *
 * Owned by the canvas and driven from its frame loop. It holds start times
 * rather than progress values so a dropped frame catches up instead of
 * stretching the animation.
 */
export class NodeGraphMotion {
  private readonly appearedAt = new Map<string, number>()
  private focusStartedAt = 0
  private focused: string | null = null
  /** Kept through the fade-out, so the node losing focus does not flash dark. */
  private fading: string | null = null
  /** Dim value at the moment focus last changed, so a reversal starts where it is. */
  private dimFrom = 0
  private flowing = false
  private reduced = false

  /** Collapses every animation to its end state while set. */
  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced
  }

  get reducedMotion(): boolean {
    return this.reduced
  }

  /**
   * Reconciles the animating set with what is on screen.
   *
   * Nodes already present keep their original start time, so a filter change or
   * a background refresh animates only what actually arrived — re-entering the
   * whole graph on every poll would make it strobe.
   */
  setNodes(nodeIds: Iterable<string>, now: number): void {
    const seen = new Set<string>()
    let index = 0
    for (const id of nodeIds) {
      seen.add(id)
      if (!this.appearedAt.has(id)) {
        const step = index % NODE_GRAPH_STAGGER_STEPS
        this.appearedAt.set(id, now + step * NODE_GRAPH_STAGGER_MS)
      }
      index += 1
    }
    for (const id of [...this.appearedAt.keys()]) {
      if (!seen.has(id)) this.appearedAt.delete(id)
    }
  }

  /**
   * Starts (or reverses) the hover transition.
   *
   * A reversal picks up from wherever the dimming currently sits rather than
   * from zero, so flicking the pointer across several nodes stays continuous
   * instead of restarting the fade each time.
   */
  setFocus(nodeId: string | null, now: number): void {
    if (this.focused === nodeId) return
    this.dimFrom = this.currentDim(now)
    if (nodeId !== null) this.fading = nodeId
    this.focused = nodeId
    this.focusStartedAt = now
  }

  /**
   * Whether any edge is currently highlighted and should keep flowing.
   *
   * Set explicitly rather than inferred from focus: an active shortest path
   * outlives the selection that created it, and its edges have to keep moving.
   */
  setFlowing(flowing: boolean): void {
    this.flowing = flowing
  }

  /** Where the dimming sits right now, easing between `dimFrom` and its target. */
  private currentDim(now: number): number {
    const target = this.focused === null ? 0 : 1
    const progress = easeOutCubic(
      transitionProgress(now, this.focusStartedAt, NODE_GRAPH_DIM_MS)
    )
    return this.dimFrom + (target - this.dimFrom) * progress
  }

  frame(now: number): NodeGraphMotionFrame {
    if (this.reduced) return settledFrame(this.focused)
    const dim = this.currentDim(now)
    // Once the fade-out finishes there is nothing left to organise the dimming
    // around, and the node can stop being tracked.
    if (this.focused === null && dim <= 0.001) this.fading = null
    const focus = this.focused ?? this.fading
    const hoverProgress = transitionProgress(now, this.focusStartedAt, NODE_GRAPH_HOVER_MS)
    const appearedAt = this.appearedAt
    let entriesSettled = true
    for (const startedAt of appearedAt.values()) {
      if (now - startedAt < NODE_GRAPH_ENTRY_MS) {
        entriesSettled = false
        break
      }
    }
    // Flowing edges never settle, so the canvas may not idle while any are
    // highlighted; with none, there is nothing left to move.
    const flowing = this.flowing
    const dimSettled = this.focused === null ? dim <= 0.001 : dim >= 0.999
    return {
      entry: (nodeId) => {
        const startedAt = appearedAt.get(nodeId)
        if (startedAt === undefined) return 1
        return easeOutCubic(transitionProgress(now, startedAt, NODE_GRAPH_ENTRY_MS))
      },
      // The halo belongs to the live focus only; a node fading out loses it as
      // the dimming recedes.
      hover: this.focused === null ? 0 : easeOutCubic(hoverProgress),
      dim,
      focus,
      flow: flowing ? (now / 1000) * NODE_GRAPH_FLOW_SPEED : 0,
      settled: entriesSettled && hoverProgress >= 1 && dimSettled && !flowing
    }
  }
}
