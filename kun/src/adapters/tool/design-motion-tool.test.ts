import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildDesignMotionLocalTools,
  createDesignMotionApplyPresetTool,
  createDesignMotionDeleteTool,
  createDesignMotionSetTimelineTool,
  createDesignMotionUpsertKeyframesTool,
  DESIGN_MOTION_APPLY_PRESET_TOOL_NAME,
  DESIGN_MOTION_DELETE_TOOL_NAME,
  DESIGN_MOTION_MAX_ARGUMENT_BYTES,
  DESIGN_MOTION_MAX_DURATION_MS,
  DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL,
  DESIGN_MOTION_MAX_PRESET_TARGETS,
  DESIGN_MOTION_SET_TIMELINE_TOOL_NAME,
  DESIGN_MOTION_TOOL_NAMES,
  DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME
} from './design-motion-tool.js'

function context(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    guiDesignCanvas: true,
    guiDesignMode: true,
    ...overrides
  }
}

describe('Design Motion tool catalog', () => {
  it('advertises the bounded mutation tools only for product Design canvas turns', () => {
    const tools = buildDesignMotionLocalTools()
    expect(tools.map((tool) => tool.name)).toEqual(DESIGN_MOTION_TOOL_NAMES)
    for (const tool of tools) {
      expect(tool.shouldAdvertise?.(context())).toBe(true)
      expect(tool.shouldAdvertise?.(context({ guiDesignCanvas: undefined }))).toBe(false)
      expect(tool.shouldAdvertise?.(context({ guiDesignMode: undefined }))).toBe(false)
      expect(tool.shouldAdvertise?.(context({ guiDesignMode: false }))).toBe(false)
      expect(tool.toolKind).toBe('tool_call')
    }
  })

  it('publishes canonical property, timing, easing, target, and preset bounds in schemas', () => {
    const schemas = buildDesignMotionLocalTools().map((tool) => JSON.stringify(tool.inputSchema)).join('\n')
    expect(schemas).toContain(`"maximum":${DESIGN_MOTION_MAX_DURATION_MS}`)
    expect(schemas).toContain(`"maxItems":${DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL}`)
    expect(schemas).toContain(`"maxItems":${DESIGN_MOTION_MAX_PRESET_TARGETS}`)
    expect(schemas).toContain('"targetShapeId"')
    expect(schemas).toContain('"scaleX"')
    expect(schemas).toContain('"scaleY"')
    expect(schemas).toContain('"cubic-bezier"')
    expect(schemas).toContain('"spring"')
    expect(schemas).toContain('"ping-pong"')
    expect(schemas).toContain('"fade"')
    expect(schemas).toContain('"rotate"')
  })
})

describe('Design Motion tool output', () => {
  it('returns timeline changes through motionOps rather than ShapeOps', async () => {
    const result = await createDesignMotionSetTimelineTool().execute({
      frameId: 'frame_home',
      durationMs: 2_400,
      playback: 'loop'
    }, context())

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_MOTION_SET_TIMELINE_TOOL_NAME,
      action: 'set_timeline',
      motionOps: [{
        op: 'set-timeline',
        frameId: 'frame_home',
        durationMs: 2_400,
        playback: 'loop'
      }]
    })
    expect(result.output).not.toHaveProperty('ops')
  })

  it('preserves omitted operation and easing for renderer-side track updates', async () => {
    const result = await createDesignMotionUpsertKeyframesTool().execute({
      frameId: 'frame_home',
      targetShapeId: 'hero_card',
      property: 'opacity',
      keyframes: [
        { timeMs: 0, value: 0 },
        {
          id: 'kf_visible',
          timeMs: 500,
          value: 1,
          easing: { type: 'cubic-bezier', x1: 0.2, y1: 0, x2: 0, y2: 1 }
        }
      ]
    }, context())

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
      action: 'upsert_keyframes',
      motionOps: [{
        op: 'upsert-keyframes',
        frameId: 'frame_home',
        targetShapeId: 'hero_card',
        property: 'opacity',
        keyframes: [
          { timeMs: 0, value: 0 },
          {
            id: 'kf_visible',
            timeMs: 500,
            value: 1,
            easing: { type: 'cubic-bezier', x1: 0.2, y1: 0, x2: 0, y2: 1 }
          }
        ]
      }]
    })
    expect(result.output).not.toHaveProperty('ops')
  })

  it('returns editable preset and idempotent delete operations', async () => {
    const preset = await createDesignMotionApplyPresetTool().execute({
      frameId: 'frame_home',
      targetShapeIds: ['hero_title', 'hero_cta'],
      preset: 'move',
      direction: 'in',
      durationMs: 600,
      staggerMs: 80,
      distanceY: 24,
      easing: { type: 'spring', mass: 1, stiffness: 180, damping: 20 }
    }, context())
    expect(preset.output).toMatchObject({
      ok: true,
      tool: DESIGN_MOTION_APPLY_PRESET_TOOL_NAME,
      motionOps: [{
        op: 'apply-preset',
        frameId: 'frame_home',
        targetShapeIds: ['hero_title', 'hero_cta'],
        preset: 'move',
        durationMs: 600,
        staggerMs: 80,
        distanceY: 24
      }]
    })

    const deletion = await createDesignMotionDeleteTool().execute({
      kind: 'keyframe',
      frameId: 'frame_home',
      targetShapeId: 'hero_cta',
      property: 'y',
      timeMs: 600
    }, context())
    expect(deletion.output).toMatchObject({
      ok: true,
      tool: DESIGN_MOTION_DELETE_TOOL_NAME,
      motionOps: [{
        op: 'delete',
        kind: 'keyframe',
        frameId: 'frame_home',
        targetShapeId: 'hero_cta',
        property: 'y',
        timeMs: 600
      }]
    })
  })
})

describe('Design Motion tool budgets', () => {
  it('rejects keyframe and preset track fan-out above the per-call limits', async () => {
    const keyframes = await createDesignMotionUpsertKeyframesTool().execute({
      frameId: 'frame_home',
      targetShapeId: 'hero_card',
      property: 'x',
      keyframes: Array.from({ length: DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL + 1 }, (_, index) => ({
        timeMs: index,
        value: index
      }))
    }, context())
    expect(keyframes.isError).toBe(true)
    expect(keyframes.output).toMatchObject({
      ok: false,
      error: expect.stringContaining(`at most ${DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL}`)
    })

    const preset = await createDesignMotionApplyPresetTool().execute({
      frameId: 'frame_home',
      targetShapeIds: Array.from({ length: DESIGN_MOTION_MAX_PRESET_TARGETS + 1 }, (_, index) => `shape_${index}`),
      preset: 'fade'
    }, context())
    expect(preset.isError).toBe(true)
    expect(preset.output).toMatchObject({
      ok: false,
      error: expect.stringContaining(`at most ${DESIGN_MOTION_MAX_PRESET_TARGETS}`)
    })
  })

  it('rejects oversized structured arguments before returning renderer operations', async () => {
    const result = await createDesignMotionSetTimelineTool().execute({
      frameId: 'x'.repeat(DESIGN_MOTION_MAX_ARGUMENT_BYTES + 1),
      durationMs: 1_000
    }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      ok: false,
      error: expect.stringContaining(`exceed ${DESIGN_MOTION_MAX_ARGUMENT_BYTES} bytes`)
    })
    expect(result.output).not.toHaveProperty('motionOps')
  })

  it('rejects invalid non-finite timing and easing values', async () => {
    const invalidTime = await createDesignMotionSetTimelineTool().execute({
      frameId: 'frame_home',
      durationMs: Number.POSITIVE_INFINITY
    }, context())
    expect(invalidTime.isError).toBe(true)

    const invalidEasing = await createDesignMotionUpsertKeyframesTool().execute({
      frameId: 'frame_home',
      targetShapeId: 'hero_card',
      property: 'x',
      keyframes: [{
        timeMs: 100,
        value: 20,
        easing: { type: 'cubic-bezier', x1: -1, y1: 0, x2: 1, y2: 1 }
      }]
    }, context())
    expect(invalidEasing.isError).toBe(true)
    expect(invalidEasing.output).toMatchObject({
      error: expect.stringContaining('cubic-bezier')
    })

    const tinySpring = await createDesignMotionUpsertKeyframesTool().execute({
      frameId: 'frame_home',
      targetShapeId: 'hero_card',
      property: 'x',
      keyframes: [{
        timeMs: 100,
        value: 20,
        easing: { type: 'spring', mass: 0.00001, stiffness: 100, damping: 10 }
      }]
    }, context())
    expect(tinySpring.isError).toBe(true)
    expect(tinySpring.output).toMatchObject({
      error: expect.stringContaining('at least 0.0001')
    })
  })
})
