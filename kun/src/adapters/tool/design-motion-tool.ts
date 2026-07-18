import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { validateStructuredArgumentBudget } from './structured-argument-budget.js'

export const DESIGN_MOTION_SET_TIMELINE_TOOL_NAME = 'design_motion_set_timeline'
export const DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME = 'design_motion_upsert_keyframes'
export const DESIGN_MOTION_APPLY_PRESET_TOOL_NAME = 'design_motion_apply_preset'
export const DESIGN_MOTION_DELETE_TOOL_NAME = 'design_motion_delete'

export const DESIGN_MOTION_TOOL_NAMES = [
  DESIGN_MOTION_SET_TIMELINE_TOOL_NAME,
  DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
  DESIGN_MOTION_APPLY_PRESET_TOOL_NAME,
  DESIGN_MOTION_DELETE_TOOL_NAME
] as const

export const DESIGN_MOTION_MAX_DURATION_MS = 600_000
export const DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL = 256
export const DESIGN_MOTION_MAX_PRESET_TARGETS = 50
export const DESIGN_MOTION_MAX_ARGUMENT_BYTES = 256 * 1024

const DESIGN_MOTION_MAX_STRUCTURED_NODES = 2_048
const DESIGN_MOTION_MAX_ARGUMENT_DEPTH = 16
const DESIGN_MOTION_MAX_ID_LENGTH = 256
const DESIGN_MOTION_MAX_ABSOLUTE_VALUE = 1_000_000
const DESIGN_MOTION_MIN_SPRING_VALUE = 0.0001

const MOTION_PROPERTIES = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'] as const
const MOTION_OPERATIONS = ['set', 'offset', 'scale'] as const
const MOTION_PLAYBACK_MODES = ['once', 'loop', 'ping-pong'] as const
const MOTION_PRESETS = ['fade', 'move', 'scale', 'rotate'] as const
const MOTION_EASING_TYPES = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring'
] as const

type MotionEasing =
  | { type: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }
  | { type: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number }
  | {
      type: 'spring'
      mass: number
      stiffness: number
      damping: number
      initialVelocity?: number
    }

type MotionKeyframe = {
  id?: string
  timeMs: number
  value: number
  easing?: MotionEasing
}

const SHOULD_ADVERTISE_DESIGN_MOTION_TOOL = (context: {
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
}) => context.guiDesignCanvas === true && context.guiDesignMode === true

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: DESIGN_MOTION_MAX_ID_LENGTH
} as const

const easingSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']
        }
      },
      required: ['type'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['cubic-bezier'] },
        x1: { type: 'number', minimum: 0, maximum: 1 },
        y1: { type: 'number', minimum: -10, maximum: 10 },
        x2: { type: 'number', minimum: 0, maximum: 1 },
        y2: { type: 'number', minimum: -10, maximum: 10 }
      },
      required: ['type', 'x1', 'y1', 'x2', 'y2'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['spring'] },
        mass: { type: 'number', minimum: DESIGN_MOTION_MIN_SPRING_VALUE, maximum: 100 },
        stiffness: { type: 'number', minimum: DESIGN_MOTION_MIN_SPRING_VALUE, maximum: 10_000 },
        damping: { type: 'number', minimum: 0, maximum: 1_000 },
        initialVelocity: { type: 'number', minimum: -1_000, maximum: 1_000 }
      },
      required: ['type', 'mass', 'stiffness', 'damping'],
      additionalProperties: false
    }
  ]
} as const

const keyframeSchema = {
  type: 'object',
  properties: {
    id: idSchema,
    timeMs: {
      type: 'number',
      minimum: 0,
      maximum: DESIGN_MOTION_MAX_DURATION_MS,
      description: 'Track-local keyframe time. delayMs positions the track in the owning frame timeline and spanMs controls its timeline span.'
    },
    value: {
      type: 'number',
      minimum: -DESIGN_MOTION_MAX_ABSOLUTE_VALUE,
      maximum: DESIGN_MOTION_MAX_ABSOLUTE_VALUE
    },
    easing: easingSchema
  },
  required: ['timeMs', 'value'],
  additionalProperties: false
} as const

export function buildDesignMotionLocalTools(): LocalTool[] {
  return [
    createDesignMotionSetTimelineTool(),
    createDesignMotionUpsertKeyframesTool(),
    createDesignMotionApplyPresetTool(),
    createDesignMotionDeleteTool()
  ]
}

export function createDesignMotionSetTimelineTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_MOTION_SET_TIMELINE_TOOL_NAME,
    description: [
      'Create or update the canonical Motion timeline owned by a frame from the current Design canvas snapshot.',
      'Use the stable frame id from the snapshot. Motion is frame/layer animation; it does not create Prototype navigation or edit standalone SVG inner animation.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_MOTION_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        frameId: {
          ...idSchema,
          description: 'Owning frame id, or the stable canvas-root id shown in the Design snapshot.'
        },
        durationMs: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: DESIGN_MOTION_MAX_DURATION_MS
        },
        playback: { type: 'string', enum: MOTION_PLAYBACK_MODES }
      },
      required: ['frameId'],
      additionalProperties: false
    },
    execute: async (args) => {
      const budgetError = motionBudgetError(args, DESIGN_MOTION_SET_TIMELINE_TOOL_NAME)
      if (budgetError) return motionToolError(DESIGN_MOTION_SET_TIMELINE_TOOL_NAME, budgetError)
      const frameId = motionId(args.frameId)
      if (!frameId) return motionToolError(DESIGN_MOTION_SET_TIMELINE_TOOL_NAME, 'frameId is required and must be at most 256 characters')
      const durationMs = boundedNumber(args.durationMs, 0, DESIGN_MOTION_MAX_DURATION_MS, true)
      const playback = oneOf(args.playback, MOTION_PLAYBACK_MODES)
      if (args.durationMs !== undefined && durationMs === undefined) {
        return motionToolError(
          DESIGN_MOTION_SET_TIMELINE_TOOL_NAME,
          `durationMs must be finite, greater than 0, and at most ${DESIGN_MOTION_MAX_DURATION_MS}`
        )
      }
      if (args.playback !== undefined && !playback) {
        return motionToolError(DESIGN_MOTION_SET_TIMELINE_TOOL_NAME, 'playback must be once, loop, or ping-pong')
      }
      if (durationMs === undefined && !playback) {
        return motionToolError(DESIGN_MOTION_SET_TIMELINE_TOOL_NAME, 'provide durationMs and/or playback')
      }
      return motionToolOutput(DESIGN_MOTION_SET_TIMELINE_TOOL_NAME, 'set_timeline', {
        op: 'set-timeline',
        frameId,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(playback ? { playback } : {})
      })
    }
  })
}

export function createDesignMotionUpsertKeyframesTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
    description: [
      'Create or update one canonical Motion property track and upsert typed keyframes by stable id or timestamp.',
      'Use only frame and target shape ids from the current Design snapshot. Reuse this tool to edit existing tracks instead of generating CSS, GSAP, HTML animation, or ShapeOps.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_MOTION_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        frameId: idSchema,
        targetShapeId: {
          ...idSchema,
          description: 'Stable native shape or whole artifact/running-app frame id from the snapshot.'
        },
        property: { type: 'string', enum: MOTION_PROPERTIES },
        operation: {
          type: 'string',
          enum: MOTION_OPERATIONS,
          description: 'How evaluated values compose with the target base value. Defaults to set.'
        },
        baseValue: {
          type: 'number',
          minimum: -DESIGN_MOTION_MAX_ABSOLUTE_VALUE,
          maximum: DESIGN_MOTION_MAX_ABSOLUTE_VALUE,
          description: 'Optional observed base value from the snapshot. The renderer remains authoritative.'
        },
        delayMs: { type: 'number', minimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS },
        spanMs: { type: 'number', exclusiveMinimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS },
        keyframes: {
          type: 'array',
          minItems: 1,
          maxItems: DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL,
          items: keyframeSchema
        }
      },
      required: ['frameId', 'targetShapeId', 'property', 'keyframes'],
      additionalProperties: false
    },
    execute: async (args) => {
      const budgetError = motionBudgetError(args, DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME)
      if (budgetError) return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, budgetError)
      const frameId = motionId(args.frameId)
      const targetShapeId = motionId(args.targetShapeId)
      const property = oneOf(args.property, MOTION_PROPERTIES)
      const operation = oneOf(args.operation, MOTION_OPERATIONS)
      if (!frameId || !targetShapeId) {
        return motionToolError(
          DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
          'frameId and targetShapeId are required and must each be at most 256 characters'
        )
      }
      if (!property) {
        return motionToolError(
          DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
          `property must be one of ${MOTION_PROPERTIES.join(', ')}`
        )
      }
      if (args.operation !== undefined && !oneOf(args.operation, MOTION_OPERATIONS)) {
        return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'operation must be set, offset, or scale')
      }
      if (!Array.isArray(args.keyframes) || args.keyframes.length === 0) {
        return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'keyframes must contain at least one keyframe')
      }
      if (args.keyframes.length > DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL) {
        return motionToolError(
          DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
          `keyframes accepts at most ${DESIGN_MOTION_MAX_KEYFRAMES_PER_CALL} items; split the track update into smaller calls`
        )
      }
      const keyframes: MotionKeyframe[] = []
      for (let index = 0; index < args.keyframes.length; index += 1) {
        const normalized = normalizeKeyframe(args.keyframes[index])
        if (!normalized.ok) {
          return motionToolError(
            DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME,
            `keyframes[${index}] ${normalized.error}`
          )
        }
        keyframes.push(normalized.keyframe)
      }
      const baseValue = boundedNumber(args.baseValue, -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, DESIGN_MOTION_MAX_ABSOLUTE_VALUE)
      if (args.baseValue !== undefined && baseValue === undefined) {
        return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'baseValue must be a bounded finite number')
      }
      const delayMs = boundedNumber(args.delayMs, 0, DESIGN_MOTION_MAX_DURATION_MS)
      if (args.delayMs !== undefined && delayMs === undefined) {
        return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'delayMs must be between 0 and 600000')
      }
      const spanMs = boundedNumber(args.spanMs, 0, DESIGN_MOTION_MAX_DURATION_MS, true)
      if (args.spanMs !== undefined && spanMs === undefined) {
        return motionToolError(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'spanMs must be greater than 0 and at most 600000')
      }
      return motionToolOutput(DESIGN_MOTION_UPSERT_KEYFRAMES_TOOL_NAME, 'upsert_keyframes', {
        op: 'upsert-keyframes',
        frameId,
        targetShapeId,
        property,
        ...(operation ? { operation } : {}),
        ...(baseValue !== undefined ? { baseValue } : {}),
        ...(delayMs !== undefined ? { delayMs } : {}),
        ...(spanMs !== undefined ? { spanMs } : {}),
        keyframes
      })
    }
  })
}

export function createDesignMotionApplyPresetTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_MOTION_APPLY_PRESET_TOOL_NAME,
    description: [
      'Apply an editable Fade, Move, Scale, or Rotate preset to Design canvas layers.',
      'The renderer compiles the preset into ordinary canonical tracks and sorts multi-selection by canvas paint order for deterministic stagger.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_MOTION_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        frameId: idSchema,
        targetShapeIds: {
          type: 'array',
          minItems: 1,
          maxItems: DESIGN_MOTION_MAX_PRESET_TARGETS,
          uniqueItems: true,
          items: idSchema
        },
        preset: { type: 'string', enum: MOTION_PRESETS },
        direction: {
          type: 'string',
          enum: ['in', 'out'],
          description: 'Whether the preset enters or exits. Defaults to in.'
        },
        durationMs: { type: 'number', exclusiveMinimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS },
        delayMs: { type: 'number', minimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS },
        staggerMs: { type: 'number', minimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS },
        distanceX: { type: 'number', minimum: -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, maximum: DESIGN_MOTION_MAX_ABSOLUTE_VALUE },
        distanceY: { type: 'number', minimum: -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, maximum: DESIGN_MOTION_MAX_ABSOLUTE_VALUE },
        scaleFrom: { type: 'number', minimum: -1_000, maximum: 1_000 },
        scaleTo: { type: 'number', minimum: -1_000, maximum: 1_000 },
        degrees: { type: 'number', minimum: -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, maximum: DESIGN_MOTION_MAX_ABSOLUTE_VALUE },
        easing: easingSchema
      },
      required: ['frameId', 'targetShapeIds', 'preset'],
      additionalProperties: false
    },
    execute: async (args) => {
      const budgetError = motionBudgetError(args, DESIGN_MOTION_APPLY_PRESET_TOOL_NAME)
      if (budgetError) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, budgetError)
      const frameId = motionId(args.frameId)
      if (!frameId) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'frameId is required and must be at most 256 characters')
      if (!Array.isArray(args.targetShapeIds) || args.targetShapeIds.length === 0) {
        return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'targetShapeIds must contain at least one shape id')
      }
      if (args.targetShapeIds.length > DESIGN_MOTION_MAX_PRESET_TARGETS) {
        return motionToolError(
          DESIGN_MOTION_APPLY_PRESET_TOOL_NAME,
          `targetShapeIds accepts at most ${DESIGN_MOTION_MAX_PRESET_TARGETS} targets per preset call`
        )
      }
      const targetShapeIds = args.targetShapeIds.map(motionId)
      if (targetShapeIds.some((id) => !id)) {
        return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'every targetShapeId must be a non-empty string of at most 256 characters')
      }
      if (new Set(targetShapeIds).size !== targetShapeIds.length) {
        return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'targetShapeIds must not contain duplicates')
      }
      const preset = oneOf(args.preset, MOTION_PRESETS)
      if (!preset) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'preset must be fade, move, scale, or rotate')
      const direction = oneOf(args.direction, ['in', 'out'] as const) ?? 'in'
      if (args.direction !== undefined && !oneOf(args.direction, ['in', 'out'] as const)) {
        return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'direction must be in or out')
      }
      const durationMs = optionalMotionTime(args.durationMs, true)
      const delayMs = optionalMotionTime(args.delayMs)
      const staggerMs = optionalMotionTime(args.staggerMs)
      if (!durationMs.ok) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, durationMs.error)
      if (!delayMs.ok) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, delayMs.error)
      if (!staggerMs.ok) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, staggerMs.error)
      const easing = args.easing === undefined ? undefined : normalizeEasing(args.easing)
      if (easing && !easing.ok) return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, `easing ${easing.error}`)
      const numericOptions: Record<string, number> = {}
      for (const [key, min, max] of [
        ['distanceX', -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, DESIGN_MOTION_MAX_ABSOLUTE_VALUE],
        ['distanceY', -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, DESIGN_MOTION_MAX_ABSOLUTE_VALUE],
        ['scaleFrom', -1_000, 1_000],
        ['scaleTo', -1_000, 1_000],
        ['degrees', -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, DESIGN_MOTION_MAX_ABSOLUTE_VALUE]
      ] as const) {
        const value = boundedNumber(args[key], min, max)
        if (args[key] !== undefined && value === undefined) {
          return motionToolError(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, `${key} must be a bounded finite number`)
        }
        if (value !== undefined) numericOptions[key] = value
      }
      return motionToolOutput(DESIGN_MOTION_APPLY_PRESET_TOOL_NAME, 'apply_preset', {
        op: 'apply-preset',
        frameId,
        targetShapeIds: targetShapeIds as string[],
        preset,
        direction,
        ...(durationMs.value !== undefined ? { durationMs: durationMs.value } : {}),
        ...(delayMs.value !== undefined ? { delayMs: delayMs.value } : {}),
        ...(staggerMs.value !== undefined ? { staggerMs: staggerMs.value } : {}),
        ...numericOptions,
        ...(easing?.ok ? { easing: easing.easing } : {})
      })
    }
  })
}

export function createDesignMotionDeleteTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_MOTION_DELETE_TOOL_NAME,
    description: [
      'Delete a canonical Motion timeline, property track, or keyframe by stable identifiers from the current Design snapshot.',
      'Deleting an already-missing item is idempotent and succeeds when the renderer applies the operation.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_MOTION_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['timeline', 'track', 'keyframe'] },
        frameId: idSchema,
        trackId: idSchema,
        targetShapeId: idSchema,
        property: { type: 'string', enum: MOTION_PROPERTIES },
        keyframeId: idSchema,
        timeMs: { type: 'number', minimum: 0, maximum: DESIGN_MOTION_MAX_DURATION_MS }
      },
      required: ['kind', 'frameId'],
      additionalProperties: false
    },
    execute: async (args) => {
      const budgetError = motionBudgetError(args, DESIGN_MOTION_DELETE_TOOL_NAME)
      if (budgetError) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, budgetError)
      const kind = oneOf(args.kind, ['timeline', 'track', 'keyframe'] as const)
      const frameId = motionId(args.frameId)
      if (!kind || !frameId) {
        return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'kind and a frameId of at most 256 characters are required')
      }
      const trackId = motionId(args.trackId)
      const targetShapeId = motionId(args.targetShapeId)
      const property = oneOf(args.property, MOTION_PROPERTIES)
      const keyframeId = motionId(args.keyframeId)
      const timeMs = boundedNumber(args.timeMs, 0, DESIGN_MOTION_MAX_DURATION_MS)
      if (args.trackId !== undefined && !trackId) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'trackId must be at most 256 characters')
      if (args.targetShapeId !== undefined && !targetShapeId) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'targetShapeId must be at most 256 characters')
      if (args.property !== undefined && !property) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, `property must be one of ${MOTION_PROPERTIES.join(', ')}`)
      if (args.keyframeId !== undefined && !keyframeId) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'keyframeId must be at most 256 characters')
      if (args.timeMs !== undefined && timeMs === undefined) return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'timeMs must be between 0 and 600000')
      const hasTrackIdentity = Boolean(trackId || (targetShapeId && property))
      if ((kind === 'track' || kind === 'keyframe') && !hasTrackIdentity) {
        return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, `${kind} deletion requires trackId or targetShapeId plus property`)
      }
      if (kind === 'keyframe' && !keyframeId && timeMs === undefined) {
        return motionToolError(DESIGN_MOTION_DELETE_TOOL_NAME, 'keyframe deletion requires keyframeId or timeMs')
      }
      return motionToolOutput(DESIGN_MOTION_DELETE_TOOL_NAME, 'delete', {
        op: 'delete',
        kind,
        frameId,
        ...(trackId ? { trackId } : {}),
        ...(targetShapeId ? { targetShapeId } : {}),
        ...(property ? { property } : {}),
        ...(keyframeId ? { keyframeId } : {}),
        ...(timeMs !== undefined ? { timeMs } : {})
      })
    }
  })
}

function motionBudgetError(args: Record<string, unknown>, label: string): string | null {
  const result = validateStructuredArgumentBudget(args, {
    label,
    maxBytes: DESIGN_MOTION_MAX_ARGUMENT_BYTES,
    maxNodes: DESIGN_MOTION_MAX_STRUCTURED_NODES,
    maxDepth: DESIGN_MOTION_MAX_ARGUMENT_DEPTH
  })
  return result.ok ? null : result.error
}

function normalizeKeyframe(value: unknown):
  | { ok: true; keyframe: MotionKeyframe }
  | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'must be an object' }
  const id = value.id === undefined ? undefined : motionId(value.id)
  if (value.id !== undefined && !id) return { ok: false, error: 'id must be a non-empty string of at most 256 characters' }
  const timeMs = boundedNumber(value.timeMs, 0, DESIGN_MOTION_MAX_DURATION_MS)
  if (timeMs === undefined) return { ok: false, error: 'timeMs must be between 0 and 600000' }
  const numericValue = boundedNumber(value.value, -DESIGN_MOTION_MAX_ABSOLUTE_VALUE, DESIGN_MOTION_MAX_ABSOLUTE_VALUE)
  if (numericValue === undefined) return { ok: false, error: 'value must be a bounded finite number' }
  const easing = value.easing === undefined ? undefined : normalizeEasing(value.easing)
  if (easing && !easing.ok) return { ok: false, error: `easing ${easing.error}` }
  return {
    ok: true,
    keyframe: {
      ...(id ? { id } : {}),
      timeMs,
      value: numericValue,
      ...(easing?.ok ? { easing: easing.easing } : {})
    }
  }
}

function normalizeEasing(value: unknown):
  | { ok: true; easing: MotionEasing }
  | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'must be an object' }
  const type = oneOf(value.type, MOTION_EASING_TYPES)
  if (!type) return { ok: false, error: `type must be one of ${MOTION_EASING_TYPES.join(', ')}` }
  if (type === 'cubic-bezier') {
    const x1 = boundedNumber(value.x1, 0, 1)
    const y1 = boundedNumber(value.y1, -10, 10)
    const x2 = boundedNumber(value.x2, 0, 1)
    const y2 = boundedNumber(value.y2, -10, 10)
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      return { ok: false, error: 'cubic-bezier requires finite x1/x2 in [0,1] and y1/y2 in [-10,10]' }
    }
    return { ok: true, easing: { type, x1, y1, x2, y2 } }
  }
  if (type === 'spring') {
    const mass = boundedNumber(value.mass, DESIGN_MOTION_MIN_SPRING_VALUE, 100)
    const stiffness = boundedNumber(value.stiffness, DESIGN_MOTION_MIN_SPRING_VALUE, 10_000)
    const damping = boundedNumber(value.damping, 0, 1_000)
    const initialVelocity = boundedNumber(value.initialVelocity, -1_000, 1_000)
    if (mass === undefined || stiffness === undefined || damping === undefined) {
      return { ok: false, error: 'spring requires mass/stiffness of at least 0.0001 and non-negative damping within schema bounds' }
    }
    if (value.initialVelocity !== undefined && initialVelocity === undefined) {
      return { ok: false, error: 'spring initialVelocity must be between -1000 and 1000' }
    }
    return {
      ok: true,
      easing: {
        type,
        mass,
        stiffness,
        damping,
        ...(initialVelocity !== undefined ? { initialVelocity } : {})
      }
    }
  }
  return { ok: true, easing: { type } }
}

function optionalMotionTime(
  value: unknown,
  exclusiveMinimum = false
): { ok: true; value?: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true }
  const time = boundedNumber(value, 0, DESIGN_MOTION_MAX_DURATION_MS, exclusiveMinimum)
  if (time === undefined) {
    return {
      ok: false,
      error: exclusiveMinimum
        ? 'durationMs must be finite, greater than 0, and at most 600000'
        : 'delayMs and staggerMs must be finite and between 0 and 600000'
    }
  }
  return { ok: true, value: time }
}

function motionToolOutput(
  tool: string,
  action: string,
  motionOp: Record<string, unknown>
): { output: Record<string, unknown> } {
  return {
    output: {
      ok: true,
      tool,
      action,
      motionOps: [motionOp],
      message: 'Queued 1 Motion operation for the Design canvas.'
    }
  }
}

function motionToolError(tool: string, error: string): { output: Record<string, unknown>; isError: true } {
  return { output: { ok: false, tool, error }, isError: true }
}

function motionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= DESIGN_MOTION_MAX_ID_LENGTH ? trimmed : undefined
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  exclusiveMinimum = false
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (exclusiveMinimum ? value <= minimum : value < minimum) return undefined
  return value <= maximum ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined
}
