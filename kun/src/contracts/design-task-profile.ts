import { z } from 'zod'

export const DesignOutputMediumSchema = z.enum(['html', 'image'])
export type DesignOutputMedium = z.infer<typeof DesignOutputMediumSchema>

export const DesignTargetSchema = z.enum(['web', 'app'])
export type DesignTarget = z.infer<typeof DesignTargetSchema>

export const DesignSystemPresetSchema = z.enum([
  'none',
  'shadcn',
  'radix',
  'material',
  'ios',
  'fluent',
  'ant',
  'chakra',
  'carbon',
  'polaris',
  'bootstrap',
  'geist',
  'brutalism',
  'editorial'
])
export type DesignSystemPreset = z.infer<typeof DesignSystemPresetSchema>

export const DesignPresetSourceSchema = z.enum([
  'explicit',
  'root-design-md',
  'workspace-default',
  'none'
])
export type DesignPresetSource = z.infer<typeof DesignPresetSourceSchema>

export const DesignStyleSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.literal('root-design-md'),
  sourceHash: z.string().trim().min(1).max(128),
  sourceName: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(16_000),
  truncated: z.boolean().optional()
}).strict()
export type DesignStyleSnapshot = z.infer<typeof DesignStyleSnapshotSchema>

const DesignIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a stable Design identifier')

/** Durable routing identity for one Design task's independently writable board. */
export const DesignDocumentTargetSchema = z.object({
  documentId: DesignIdentifierSchema,
  boardArtifactId: DesignIdentifierSchema
}).strict()
export type DesignDocumentTarget = z.infer<typeof DesignDocumentTargetSchema>

export const DesignImagePlacementTargetSchema = z.object({
  shapeId: z.string().trim().min(1).max(256),
  expectedImageUrl: z.string().trim().min(1).max(8_192).optional(),
  expectedHolderKind: z.enum([
    'explicit',
    'implicit-image',
    'implicit-frame',
    'implicit-rect'
  ]).optional()
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.expectedImageUrl) === Boolean(value.expectedHolderKind)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expectedImageUrl'],
      message: 'exactly one expected image URL or holder identity is required'
    })
  }
})
export type DesignImagePlacementTarget = z.infer<typeof DesignImagePlacementTargetSchema>

/**
 * Bounded copy of the renderer DesignContext. The task profile owns the
 * target and preset separately so those discriminators cannot drift from the
 * fields used for runtime routing.
 */
export const DesignContextSnapshotSchema = z.object({
  designType: z.enum(['brand', 'product']).optional(),
  brandColor: z.string().trim().min(1).max(32).optional(),
  tone: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  designGuidelines: z.string().max(4_000).optional(),
  radius: z.enum(['sharp', 'soft', 'rounded', 'pill']).optional(),
  density: z.enum(['compact', 'cozy', 'spacious']).optional(),
  fontStyle: z.enum(['system', 'geometric', 'humanist', 'serif', 'mono']).optional()
}).strict().superRefine((value, ctx) => {
  if (new Set(value.tone).size !== value.tone.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['tone'],
      message: 'tone entries must be unique'
    })
  }
})
export type DesignContextSnapshot = z.infer<typeof DesignContextSnapshotSchema>

/** Profile submitted with a Design turn before Kun assigns the lock turn. */
export const DesignTaskProfileInputSchema = z.object({
  version: z.literal(1),
  documentTarget: DesignDocumentTargetSchema,
  outputMedium: DesignOutputMediumSchema,
  target: DesignTargetSchema,
  preset: DesignSystemPresetSchema,
  /** How an Auto selection was resolved when the task became immutable. */
  presetSource: DesignPresetSourceSchema.optional(),
  /** Immutable parsed projection of the root DESIGN.md selected by Auto. */
  styleSnapshot: DesignStyleSnapshotSchema.optional(),
  /** Renderer for the bound drawing. Missing means the legacy Kun canvas. */
  canvasEngine: z.enum(['kun', 'excalidraw']).optional(),
  context: DesignContextSnapshotSchema
}).strict().superRefine((value, ctx) => {
  if (value.styleSnapshot && value.presetSource !== 'root-design-md') {
    ctx.addIssue({
      code: 'custom',
      path: ['styleSnapshot'],
      message: 'styleSnapshot is only valid for root-design-md profiles'
    })
  }
})
export type DesignTaskProfileInput = z.infer<typeof DesignTaskProfileInputSchema>

/** Immutable runtime-owned profile stored after the first accepted turn. */
export const DesignTaskProfileSchema = DesignTaskProfileInputSchema.safeExtend({
  lockedAtTurnId: z.string().trim().min(1).max(256)
}).strict()
export type DesignTaskProfile = z.infer<typeof DesignTaskProfileSchema>
