import { z } from 'zod'
import type { CanvasShapePreset, DevicePreset } from '../canvas-types'

const ShapeTypeSchema = z.enum([
  'rect',
  'ellipse',
  'text',
  'image',
  'frame',
  'group',
  'arrow',
  'line',
  'draw'
])

const PointSchema = z.object({ x: z.number(), y: z.number() })

const SolidFillSchema = z.object({
  type: z.literal('solid'),
  color: z.string(),
  opacity: z.number().min(0).max(1)
})

const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: z.string(),
  opacity: z.number().min(0).max(1).optional()
})

export const GradientFillSchema = z.object({
  type: z.enum(['linear', 'radial']),
  stops: z.array(GradientStopSchema).min(2),
  angle: z.number().optional(),
  opacity: z.number().min(0).max(1)
})

const FillSchema = z.union([SolidFillSchema, GradientFillSchema])

export const ShadowSchema = z.object({
  type: z.enum(['drop', 'inner']).optional(),
  x: z.number(),
  y: z.number(),
  blur: z.number().min(0),
  spread: z.number().optional(),
  color: z.string(),
  opacity: z.number().min(0).max(1)
})

const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity'
])

const AutoLayoutSchema = z.object({
  direction: z.enum(['horizontal', 'vertical']),
  gap: z.number().min(0),
  paddingTop: z.number().min(0),
  paddingRight: z.number().min(0),
  paddingBottom: z.number().min(0),
  paddingLeft: z.number().min(0),
  primaryAlign: z.enum(['start', 'center', 'end', 'space-between']).optional(),
  counterAlign: z.enum(['start', 'center', 'end']).optional()
})

/** Loose layout spec accepted by the `auto-layout` op — merged over defaults. */
export const PartialAutoLayoutSchema = z.object({
  direction: z.enum(['horizontal', 'vertical']).optional(),
  gap: z.number().min(0).optional(),
  padding: z.number().min(0).optional(),
  paddingTop: z.number().min(0).optional(),
  paddingRight: z.number().min(0).optional(),
  paddingBottom: z.number().min(0).optional(),
  paddingLeft: z.number().min(0).optional(),
  primaryAlign: z.enum(['start', 'center', 'end', 'space-between']).optional(),
  counterAlign: z.enum(['start', 'center', 'end']).optional()
})

const ConstraintsSchema = z.object({
  h: z.enum(['left', 'right', 'left-right', 'center', 'scale']),
  v: z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale'])
})

const StrokeSchema = z.object({
  color: z.string(),
  width: z.number().min(0),
  opacity: z.number().min(0).max(1),
  position: z.enum(['center', 'inside', 'outside']),
  dash: z.enum(['solid', 'dashed', 'dotted']).optional()
})

const ArrowheadSchema = z.enum(['none', 'arrow', 'triangle', 'circle', 'bar', 'diamond'])

const AgentNoteSchema = z
  .object({
    kind: z.enum(['critique', 'decision', 'todo', 'question', 'rationale']),
    body: z.string().min(1),
    source: z.enum(['agent', 'critic', 'repair', 'user', 'system']).optional(),
    severity: z.enum(['info', 'warning', 'error']).optional(),
    targetIds: z.array(z.string()).optional(),
    directionId: z.string().optional(),
    createdAt: z.string().optional(),
    resolved: z.boolean().optional()
  })
  .strict()

const RunningAppFrameSchema = z
  .object({
    url: z.string().min(1),
    title: z.string().optional(),
    routePath: z.string().optional(),
    sourceFile: z.string().optional(),
    componentName: z.string().optional(),
    capturedAt: z.string().optional(),
    status: z.enum(['unknown', 'reachable', 'unreachable']).optional()
  })
  .strict()

/** Value schema for a `type` design token (reusable text style). */
export const TextStyleSpecSchema = z
  .object({
    fontSize: z.number().positive().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontFamily: z.string().optional(),
    lineHeight: z.number().positive().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    fontColor: z.string().optional()
  })
  .strict()

const PartialShapeSchema = z
  .object({
    type: ShapeTypeSchema,
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(FillSchema).optional(),
    strokes: z.array(StrokeSchema).optional(),
    cornerRadius: z.number().min(0).optional(),
    textContent: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontColor: z.string().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().positive().optional(),
    imageUrl: z.string().optional(),
    aiImageHolder: z.boolean().optional(),
    clipContent: z.boolean().optional(),
    points: z.array(PointSchema).optional(),
    arrowheadStart: ArrowheadSchema.optional(),
    arrowheadEnd: ArrowheadSchema.optional(),
    shadows: z.array(ShadowSchema).optional(),
    blendMode: BlendModeSchema.optional(),
    layout: AutoLayoutSchema.optional(),
    constraints: ConstraintsSchema.optional(),
    agentNote: AgentNoteSchema.optional(),
    runningApp: RunningAppFrameSchema.optional()
  })
  .strict()

const PatchSchema = z
  .object({
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(FillSchema).optional(),
    strokes: z.array(StrokeSchema).optional(),
    cornerRadius: z.number().min(0).optional(),
    textContent: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    fontColor: z.string().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().positive().optional(),
    imageUrl: z.string().optional(),
    aiImageHolder: z.boolean().optional(),
    clipContent: z.boolean().optional(),
    points: z.array(PointSchema).optional(),
    arrowheadStart: ArrowheadSchema.optional(),
    arrowheadEnd: ArrowheadSchema.optional(),
    shadows: z.array(ShadowSchema).optional(),
    blendMode: BlendModeSchema.optional(),
    layout: AutoLayoutSchema.optional(),
    constraints: ConstraintsSchema.optional(),
    agentNote: AgentNoteSchema.optional(),
    runningApp: RunningAppFrameSchema.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional()
  })
  .strict()

/** Style-only fields for the batch `set-style` op (no geometry/structure). */
const StyleSchema = z
  .object({
    fills: z.array(FillSchema).optional(),
    strokes: z.array(StrokeSchema).optional(),
    cornerRadius: z.number().min(0).optional(),
    opacity: z.number().min(0).max(1).optional(),
    shadows: z.array(ShadowSchema).optional(),
    blendMode: BlendModeSchema.optional(),
    fontColor: z.string().optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.number().min(100).max(900).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().positive().optional()
  })
  .strict()

const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const ShapeOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), shape: PartialShapeSchema, parentId: z.string().optional() }),
  z.object({ op: z.literal('update'), id: z.string(), patch: PatchSchema }),
  z.object({ op: z.literal('delete'), id: z.string() }),
  z.object({
    op: z.literal('reparent'),
    id: z.string(),
    newParentId: z.string(),
    index: z.number().int().nonnegative().optional()
  }),
  z.object({ op: z.literal('move'), ids: z.array(z.string()).min(1), dx: z.number(), dy: z.number() }),
  z.object({ op: z.literal('resize'), id: z.string(), bounds: BoundsSchema }),
  z.object({
    op: z.literal('align'),
    ids: z.array(z.string()).min(2),
    axis: z.enum(['left', 'h-center', 'right', 'top', 'v-center', 'bottom'])
  }),
  z.object({
    op: z.literal('distribute'),
    ids: z.array(z.string()).min(3),
    axis: z.enum(['horizontal', 'vertical'])
  }),
  z.object({
    op: z.literal('add-screen'),
    name: z.string(),
    brief: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    devicePreset: z.enum(['mobile', 'tablet', 'desktop']).optional()
  }),
  z.object({
    op: z.literal('duplicate'),
    id: z.string(),
    count: z.number().int().positive().max(20).optional(),
    offset: z.object({ dx: z.number(), dy: z.number() }).optional()
  }),
  z.object({
    op: z.literal('reorder'),
    id: z.string(),
    action: z.enum(['front', 'back', 'forward', 'backward'])
  }),
  z.object({
    op: z.literal('group'),
    ids: z.array(z.string()).min(1),
    name: z.string().optional(),
    /** Wrap into a `frame` (clips, can carry a fill/layout) instead of a bare `group`. */
    asFrame: z.boolean().optional()
  }),
  z.object({ op: z.literal('ungroup'), id: z.string() }),
  z.object({
    op: z.literal('set-style'),
    ids: z.array(z.string()).min(1),
    style: StyleSchema
  }),
  z.object({
    op: z.literal('auto-layout'),
    id: z.string(),
    layout: PartialAutoLayoutSchema.optional(),
    /** Remove the layout instead of (re)applying one. */
    clear: z.boolean().optional()
  }),
  z.object({
    op: z.literal('define-token'),
    name: z.string().min(1),
    kind: z.enum(['color', 'gradient', 'type', 'space', 'radius', 'shadow']),
    /** Shape depends on `kind`; validated per-kind in the executor. */
    value: z.unknown()
  }),
  z.object({ op: z.literal('delete-token'), name: z.string().min(1) }),
  z.object({
    op: z.literal('apply-token'),
    ids: z.array(z.string()).min(1),
    prop: z.enum(['fill', 'stroke', 'text-color', 'font', 'radius', 'shadow', 'gap', 'padding']),
    token: z.string().min(1)
  }),
  z.object({
    op: z.literal('define-component'),
    name: z.string().min(1),
    fromId: z.string(),
    slots: z
      .array(
        z.object({
          path: z.string(),
          kind: z.enum(['text', 'image', 'color', 'visible']),
          label: z.string().optional()
        })
      )
      .default([])
  }),
  z.object({ op: z.literal('delete-component'), name: z.string().min(1) }),
  z.object({
    op: z.literal('set-component-variant'),
    name: z.string().min(1),
    key: z.string().min(1),
    selection: z.record(z.string(), z.string()),
    overrides: z.record(z.string(), z.record(z.string(), z.unknown()))
  }),
  z.object({
    op: z.literal('instantiate'),
    name: z.string().min(1),
    variant: z.string().optional(),
    at: z.object({ x: z.number(), y: z.number() }).optional(),
    parentId: z.string().optional(),
    overrides: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    op: z.literal('instantiate-many'),
    name: z.string().min(1),
    variant: z.string().optional(),
    data: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    layout: z
      .object({
        kind: z.enum(['grid', 'row', 'column']).optional(),
        cols: z.number().int().positive().optional(),
        gap: z.number().min(0).optional()
      })
      .optional(),
    at: z.object({ x: z.number(), y: z.number() }).optional(),
    parentId: z.string().optional()
  }),
  z.object({ op: z.literal('detach'), id: z.string() }),
  z.object({ op: z.literal('update-component'), name: z.string().min(1), fromId: z.string() }),
  z.object({
    op: z.literal('add-screens'),
    specs: z
      .array(
        z.object({
          name: z.string(),
          brief: z.string().optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().positive().optional(),
          height: z.number().positive().optional(),
          devicePreset: z.enum(['mobile', 'tablet', 'desktop']).optional()
        })
      )
      .min(1)
      .max(20)
  }),
  z.object({
    op: z.literal('bulk-edit'),
    filter: z.object({
      type: ShapeTypeSchema.optional(),
      nameContains: z.string().optional(),
      boundToken: z.string().optional(),
      component: z.string().optional(),
      inFrame: z.string().optional()
    }),
    set: StyleSchema
  }),
  z.object({
    op: z.literal('grid'),
    id: z.string(),
    cols: z.number().int().positive(),
    rowGap: z.number().min(0).optional(),
    colGap: z.number().min(0).optional()
  }),
  z.object({
    op: z.literal('stack'),
    ids: z.array(z.string()).min(1),
    direction: z.enum(['horizontal', 'vertical']),
    gap: z.number().min(0).optional(),
    name: z.string().optional(),
    asFrame: z.boolean().optional()
  }),
  z.object({
    op: z.literal('apply-theme'),
    ids: z.array(z.string()).min(1),
    /** oldToken → newToken: rebinds bound props to a themed token and re-resolves. */
    remap: z.record(z.string(), z.string())
  }),
  z.object({
    op: z.literal('recolor'),
    ids: z.array(z.string()).min(1),
    /** oldHex → newHex: swaps exact solid-fill / fontColor colors across the subtree. */
    mapping: z.record(z.string(), z.string())
  }),
  z.object({
    op: z.literal('responsive-reflow'),
    frameId: z.string(),
    device: z.enum(['mobile', 'tablet', 'desktop'])
  }),
  z.object({
    op: z.literal('variant-matrix'),
    baseId: z.string(),
    devices: z.array(z.enum(['mobile', 'tablet', 'desktop'])).optional(),
    themes: z
      .array(z.object({ name: z.string(), remap: z.record(z.string(), z.string()) }))
      .optional(),
    gap: z.number().min(0).optional(),
    at: z.object({ x: z.number(), y: z.number() }).optional()
  }),
  z.object({
    op: z.literal('design-system-template'),
    operation: z.enum(['create', 'update', 'apply', 'validate']).default('create'),
    expectedHash: z.string().optional(),
    name: z.string().optional(),
    seedColor: z.string().optional(),
    mode: z.enum(['light', 'dark', 'both']).optional(),
    template: z.enum(['app', 'saas', 'game', 'editor', 'mobile', 'portfolio']).optional(),
    tone: z.enum(['clean', 'playful', 'premium', 'technical', 'editorial']).optional(),
    sections: z
      .array(
        z.enum([
          'palette',
          'typography',
          'buttons',
          'forms',
          'navigation',
          'cards',
          'icons',
          'states',
          'spacing',
          'radius',
          'shadow'
        ])
      )
      .optional(),
    targetIds: z.array(z.string()).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    dryRun: z.boolean().optional()
  }),
  z.object({
    op: z.literal('lint-design-system'),
    targetIds: z.array(z.string()).optional()
  })
])

export type ShapeOp = z.infer<typeof ShapeOpSchema>

export type OpError = {
  code:
    | 'INVALID_OP'
    | 'SHAPE_NOT_FOUND'
    | 'PARENT_NOT_FOUND'
    | 'WOULD_CYCLE'
    | 'UNSUPPORTED_TYPE'
    | 'INVALID_MOTION_OP'
    | 'MOTION_BATCH_LIMIT'
    | 'MOTION_FRAME_NOT_FOUND'
    | 'MOTION_TARGET_NOT_FOUND'
    | 'MOTION_FRAME_SCOPE'
    | 'MOTION_LIMIT_EXCEEDED'
  message: string
  suggestion?: string
}

export type ExecuteResult = {
  ok: boolean
  affectedIds: string[]
  errors: OpError[]
}

export type ExecuteOpsOptions = {
  /** Select ids before the undo group closes so redo restores the post-op selection. */
  selectAfter?: (affectedIds: string[]) => string[]
  /** One-shot lint findings key, used to keep Code sidebar feedback separate from Design mode. */
  lintFeedbackKey?: string
  /**
   * Code-mode whiteboards do not own HTML screen artifacts. When a model still
   * emits screen ops there, land them as normal editable frames instead.
   */
  screenFallback?: 'plain-frame'
  /** Apply theme-aware, Excalidraw-like defaults when Code whiteboard ops omit style fields. */
  shapePreset?: CanvasShapePreset
}
