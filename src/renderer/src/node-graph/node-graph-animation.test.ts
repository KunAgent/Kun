import { describe, expect, it } from 'vitest'
import {
  clamp01,
  easeOutCubic,
  NODE_GRAPH_DIM_MS,
  NODE_GRAPH_ENTRY_MS,
  NODE_GRAPH_HOVER_MS,
  NODE_GRAPH_STAGGER_MS,
  NODE_GRAPH_STAGGER_STEPS,
  NodeGraphMotion,
  transitionProgress
} from './node-graph-animation'

describe('easing', () => {
  it('runs from 0 to 1 and clamps outside', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-3)).toBe(0)
    expect(easeOutCubic(9)).toBe(1)
  })

  it('eases out: most of the distance is covered early', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25)
  })

  it('is monotonic', () => {
    let previous = -1
    for (let step = 0; step <= 20; step += 1) {
      const value = easeOutCubic(step / 20)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('treats a non-finite progress as zero rather than propagating NaN', () => {
    // A NaN would reach globalAlpha and silently blank the canvas.
    expect(clamp01(Number.NaN)).toBe(0)
    expect(easeOutCubic(Number.NaN)).toBe(0)
  })
})

describe('transitionProgress', () => {
  it('spans the duration', () => {
    expect(transitionProgress(1_000, 1_000, 200)).toBe(0)
    expect(transitionProgress(1_100, 1_000, 200)).toBeCloseTo(0.5, 6)
    expect(transitionProgress(1_200, 1_000, 200)).toBe(1)
    expect(transitionProgress(9_999, 1_000, 200)).toBe(1)
  })

  it('is already finished for a zero duration', () => {
    expect(transitionProgress(0, 0, 0)).toBe(1)
  })

  it('catches up after a dropped frame instead of stretching', () => {
    // Progress is derived from the clock, not accumulated per frame, so a long
    // gap lands where it should rather than replaying the whole animation.
    expect(transitionProgress(1_150, 1_000, 200)).toBeCloseTo(0.75, 6)
  })
})

describe('NodeGraphMotion entry', () => {
  it('animates a node in from nothing', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    expect(motion.frame(0).entry('a')).toBe(0)
    expect(motion.frame(NODE_GRAPH_ENTRY_MS).entry('a')).toBe(1)
    const mid = motion.frame(NODE_GRAPH_ENTRY_MS / 2).entry('a')
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('leaves a node that was already on screen alone', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    // A background refresh re-sends the same node much later; re-stamping it
    // would make the whole graph strobe on every poll.
    motion.setNodes(['a', 'b'], 10_000)
    expect(motion.frame(10_000).entry('a')).toBe(1)
    expect(motion.frame(10_000).entry('b')).toBe(0)
  })

  it('forgets nodes that left, so an id reused later animates in again', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    motion.setNodes([], 100)
    motion.setNodes(['a'], 200)
    expect(motion.frame(200).entry('a')).toBe(0)
  })

  it('treats an unknown node as fully arrived', () => {
    expect(new NodeGraphMotion().frame(0).entry('missing')).toBe(1)
  })

  it('staggers a batch, but bounds the stagger', () => {
    const motion = new NodeGraphMotion()
    const ids = Array.from({ length: 400 }, (_, index) => `n${index}`)
    motion.setNodes(ids, 0)
    const frame = motion.frame(0)
    expect(frame.entry('n0')).toBe(0)
    // Later nodes have not started yet, which is what makes it read as assembly.
    expect(frame.entry('n5')).toBe(0)
    const settleBy = NODE_GRAPH_ENTRY_MS + NODE_GRAPH_STAGGER_STEPS * NODE_GRAPH_STAGGER_MS
    expect(motion.frame(settleBy).settled).toBe(true)
    // Bounded: 400 nodes cost the same as 14, not 400 x the stagger.
    expect(settleBy).toBeLessThan(600)
  })
})

describe('NodeGraphMotion focus', () => {
  it('eases the hover in from the moment focus changes', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    motion.setFocus('a', 1_000)
    expect(motion.frame(1_000).hover).toBe(0)
    expect(motion.frame(1_000 + NODE_GRAPH_HOVER_MS).hover).toBe(1)
    expect(motion.frame(1_000 + NODE_GRAPH_DIM_MS).dim).toBe(1)
  })

  it('does not restart while the focus holds', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    motion.setFocus('a', 500)
    expect(motion.frame(NODE_GRAPH_HOVER_MS).hover).toBe(1)
  })

  it('restarts when the focus moves to another node', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    motion.setFocus('b', 500)
    expect(motion.frame(500).hover).toBe(0)
  })
})

describe('NodeGraphMotion settling', () => {
  it('reports settled once entries and transitions have landed', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    expect(motion.frame(0).settled).toBe(false)
    expect(motion.frame(NODE_GRAPH_ENTRY_MS).settled).toBe(true)
  })

  it('never settles while an edge is flowing, so the canvas keeps painting', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    motion.setFlowing(true)
    expect(motion.frame(10_000).settled).toBe(false)
    expect(motion.frame(10_000).flow).toBeGreaterThan(0)
  })

  it('stops the flow when nothing is highlighted', () => {
    const motion = new NodeGraphMotion()
    motion.setFlowing(true)
    motion.setFlowing(false)
    expect(motion.frame(10_000).flow).toBe(0)
    expect(motion.frame(10_000).settled).toBe(true)
  })

  it('advances the flow with the clock', () => {
    const motion = new NodeGraphMotion()
    motion.setFlowing(true)
    expect(motion.frame(2_000).flow).toBeGreaterThan(motion.frame(1_000).flow)
  })
})

describe('NodeGraphMotion under reduced motion', () => {
  it('shows every animation at its end state and always settles', () => {
    const motion = new NodeGraphMotion()
    motion.setReducedMotion(true)
    motion.setNodes(['a'], 0)
    motion.setFocus('a', 0)
    motion.setFlowing(true)
    const frame = motion.frame(0)
    expect(frame.entry('a')).toBe(1)
    expect(frame.hover).toBe(1)
    expect(frame.dim).toBe(1)
    expect(frame.flow).toBe(0)
    // The canvas must be allowed to idle, or "reduced motion" still burns a core.
    expect(frame.settled).toBe(true)
  })

  it('resumes animating when the preference is turned back off', () => {
    const motion = new NodeGraphMotion()
    motion.setNodes(['a'], 0)
    motion.setReducedMotion(true)
    expect(motion.frame(0).entry('a')).toBe(1)
    motion.setReducedMotion(false)
    expect(motion.frame(0).entry('a')).toBe(0)
  })
})

describe('NodeGraphMotion fade-out', () => {
  it('runs the dimming back down when the pointer leaves', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    expect(motion.frame(NODE_GRAPH_DIM_MS).dim).toBe(1)
    motion.setFocus(null, NODE_GRAPH_DIM_MS)
    const midway = motion.frame(NODE_GRAPH_DIM_MS * 1.5).dim
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(1)
    expect(motion.frame(NODE_GRAPH_DIM_MS * 2).dim).toBe(0)
  })

  it('keeps the leaving node as the focus until the dimming is gone', () => {
    // Dropping it early makes the node that just lost the pointer flash dark.
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    motion.setFocus(null, NODE_GRAPH_DIM_MS)
    expect(motion.frame(NODE_GRAPH_DIM_MS * 1.5).focus).toBe('a')
    expect(motion.frame(NODE_GRAPH_DIM_MS * 2).focus).toBeNull()
  })

  it('drops the halo immediately on leaving, since it belongs to the live focus', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    motion.setFocus(null, NODE_GRAPH_DIM_MS)
    expect(motion.frame(NODE_GRAPH_DIM_MS * 1.5).hover).toBe(0)
  })

  it('reverses from where it is, so a flick across nodes stays continuous', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    // Leave halfway through the fade-in, then come back straight away.
    const partial = motion.frame(NODE_GRAPH_DIM_MS / 2).dim
    expect(partial).toBeLessThan(1)
    motion.setFocus(null, NODE_GRAPH_DIM_MS / 2)
    // The reversal starts from `partial`, not from a full 1.
    expect(motion.frame(NODE_GRAPH_DIM_MS / 2).dim).toBeCloseTo(partial, 6)
    expect(motion.frame(NODE_GRAPH_DIM_MS).dim).toBeLessThan(partial)
  })

  it('settles once the fade-out lands', () => {
    const motion = new NodeGraphMotion()
    motion.setFocus('a', 0)
    motion.setFocus(null, NODE_GRAPH_DIM_MS)
    expect(motion.frame(NODE_GRAPH_DIM_MS * 1.5).settled).toBe(false)
    expect(motion.frame(NODE_GRAPH_DIM_MS * 2).settled).toBe(true)
  })

  it('reports no dimming at rest', () => {
    expect(new NodeGraphMotion().frame(0).dim).toBe(0)
    expect(new NodeGraphMotion().frame(0).focus).toBeNull()
  })
})
