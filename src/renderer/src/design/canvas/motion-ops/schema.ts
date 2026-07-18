import { z } from 'zod'
import {
  CANVAS_MOTION_OPERATIONS,
  CANVAS_MOTION_PLAYBACK_MODES,
  CANVAS_MOTION_PROPERTIES,
  MAX_CANVAS_MOTION_ABSOLUTE_VALUE,
  MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS,
  MAX_CANVAS_MOTION_DURATION_MS,
  MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK,
  MAX_CANVAS_MOTION_SPRING_DAMPING,
  MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS,
  MAX_CANVAS_MOTION_SPRING_MASS,
  MAX_CANVAS_MOTION_SPRING_STIFFNESS,
  MIN_CANVAS_MOTION_SPRING_MASS,
  MIN_CANVAS_MOTION_SPRING_STIFFNESS
} from '../../motion/canvas-motion-types'

export const MAX_RENDERER_MOTION_OPS_PER_BATCH = 64
export const MAX_RENDERER_MOTION_OP_ARGUMENT_BYTES = 256 * 1024
export const MAX_RENDERER_MOTION_PRESET_TARGETS = 50
export const MAX_RENDERER_MOTION_ID_LENGTH = 256

const MotionIdSchema = z.string().trim().min(1).max(MAX_RENDERER_MOTION_ID_LENGTH)
const MotionNumberSchema = z.number().finite()
const MotionTimeSchema = MotionNumberSchema.min(0).max(MAX_CANVAS_MOTION_DURATION_MS)
const MotionValueSchema = MotionNumberSchema
  .min(-MAX_CANVAS_MOTION_ABSOLUTE_VALUE)
  .max(MAX_CANVAS_MOTION_ABSOLUTE_VALUE)

export const MotionEasingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']) }).strict(),
  z.object({
    type: z.literal('cubic-bezier'),
    x1: MotionNumberSchema.min(0).max(1),
    y1: MotionNumberSchema
      .min(-MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS)
      .max(MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS),
    x2: MotionNumberSchema.min(0).max(1),
    y2: MotionNumberSchema
      .min(-MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS)
      .max(MAX_CANVAS_MOTION_CUBIC_BEZIER_Y_ABS)
  }).strict(),
  z.object({
    type: z.literal('spring'),
    mass: MotionNumberSchema.min(MIN_CANVAS_MOTION_SPRING_MASS).max(MAX_CANVAS_MOTION_SPRING_MASS),
    stiffness: MotionNumberSchema
      .min(MIN_CANVAS_MOTION_SPRING_STIFFNESS)
      .max(MAX_CANVAS_MOTION_SPRING_STIFFNESS),
    damping: MotionNumberSchema.min(0).max(MAX_CANVAS_MOTION_SPRING_DAMPING),
    initialVelocity: MotionNumberSchema
      .min(-MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS)
      .max(MAX_CANVAS_MOTION_SPRING_INITIAL_VELOCITY_ABS)
      .optional()
  }).strict()
])

const MotionKeyframeInputSchema = z.object({
  id: MotionIdSchema.optional(),
  timeMs: MotionTimeSchema,
  value: MotionValueSchema,
  easing: MotionEasingSchema.optional()
}).strict()

const SetTimelineMotionOpSchema = z.object({
  op: z.literal('set-timeline'),
  frameId: MotionIdSchema,
  durationMs: MotionNumberSchema.positive().max(MAX_CANVAS_MOTION_DURATION_MS).optional(),
  playback: z.enum(CANVAS_MOTION_PLAYBACK_MODES).optional()
}).strict().refine(
  (value) => value.durationMs !== undefined || value.playback !== undefined,
  { message: 'set-timeline requires durationMs and/or playback' }
)

const UpsertKeyframesMotionOpSchema = z.object({
  op: z.literal('upsert-keyframes'),
  frameId: MotionIdSchema,
  targetShapeId: MotionIdSchema,
  property: z.enum(CANVAS_MOTION_PROPERTIES),
  operation: z.enum(CANVAS_MOTION_OPERATIONS).optional(),
  baseValue: MotionValueSchema.optional(),
  delayMs: MotionTimeSchema.optional(),
  spanMs: MotionNumberSchema.positive().max(MAX_CANVAS_MOTION_DURATION_MS).optional(),
  keyframes: z.array(MotionKeyframeInputSchema).min(1).max(MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK)
}).strict()

const ApplyPresetMotionOpSchema = z.object({
  op: z.literal('apply-preset'),
  frameId: MotionIdSchema,
  targetShapeIds: z.array(MotionIdSchema)
    .min(1)
    .max(MAX_RENDERER_MOTION_PRESET_TARGETS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'targetShapeIds must be unique' }),
  preset: z.enum(['fade', 'move', 'scale', 'rotate']),
  direction: z.enum(['in', 'out']).default('in'),
  durationMs: MotionNumberSchema.positive().max(MAX_CANVAS_MOTION_DURATION_MS).optional(),
  delayMs: MotionTimeSchema.optional(),
  staggerMs: MotionTimeSchema.optional(),
  distanceX: MotionValueSchema.optional(),
  distanceY: MotionValueSchema.optional(),
  scaleFrom: MotionNumberSchema.min(-1_000).max(1_000).optional(),
  scaleTo: MotionNumberSchema.min(-1_000).max(1_000).optional(),
  degrees: MotionValueSchema.optional(),
  easing: MotionEasingSchema.optional()
}).strict()

const DeleteMotionOpSchema = z.object({
  op: z.literal('delete'),
  kind: z.enum(['timeline', 'track', 'keyframe']),
  frameId: MotionIdSchema,
  trackId: MotionIdSchema.optional(),
  targetShapeId: MotionIdSchema.optional(),
  property: z.enum(CANVAS_MOTION_PROPERTIES).optional(),
  keyframeId: MotionIdSchema.optional(),
  timeMs: MotionTimeSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.kind === 'timeline') return
  if (!value.trackId && !(value.targetShapeId && value.property)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.kind} deletion requires trackId or targetShapeId plus property`
    })
  }
  if (value.kind === 'keyframe' && !value.keyframeId && value.timeMs === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'keyframe deletion requires keyframeId or timeMs'
    })
  }
})

export const MotionOpSchema = z.union([
  SetTimelineMotionOpSchema,
  UpsertKeyframesMotionOpSchema,
  ApplyPresetMotionOpSchema,
  DeleteMotionOpSchema
])

export type MotionOp = z.infer<typeof MotionOpSchema>

export type MotionOpError = {
  code:
    | 'INVALID_MOTION_OP'
    | 'MOTION_BATCH_LIMIT'
    | 'MOTION_FRAME_NOT_FOUND'
    | 'MOTION_TARGET_NOT_FOUND'
    | 'MOTION_FRAME_SCOPE'
    | 'MOTION_LIMIT_EXCEEDED'
  message: string
  suggestion?: string
}

export type ExecuteMotionOpsResult = {
  ok: boolean
  affectedIds: string[]
  errors: MotionOpError[]
  replayed?: boolean
}
