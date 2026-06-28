/**
 * The structured shape-operation interface. The AI Rail emits these as JSON,
 * the inspector commits them, the executor wraps the whole batch in one
 * `withUndoGroup` so a single Cmd+Z reverts the entire batch.
 *
 * Errors are returned as `{ code, message, suggestion? }` so the AI can
 * self-correct in one turn instead of throwing.
 */
import { z } from 'zod'
import type { AutoLayout, CanvasShape, Point, Rect, ShapeType } from './canvas-types'
import { createDefaultShape, createHtmlFrameShape, createShapeId, type DevicePreset } from './canvas-types'
import { collectDescendants, useCanvasShapeStore, withDescendants } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import {
  alignShapes,
  collectiveBounds,
  distributeShapes,
  type AlignAxis,
  type DistributeAxis
} from './canvas-align'
import { computeAutoLayout, defaultAutoLayout } from './canvas-auto-layout'
import { constrainedBox } from './canvas-constraints'

import { getScreenArtifactFactory, setScreenBrief } from './screen-artifact-bridge'
import { useDesignSystemStore } from './design-system-store'
import { resolveTokenPatch, type DesignToken, type TokenProp } from './design-system-types'
import type { ComponentDef, ComponentOverrides, ComponentSlot } from './design-system-types'
import { lintDesignSystem, setLastLintFindings } from './design-lint'

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

const GradientFillSchema = z.object({
  type: z.enum(['linear', 'radial']),
  stops: z.array(GradientStopSchema).min(2),
  angle: z.number().optional(),
  opacity: z.number().min(0).max(1)
})

const FillSchema = z.union([SolidFillSchema, GradientFillSchema])

const ShadowSchema = z.object({
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
const PartialAutoLayoutSchema = z.object({
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

/** Value schema for a `type` design token (reusable text style). */
const TextStyleSpecSchema = z
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
    constraints: ConstraintsSchema.optional()
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
  z.object({
    op: z.literal('instantiate'),
    name: z.string().min(1),
    at: z.object({ x: z.number(), y: z.number() }).optional(),
    parentId: z.string().optional(),
    overrides: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    op: z.literal('instantiate-many'),
    name: z.string().min(1),
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
  z.object({ op: z.literal('lint-design-system') })
])

export type ShapeOp = z.infer<typeof ShapeOpSchema>

export type OpError = {
  code:
    | 'INVALID_OP'
    | 'SHAPE_NOT_FOUND'
    | 'PARENT_NOT_FOUND'
    | 'WOULD_CYCLE'
    | 'UNSUPPORTED_TYPE'
  message: string
  suggestion?: string
}

export type ExecuteResult = {
  ok: boolean
  affectedIds: string[]
  errors: OpError[]
}

function findShape(id: string): CanvasShape | null {
  return useCanvasShapeStore.getState().document.objects[id] ?? null
}

function listShapeIds(): string[] {
  const { objects, rootId } = useCanvasShapeStore.getState().document
  return Object.keys(objects).filter((id) => id !== rootId)
}

function suggestionForMissingId(missing: string): string {
  const ids = listShapeIds()
  const doc = useCanvasShapeStore.getState().document
  const names = ids.map((id) => `"${doc.objects[id].name}" (${id})`).slice(0, 10)
  return `Available shapes: ${names.join(', ')}`
}

const LINEAR_TYPES = new Set<ShapeType>(['arrow', 'line', 'draw'])

/**
 * Ops supply linear `points` in ABSOLUTE canvas coords (natural for the AI).
 * Convert them to the stored form: bounding box in x/y/width/height + points
 * relative to that box (matching how the drawing tools persist).
 */
function bboxRelative(pts: Point[]): {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  }
}

/**
 * Re-run auto-layout for a frame/group and write the children's new positions.
 * No-op when the shape has no layout. Called after structural edits (add /
 * reparent / delete / resize) so a laid-out container stays tidy automatically.
 */
function reflowFrame(frameId: string, affectedIds: Set<string>): void {
  const store = useCanvasShapeStore.getState()
  const objects = store.document.objects
  const frame = objects[frameId]
  if (!frame?.layout) return
  const positions = computeAutoLayout(objects, frameId)
  for (const pos of positions) {
    const child = store.document.objects[pos.id]
    if (!child) continue
    if (child.x !== pos.x || child.y !== pos.y) {
      // Children may themselves carry descendants (absolute coords) — shift the
      // whole subtree by the delta so nested content tracks the laid-out child.
      const dx = pos.x - child.x
      const dy = pos.y - child.y
      const objs = store.document.objects
      for (const id of withDescendants(objs, [pos.id])) {
        const s = objs[id]
        if (s) store.updateShape(id, { x: s.x + dx, y: s.y + dy })
      }
      affectedIds.add(pos.id)
    }
  }
}

/** Whether a shape exists and carries an auto-layout. */
function objectHasLayout(id: string): boolean {
  return Boolean(useCanvasShapeStore.getState().document.objects[id]?.layout)
}

/**
 * Reposition/resize the direct children of a just-resized frame per their
 * `constraints`. Children that have no constraints stick to top-left (the engine
 * default). A child's descendants are shifted by the same positional delta so
 * nested content tracks its constrained parent.
 */
function applyConstraintsOnResize(
  frameId: string,
  oldBounds: Rect,
  newBounds: Rect,
  affectedIds: Set<string>
): void {
  const store = useCanvasShapeStore.getState()
  const frame = store.document.objects[frameId]
  if (!frame) return
  for (const childId of [...frame.children]) {
    const child = store.document.objects[childId]
    if (!child) continue
    // Only act on children that opted into constraints — leave plain children put.
    if (!child.constraints) continue
    const box = constrainedBox(child, oldBounds, newBounds)
    const dx = box.x - child.x
    const dy = box.y - child.y
    store.updateShape(childId, { x: box.x, y: box.y, width: box.width, height: box.height })
    affectedIds.add(childId)
    if (dx !== 0 || dy !== 0) {
      const objs = store.document.objects
      for (const descId of withDescendants(objs, [childId])) {
        if (descId === childId) continue
        const d = objs[descId]
        if (d) store.updateShape(descId, { x: d.x + dx, y: d.y + dy })
      }
    }
  }
}

type PartialAutoLayout = z.infer<typeof PartialAutoLayoutSchema>

/**
 * Merge a loose layout spec over the frame's existing layout (or defaults).
 * The `padding` shorthand sets all four sides; explicit per-side values win.
 */
function mergeAutoLayout(existing: AutoLayout | undefined, partial?: PartialAutoLayout): AutoLayout {
  const base = existing ?? defaultAutoLayout()
  const pad = partial?.padding
  return {
    direction: partial?.direction ?? base.direction,
    gap: partial?.gap ?? base.gap,
    paddingTop: partial?.paddingTop ?? pad ?? base.paddingTop,
    paddingRight: partial?.paddingRight ?? pad ?? base.paddingRight,
    paddingBottom: partial?.paddingBottom ?? pad ?? base.paddingBottom,
    paddingLeft: partial?.paddingLeft ?? pad ?? base.paddingLeft,
    primaryAlign: partial?.primaryAlign ?? base.primaryAlign,
    counterAlign: partial?.counterAlign ?? base.counterAlign
  }
}

/** Validate a `define-token` value against its `kind`, returning a typed token or an error. */
function validateTokenValue(
  name: string,
  kind: DesignToken['kind'],
  value: unknown
): { token: DesignToken } | { error: string } {
  switch (kind) {
    case 'color':
      if (typeof value !== 'string' || !value.trim())
        return { error: `token "${name}" (color) needs a non-empty color string (e.g. "#3b82d8")` }
      return { token: { name, kind, value } }
    case 'space':
    case 'radius':
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { error: `token "${name}" (${kind}) needs a finite number` }
      return { token: { name, kind, value } as DesignToken }
    case 'gradient': {
      const r = GradientFillSchema.safeParse(value)
      if (!r.success)
        return { error: `token "${name}" (gradient) invalid: ${r.error.issues[0]?.message ?? 'bad value'}` }
      return { token: { name, kind, value: r.data } }
    }
    case 'shadow': {
      const r = z.array(ShadowSchema).safeParse(value)
      if (!r.success)
        return { error: `token "${name}" (shadow) invalid: ${r.error.issues[0]?.message ?? 'bad value'}` }
      return { token: { name, kind, value: r.data } }
    }
    case 'type': {
      const r = TextStyleSpecSchema.safeParse(value)
      if (!r.success)
        return { error: `token "${name}" (type) invalid: ${r.error.issues[0]?.message ?? 'bad value'}` }
      return { token: { name, kind, value: r.data } }
    }
  }
}

/**
 * Snapshot a shape subtree into a component template: clone root + descendants
 * and normalize coordinates so the root sits at (0,0) (children keep their
 * relative offset). Internal id references stay consistent within the subtree;
 * `materializeComponentInstance` remaps them to fresh ids per instance.
 */
function snapshotSubtreeAsTree(rootId: string): CanvasShape[] {
  const objects = useCanvasShapeStore.getState().document.objects
  const ids = [rootId, ...collectDescendants(objects, rootId)]
  const root = objects[rootId]
  const ox = root.x
  const oy = root.y
  return ids.map((id) => {
    const s = objects[id]
    return { ...s, x: s.x - ox, y: s.y - oy }
  })
}

/** Apply a per-instance slot override to a freshly cloned node (matched by name). */
function applyOverridesToClone(
  clone: CanvasShape,
  nodeName: string,
  slots: ComponentSlot[],
  overrides: ComponentOverrides
): void {
  for (const slot of slots) {
    if (slot.path !== nodeName) continue
    const value = overrides[slot.path]
    if (value === undefined) continue
    switch (slot.kind) {
      case 'text':
        clone.textContent = String(value)
        break
      case 'image':
        clone.imageUrl = String(value)
        break
      case 'color':
        clone.fills = [{ type: 'solid', color: String(value), opacity: 1 }]
        break
      case 'visible':
        clone.visible = Boolean(value)
        break
    }
  }
}

/**
 * Materialize one component instance onto the canvas: deep-clone the template
 * tree with fresh ids, translate it to `at`, apply slot overrides, and add the
 * subtree under `parentId` (root tagged with componentId/version/overrides so
 * `update-component`/`detach` can find it). Returns the new root id.
 */
function materializeComponentInstance(
  comp: ComponentDef,
  at: Point,
  parentId: string,
  overrides: ComponentOverrides
): string {
  const store = useCanvasShapeStore.getState()
  const byId = new Map(comp.tree.map((s) => [s.id, s]))

  function addNode(node: CanvasShape, targetParent: string, isRoot: boolean): string {
    const newId = createShapeId()
    const clone: CanvasShape = {
      ...node,
      id: newId,
      x: node.x + at.x,
      y: node.y + at.y,
      children: [],
      parentId: null,
      frameId: null,
      componentId: isRoot ? comp.id : undefined,
      componentVersion: isRoot ? comp.version : undefined,
      overrides: isRoot ? overrides : undefined
    }
    applyOverridesToClone(clone, node.name, comp.slots, overrides)
    store.addShape(clone, targetParent)
    for (const childId of node.children) {
      const child = byId.get(childId)
      if (child) addNode(child, newId, false)
    }
    return newId
  }

  return addNode(comp.tree[0], parentId, true)
}

const DEVICE_DIMS: Record<DevicePreset, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 }
}

/** Deep-clone a LIVE subtree (root + descendants) to a translated position under `parentId`. */
function cloneLiveSubtree(rootId: string, dx: number, dy: number, parentId: string): string {
  const store = useCanvasShapeStore.getState()
  const objects = store.document.objects
  function addNode(node: CanvasShape, targetParent: string): string {
    const newId = createShapeId()
    const clone: CanvasShape = {
      ...node,
      id: newId,
      x: node.x + dx,
      y: node.y + dy,
      children: [],
      parentId: null,
      frameId: null
    }
    store.addShape(clone, targetParent)
    for (const childId of node.children) {
      const child = objects[childId]
      if (child) addNode(child, newId)
    }
    return newId
  }
  return addNode(objects[rootId], parentId)
}

/** Rebind a subtree's token bindings via `remap` (oldToken → newToken) and re-resolve them. */
function rebindThemeOnSubtree(
  rootId: string,
  remap: Record<string, string>,
  affectedIds: Set<string>
): void {
  const store = useCanvasShapeStore.getState()
  const objects = store.document.objects
  const ds = useDesignSystemStore.getState()
  for (const id of [rootId, ...collectDescendants(objects, rootId)]) {
    const shape = objects[id]
    if (!shape?.tokenBindings) continue
    const newBindings = { ...shape.tokenBindings }
    const patchAcc: Partial<CanvasShape> = {}
    let changed = false
    for (const [prop, tokenName] of Object.entries(shape.tokenBindings)) {
      const newToken = remap[tokenName]
      if (!newToken) continue
      const token = ds.getToken(newToken)
      if (!token) continue
      const patch = resolveTokenPatch(token, prop as TokenProp, shape)
      if (!('error' in patch)) {
        Object.assign(patchAcc, patch)
        newBindings[prop] = newToken
        changed = true
      }
    }
    if (changed) {
      store.updateShape(id, { ...patchAcc, tokenBindings: newBindings })
      affectedIds.add(id)
    }
  }
}

/** Swap exact solid-fill / fontColor hex values across a subtree per `mapping` (oldHex → newHex). */
function recolorSubtree(
  rootId: string,
  mapping: Record<string, string>,
  affectedIds: Set<string>
): void {
  const store = useCanvasShapeStore.getState()
  const objects = store.document.objects
  for (const id of [rootId, ...collectDescendants(objects, rootId)]) {
    const shape = objects[id]
    if (!shape) continue
    const patch: Partial<CanvasShape> = {}
    let changed = false
    if (shape.fills.some((f) => f.type === 'solid' && mapping[f.color])) {
      patch.fills = shape.fills.map((f) =>
        f.type === 'solid' && mapping[f.color] ? { ...f, color: mapping[f.color] } : f
      )
      changed = true
    }
    if (shape.fontColor && mapping[shape.fontColor]) {
      patch.fontColor = mapping[shape.fontColor]
      changed = true
    }
    if (changed) {
      store.updateShape(id, patch)
      affectedIds.add(id)
    }
  }
}

/** Resize a frame to a device preset and re-apply child constraints / auto-layout. */
function responsiveReflowFrame(
  frameId: string,
  device: DevicePreset,
  affectedIds: Set<string>
): void {
  const store = useCanvasShapeStore.getState()
  const frame = store.document.objects[frameId]
  if (!frame) return
  const dims = DEVICE_DIMS[device]
  const oldBounds = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
  const newBounds = { x: frame.x, y: frame.y, width: dims.width, height: dims.height }
  store.updateShape(frameId, { width: dims.width, height: dims.height, devicePreset: device })
  applyConstraintsOnResize(frameId, oldBounds, newBounds, affectedIds)
  if (frame.layout) reflowFrame(frameId, affectedIds)
  affectedIds.add(frameId)
}

function executeOne(op: ShapeOp, affectedIds: Set<string>, errors: OpError[]): void {
  const store = useCanvasShapeStore.getState()
  switch (op.op) {
    case 'add': {
      // Validate an explicit parent up front: addShape silently no-ops when the
      // parent is missing, so without this the op would report phantom success
      // (a bogus affected id) and the agent would never learn its frame id was wrong.
      if (op.parentId && !findShape(op.parentId)) {
        errors.push({
          code: 'PARENT_NOT_FOUND',
          message: `Cannot add shape: parent "${op.parentId}" does not exist`,
          suggestion: suggestionForMissingId(op.parentId)
        })
        return
      }
      const { type } = op.shape
      const x = op.shape.x ?? 0
      const y = op.shape.y ?? 0
      const base = createDefaultShape(type as ShapeType, x, y)
      // Apply optional overrides from the op (excluding type/x/y already baked in).
      const overrides: Partial<CanvasShape> = { ...op.shape }
      delete (overrides as Record<string, unknown>).type
      delete (overrides as Record<string, unknown>).x
      delete (overrides as Record<string, unknown>).y
      Object.assign(base, overrides)
      if (LINEAR_TYPES.has(base.type) && base.points && base.points.length > 0) {
        Object.assign(base, bboxRelative(base.points))
      }
      store.addShape(base, op.parentId)
      affectedIds.add(base.id)
      if (op.parentId) reflowFrame(op.parentId, affectedIds)
      break
    }
    case 'update': {
      const existing = findShape(op.id)
      if (!existing) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      {
        const patch: Partial<CanvasShape> = { ...op.patch }
        if (LINEAR_TYPES.has(existing.type) && patch.points && patch.points.length > 0) {
          Object.assign(patch, bboxRelative(patch.points))
        }
        store.updateShape(op.id, patch)
      }
      affectedIds.add(op.id)
      break
    }
    case 'delete': {
      const target = findShape(op.id)
      if (!target) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const parentId = target.parentId
      store.deleteShape(op.id)
      affectedIds.add(op.id)
      // Closing the gap a deleted child left in a laid-out container.
      if (parentId && objectHasLayout(parentId)) reflowFrame(parentId, affectedIds)
      break
    }
    case 'reparent': {
      if (!findShape(op.id)) {
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${op.id}"` })
        return
      }
      if (!findShape(op.newParentId)) {
        errors.push({ code: 'PARENT_NOT_FOUND', message: `No parent "${op.newParentId}"` })
        return
      }
      store.reparentShape(op.id, op.newParentId, op.index)
      affectedIds.add(op.id)
      if (objectHasLayout(op.newParentId)) reflowFrame(op.newParentId, affectedIds)
      break
    }
    case 'move': {
      // Validate the explicitly-named ids, then move them AND their descendants
      // by the same delta — children store absolute coords, so a frame's move
      // must carry them along (deduped so an id named twice moves once).
      const present = op.ids.filter((id) => {
        if (findShape(id)) return true
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${id}"` })
        return false
      })
      const objects = useCanvasShapeStore.getState().document.objects
      for (const id of withDescendants(objects, present)) {
        const s = findShape(id)
        if (!s) continue
        store.updateShape(id, { x: s.x + op.dx, y: s.y + op.dy })
        affectedIds.add(id)
      }
      break
    }
    case 'resize': {
      const target = findShape(op.id)
      if (!target) {
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${op.id}"` })
        return
      }
      const oldBounds = { x: target.x, y: target.y, width: target.width, height: target.height }
      const newBounds = {
        x: op.bounds.x,
        y: op.bounds.y,
        width: op.bounds.width,
        height: op.bounds.height
      }
      store.updateShape(op.id, newBounds)
      affectedIds.add(op.id)
      if (target.layout) {
        // Auto-layout owns child positions — re-flow to the new box.
        reflowFrame(op.id, affectedIds)
      } else if (target.type === 'frame' || target.type === 'group') {
        // Otherwise honor each child's resize constraints.
        applyConstraintsOnResize(op.id, oldBounds, newBounds, affectedIds)
      }
      break
    }
    case 'align': {
      const doc = useCanvasShapeStore.getState().document
      const shapes = op.ids
        .map((id) => doc.objects[id])
        .filter((s): s is CanvasShape => Boolean(s))
        .map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      if (shapes.length < 2) {
        errors.push({ code: 'INVALID_OP', message: 'align requires ≥2 valid shapes' })
        return
      }
      const out = alignShapes(shapes, op.axis as AlignAxis)
      for (const [id, patch] of out) {
        store.updateShape(id, patch)
        affectedIds.add(id)
      }
      break
    }
    case 'distribute': {
      const doc = useCanvasShapeStore.getState().document
      const shapes = op.ids
        .map((id) => doc.objects[id])
        .filter((s): s is CanvasShape => Boolean(s))
        .map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      if (shapes.length < 3) {
        errors.push({ code: 'INVALID_OP', message: 'distribute requires ≥3 valid shapes' })
        return
      }
      const out = distributeShapes(shapes, op.axis as DistributeAxis)
      for (const [id, patch] of out) {
        store.updateShape(id, patch)
        affectedIds.add(id)
      }
      break
    }
    case 'duplicate': {
      if (!findShape(op.id)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const count = Math.max(1, Math.min(op.count ?? 1, 20))
      const dx = op.offset?.dx ?? 24
      const dy = op.offset?.dy ?? 24
      for (let i = 0; i < count; i += 1) {
        const newId = store.duplicateShape(op.id)
        if (!newId) {
          errors.push({ code: 'INVALID_OP', message: `Cannot duplicate "${op.id}" (root or detached shapes can't be duplicated)` })
          break
        }
        // Stagger each copy so duplicates don't stack exactly on the original.
        // Children store ABSOLUTE coords, so the whole clone subtree shifts together.
        if (dx !== 0 || dy !== 0) {
          const objects = useCanvasShapeStore.getState().document.objects
          const step = i + 1
          for (const cloneId of withDescendants(objects, [newId])) {
            const cs = objects[cloneId]
            if (cs) store.updateShape(cloneId, { x: cs.x + dx * step, y: cs.y + dy * step })
          }
        }
        affectedIds.add(newId)
      }
      break
    }
    case 'reorder': {
      const shape = findShape(op.id)
      if (!shape) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const parent = shape.parentId ? findShape(shape.parentId) : null
      const siblings = parent?.children ?? []
      const current = siblings.indexOf(op.id)
      if (!parent || current < 0) {
        errors.push({ code: 'INVALID_OP', message: `Shape "${op.id}" has no parent layer order to change` })
        return
      }
      const last = siblings.length - 1
      const target =
        op.action === 'front'
          ? last
          : op.action === 'back'
            ? 0
            : op.action === 'forward'
              ? Math.min(last, current + 1)
              : Math.max(0, current - 1)
      if (target !== current) store.reorderShape(op.id, target)
      affectedIds.add(op.id)
      break
    }
    case 'add-screen': {
      const factory = getScreenArtifactFactory()
      const artifactId = factory?.(op.name) ?? null
      if (!artifactId) {
        errors.push({ code: 'INVALID_OP', message: 'Cannot create screen artifact — no handler registered' })
        return
      }
      const preset = (op.devicePreset ?? 'desktop') as DevicePreset
      const shape = createHtmlFrameShape(op.name, op.x ?? 0, op.y ?? 0, artifactId, preset)
      if (op.width) shape.width = op.width
      if (op.height) shape.height = op.height
      store.addShape(shape)
      // Keep the agent's expanded brief so the follow-up HTML-generation turn
      // designs from it instead of the raw user prompt (see the turn-complete hook).
      if (op.brief) setScreenBrief(shape.id, op.brief)
      affectedIds.add(shape.id)
      break
    }
    case 'group': {
      const doc0 = useCanvasShapeStore.getState().document
      const members = op.ids
        .map((id) => doc0.objects[id])
        .filter((s): s is CanvasShape => Boolean(s) && s.id !== doc0.rootId)
      if (members.length === 0) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `group: none of [${op.ids.join(', ')}] exist`,
          suggestion: suggestionForMissingId(op.ids[0])
        })
        return
      }
      // The group lands under the first member's parent so it sits where the
      // content already is; bounds wrap the whole selection.
      const parentId = members[0].parentId ?? doc0.rootId
      const bounds = collectiveBounds(
        members.map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      )
      const container = createDefaultShape(op.asFrame ? 'frame' : 'group', bounds.x, bounds.y)
      container.name = op.name ?? (op.asFrame ? 'Frame' : 'Group')
      container.width = bounds.width
      container.height = bounds.height
      if (op.asFrame) {
        container.clipContent = false
      } else {
        container.fills = []
      }
      store.addShape(container, parentId)
      // Reparent members into the container, preserving their on-canvas order.
      for (const m of members) {
        store.reparentShape(m.id, container.id)
        affectedIds.add(m.id)
      }
      affectedIds.add(container.id)
      break
    }
    case 'ungroup': {
      const group = findShape(op.id)
      if (!group) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      const grandparentId = group.parentId
      if (!grandparentId) {
        errors.push({ code: 'INVALID_OP', message: `Cannot ungroup "${op.id}" — it has no parent to lift children into` })
        return
      }
      // Snapshot children first: reparenting mutates group.children as we go.
      const childIds = [...group.children]
      for (const childId of childIds) {
        store.reparentShape(childId, grandparentId)
        affectedIds.add(childId)
      }
      store.deleteShape(op.id)
      affectedIds.add(op.id)
      if (objectHasLayout(grandparentId)) reflowFrame(grandparentId, affectedIds)
      break
    }
    case 'set-style': {
      const present = op.ids.filter((id) => {
        if (findShape(id)) return true
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${id}"`, suggestion: suggestionForMissingId(id) })
        return false
      })
      if (present.length === 0) return
      const patch = op.style as Partial<CanvasShape>
      for (const id of present) {
        store.updateShape(id, patch)
        affectedIds.add(id)
      }
      break
    }
    case 'auto-layout': {
      const frame = findShape(op.id)
      if (!frame) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      if (frame.type !== 'frame' && frame.type !== 'group') {
        errors.push({
          code: 'UNSUPPORTED_TYPE',
          message: `auto-layout needs a frame or group, got "${frame.type}"`,
          suggestion: 'Group the shapes first (op "group"), then auto-layout the group.'
        })
        return
      }
      if (op.clear) {
        store.updateShape(op.id, { layout: undefined })
        affectedIds.add(op.id)
        break
      }
      const merged = mergeAutoLayout(frame.layout, op.layout)
      store.updateShape(op.id, { layout: merged })
      affectedIds.add(op.id)
      reflowFrame(op.id, affectedIds)
      break
    }
    case 'define-token': {
      const validated = validateTokenValue(op.name, op.kind, op.value)
      if ('error' in validated) {
        errors.push({ code: 'INVALID_OP', message: validated.error })
        return
      }
      const ds = useDesignSystemStore.getState()
      const existed = Boolean(ds.getToken(op.name))
      ds.setToken(validated.token)
      // Editing an existing token re-resolves every shape bound to it, so a
      // single palette change ripples through the whole design (one undo batch).
      if (existed) {
        for (const id of listShapeIds()) {
          const shape = findShape(id)
          if (!shape?.tokenBindings) continue
          for (const [boundProp, boundToken] of Object.entries(shape.tokenBindings)) {
            if (boundToken !== op.name) continue
            const patch = resolveTokenPatch(validated.token, boundProp as TokenProp, shape)
            if (!('error' in patch)) {
              store.updateShape(id, patch)
              affectedIds.add(id)
            }
          }
        }
      }
      break
    }
    case 'apply-token': {
      const ds = useDesignSystemStore.getState()
      const token = ds.getToken(op.token)
      if (!token) {
        const names = ds.listTokens().map((t) => t.name).slice(0, 20)
        errors.push({
          code: 'INVALID_OP',
          message: `Unknown token "${op.token}"`,
          suggestion: names.length
            ? `Available tokens: ${names.join(', ')}`
            : 'No tokens defined yet — call define-token first.'
        })
        break
      }
      for (const id of op.ids) {
        const shape = findShape(id)
        if (!shape) {
          errors.push({
            code: 'SHAPE_NOT_FOUND',
            message: `No shape with id "${id}"`,
            suggestion: suggestionForMissingId(id)
          })
          continue
        }
        const patch = resolveTokenPatch(token, op.prop, shape)
        if ('error' in patch) {
          errors.push({ code: 'INVALID_OP', message: patch.error })
          continue
        }
        const tokenBindings = { ...(shape.tokenBindings ?? {}), [op.prop]: op.token }
        store.updateShape(id, { ...patch, tokenBindings })
        affectedIds.add(id)
      }
      break
    }
    case 'define-component': {
      const root = findShape(op.fromId)
      if (!root) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.fromId}" to define component "${op.name}" from`,
          suggestion: suggestionForMissingId(op.fromId)
        })
        return
      }
      const ds = useDesignSystemStore.getState()
      const existing = ds.getComponent(op.name)
      ds.setComponent({
        id: existing?.id ?? createShapeId(),
        name: op.name,
        version: (existing?.version ?? 0) + 1,
        tree: snapshotSubtreeAsTree(op.fromId),
        slots: op.slots
      })
      // Defining a component does not mutate the canvas; nothing affected.
      break
    }
    case 'instantiate': {
      const ds = useDesignSystemStore.getState()
      const comp = ds.getComponent(op.name)
      if (!comp) {
        const names = ds.listComponents().map((c) => c.name).slice(0, 20)
        errors.push({
          code: 'INVALID_OP',
          message: `Unknown component "${op.name}"`,
          suggestion: names.length
            ? `Available components: ${names.join(', ')}`
            : 'No components defined yet — call define-component first.'
        })
        break
      }
      if (op.parentId && !findShape(op.parentId)) {
        errors.push({
          code: 'PARENT_NOT_FOUND',
          message: `No parent with id "${op.parentId}"`,
          suggestion: suggestionForMissingId(op.parentId)
        })
        break
      }
      const parentId = op.parentId ?? store.document.rootId
      const at = op.at ?? { x: 0, y: 0 }
      affectedIds.add(materializeComponentInstance(comp, at, parentId, op.overrides ?? {}))
      break
    }
    case 'instantiate-many': {
      const ds = useDesignSystemStore.getState()
      const comp = ds.getComponent(op.name)
      if (!comp) {
        const names = ds.listComponents().map((c) => c.name).slice(0, 20)
        errors.push({
          code: 'INVALID_OP',
          message: `Unknown component "${op.name}"`,
          suggestion: names.length
            ? `Available components: ${names.join(', ')}`
            : 'No components defined yet — call define-component first.'
        })
        break
      }
      if (op.parentId && !findShape(op.parentId)) {
        errors.push({
          code: 'PARENT_NOT_FOUND',
          message: `No parent with id "${op.parentId}"`,
          suggestion: suggestionForMissingId(op.parentId)
        })
        break
      }
      const parentId = op.parentId ?? store.document.rootId
      const tpl = comp.tree[0]
      const itemW = tpl.width
      const itemH = tpl.height
      const gap = op.layout?.gap ?? 16
      const kind = op.layout?.kind ?? 'grid'
      const n = op.data.length
      const cols =
        kind === 'row'
          ? n
          : kind === 'column'
            ? 1
            : op.layout?.cols ?? Math.max(1, Math.ceil(Math.sqrt(n)))
      const at = op.at ?? { x: 0, y: 0 }
      for (let i = 0; i < n; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        const cellAt = { x: at.x + col * (itemW + gap), y: at.y + row * (itemH + gap) }
        affectedIds.add(materializeComponentInstance(comp, cellAt, parentId, op.data[i]))
      }
      break
    }
    case 'detach': {
      const shape = findShape(op.id)
      if (!shape) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      store.updateShape(op.id, {
        componentId: undefined,
        componentVersion: undefined,
        overrides: undefined
      })
      affectedIds.add(op.id)
      break
    }
    case 'update-component': {
      const ds = useDesignSystemStore.getState()
      const comp = ds.getComponent(op.name)
      if (!comp) {
        errors.push({ code: 'INVALID_OP', message: `Unknown component "${op.name}"` })
        break
      }
      if (!findShape(op.fromId)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.fromId}" to update component "${op.name}" from`,
          suggestion: suggestionForMissingId(op.fromId)
        })
        return
      }
      const updated: ComponentDef = {
        ...comp,
        version: comp.version + 1,
        tree: snapshotSubtreeAsTree(op.fromId)
      }
      ds.setComponent(updated)
      // Re-materialize every other instance, preserving its position + overrides,
      // so a master edit ripples through the design (the fromId master stays put).
      const objects = useCanvasShapeStore.getState().document.objects
      const instances = Object.values(objects).filter(
        (s) => s.componentId === comp.id && s.id !== op.fromId
      )
      for (const inst of instances) {
        const at = { x: inst.x, y: inst.y }
        const parentId = inst.parentId ?? store.document.rootId
        const overrides = (inst.overrides as ComponentOverrides | undefined) ?? {}
        store.deleteShape(inst.id)
        affectedIds.add(materializeComponentInstance(updated, at, parentId, overrides))
      }
      break
    }
    case 'add-screens': {
      const factory = getScreenArtifactFactory()
      if (!factory) {
        errors.push({ code: 'INVALID_OP', message: 'Cannot create screen artifacts — no handler registered' })
        return
      }
      let cursorX = 0
      for (const spec of op.specs) {
        const artifactId = factory(spec.name)
        if (!artifactId) {
          errors.push({ code: 'INVALID_OP', message: `Cannot create screen artifact for "${spec.name}"` })
          continue
        }
        const preset = (spec.devicePreset ?? 'desktop') as DevicePreset
        const x = spec.x ?? cursorX
        const y = spec.y ?? 0
        const shape = createHtmlFrameShape(spec.name, x, y, artifactId, preset)
        if (spec.width) shape.width = spec.width
        if (spec.height) shape.height = spec.height
        store.addShape(shape)
        if (spec.brief) setScreenBrief(shape.id, spec.brief)
        affectedIds.add(shape.id)
        cursorX = x + shape.width + 80 // lay successive screens out in a row
      }
      break
    }
    case 'bulk-edit': {
      const objects = useCanvasShapeStore.getState().document.objects
      const f = op.filter
      const compId = f.component
        ? useDesignSystemStore.getState().getComponent(f.component)?.id
        : undefined
      const nameNeedle = f.nameContains?.toLowerCase()
      const matches = Object.values(objects).filter((s) => {
        if (s.id === store.document.rootId) return false
        if (f.type && s.type !== f.type) return false
        if (nameNeedle && !s.name.toLowerCase().includes(nameNeedle)) return false
        if (f.boundToken && !Object.values(s.tokenBindings ?? {}).includes(f.boundToken)) return false
        if (f.component && s.componentId !== compId) return false
        if (f.inFrame && s.frameId !== f.inFrame && s.parentId !== f.inFrame) return false
        return true
      })
      if (matches.length === 0) {
        errors.push({
          code: 'INVALID_OP',
          message: 'bulk-edit matched no shapes',
          suggestion: 'Loosen the filter (type/nameContains/component/boundToken/inFrame).'
        })
        break
      }
      const patch = op.set as Partial<CanvasShape>
      for (const s of matches) {
        store.updateShape(s.id, patch)
        affectedIds.add(s.id)
      }
      break
    }
    case 'grid': {
      const frame = findShape(op.id)
      if (!frame) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      if (frame.type !== 'frame' && frame.type !== 'group') {
        errors.push({
          code: 'UNSUPPORTED_TYPE',
          message: `grid needs a frame or group, got "${frame.type}"`,
          suggestion: 'Group the shapes first (op "group" or "stack"), then grid the container.'
        })
        return
      }
      const objs = useCanvasShapeStore.getState().document.objects
      const children = frame.children
        .map((id) => objs[id])
        .filter((s): s is CanvasShape => Boolean(s))
      if (children.length === 0) break
      const cellW = Math.max(...children.map((c) => c.width))
      const cellH = Math.max(...children.map((c) => c.height))
      const colGap = op.colGap ?? 16
      const rowGap = op.rowGap ?? 16
      children.forEach((child, i) => {
        const col = i % op.cols
        const row = Math.floor(i / op.cols)
        const nx = frame.x + col * (cellW + colGap)
        const ny = frame.y + row * (cellH + rowGap)
        const dx = nx - child.x
        const dy = ny - child.y
        if (dx !== 0 || dy !== 0) {
          const all = useCanvasShapeStore.getState().document.objects
          for (const id of withDescendants(all, [child.id])) {
            const s = all[id]
            if (s) store.updateShape(id, { x: s.x + dx, y: s.y + dy })
          }
        }
        affectedIds.add(child.id)
      })
      break
    }
    case 'stack': {
      const doc0 = useCanvasShapeStore.getState().document
      const members = op.ids
        .map((id) => doc0.objects[id])
        .filter((s): s is CanvasShape => Boolean(s) && s.id !== doc0.rootId)
      if (members.length === 0) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `stack: none of [${op.ids.join(', ')}] exist`,
          suggestion: suggestionForMissingId(op.ids[0])
        })
        return
      }
      const parentId = members[0].parentId ?? doc0.rootId
      const bounds = collectiveBounds(
        members.map((s) => ({ id: s.id, x: s.x, y: s.y, width: s.width, height: s.height }))
      )
      const container = createDefaultShape(op.asFrame ? 'frame' : 'group', bounds.x, bounds.y)
      container.name = op.name ?? 'Stack'
      container.width = bounds.width
      container.height = bounds.height
      if (op.asFrame) container.clipContent = false
      else container.fills = []
      container.layout = mergeAutoLayout(undefined, { direction: op.direction, gap: op.gap })
      store.addShape(container, parentId)
      for (const m of members) {
        store.reparentShape(m.id, container.id)
        affectedIds.add(m.id)
      }
      affectedIds.add(container.id)
      reflowFrame(container.id, affectedIds)
      break
    }
    case 'apply-theme': {
      for (const id of op.ids) {
        if (!findShape(id)) {
          errors.push({
            code: 'SHAPE_NOT_FOUND',
            message: `No shape with id "${id}"`,
            suggestion: suggestionForMissingId(id)
          })
          continue
        }
        rebindThemeOnSubtree(id, op.remap, affectedIds)
      }
      break
    }
    case 'recolor': {
      for (const id of op.ids) {
        if (!findShape(id)) {
          errors.push({
            code: 'SHAPE_NOT_FOUND',
            message: `No shape with id "${id}"`,
            suggestion: suggestionForMissingId(id)
          })
          continue
        }
        recolorSubtree(id, op.mapping, affectedIds)
      }
      break
    }
    case 'responsive-reflow': {
      if (!findShape(op.frameId)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.frameId}"`,
          suggestion: suggestionForMissingId(op.frameId)
        })
        return
      }
      responsiveReflowFrame(op.frameId, op.device, affectedIds)
      break
    }
    case 'variant-matrix': {
      const base = findShape(op.baseId)
      if (!base) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No base shape with id "${op.baseId}"`,
          suggestion: suggestionForMissingId(op.baseId)
        })
        return
      }
      const parentId = base.parentId ?? store.document.rootId
      const devices = op.devices && op.devices.length ? op.devices : [base.devicePreset ?? 'desktop']
      const themes = op.themes && op.themes.length ? op.themes : [{ name: 'default', remap: {} }]
      const gap = op.gap ?? 80
      const at = op.at ?? { x: base.x, y: base.y + base.height + gap }
      let cursorY = at.y
      for (const theme of themes) {
        let cursorX = at.x
        let rowH = 0
        for (const device of devices) {
          const dims = DEVICE_DIMS[device]
          const cloneRoot = cloneLiveSubtree(op.baseId, cursorX - base.x, cursorY - base.y, parentId)
          responsiveReflowFrame(cloneRoot, device, affectedIds)
          if (Object.keys(theme.remap).length > 0) {
            rebindThemeOnSubtree(cloneRoot, theme.remap, affectedIds)
          }
          affectedIds.add(cloneRoot)
          cursorX += dims.width + gap
          rowH = Math.max(rowH, dims.height)
        }
        cursorY += rowH + gap
      }
      break
    }
    case 'lint-design-system': {
      // Pure analysis — stash findings for the next turn's prompt (no mutation).
      setLastLintFindings(
        lintDesignSystem(
          useCanvasShapeStore.getState().document,
          useDesignSystemStore.getState().system
        )
      )
      break
    }
    default: {
      const exhaustive: never = op
      errors.push({ code: 'INVALID_OP', message: `Unknown op: ${JSON.stringify(exhaustive)}` })
    }
  }
}

/** Execute a batch of operations atomically. Returns affected ids + structured errors. */
export function executeOps(rawOps: unknown[], label = 'shape-ops'): ExecuteResult {
  const affectedIds = new Set<string>()
  const errors: OpError[] = []

  // Validate every op first; collect errors but don't abort — let the user see all problems.
  const validatedOps: ShapeOp[] = []
  for (let i = 0; i < rawOps.length; i++) {
    const parsed = ShapeOpSchema.safeParse(rawOps[i])
    if (!parsed.success) {
      errors.push({
        code: 'INVALID_OP',
        message: `Op #${i}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
      })
      continue
    }
    validatedOps.push(parsed.data)
  }

  if (validatedOps.length === 0) {
    return { ok: errors.length === 0, affectedIds: [], errors }
  }

  useCanvasUndoStore.getState().withGroup(label, () => {
    for (const op of validatedOps) {
      executeOne(op, affectedIds, errors)
    }
  })

  return {
    ok: errors.length === 0,
    affectedIds: Array.from(affectedIds),
    errors
  }
}
