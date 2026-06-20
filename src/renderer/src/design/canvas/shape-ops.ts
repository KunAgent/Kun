/**
 * The structured shape-operation interface. The AI Rail emits these as JSON,
 * the inspector commits them, the executor wraps the whole batch in one
 * `withUndoGroup` so a single Cmd+Z reverts the entire batch.
 *
 * Errors are returned as `{ code, message, suggestion? }` so the AI can
 * self-correct in one turn instead of throwing.
 */
import { z } from 'zod'
import type { CanvasShape, ShapeType } from './canvas-types'
import { createDefaultShape } from './canvas-types'
import { useCanvasShapeStore } from './canvas-shape-store'
import { useCanvasUndoStore } from './canvas-undo-store'
import {
  alignShapes,
  distributeShapes,
  type AlignAxis,
  type DistributeAxis
} from './canvas-align'

const ShapeTypeSchema = z.enum(['rect', 'ellipse', 'text', 'image', 'frame', 'group'])

const FillSchema = z.object({
  type: z.literal('solid'),
  color: z.string(),
  opacity: z.number().min(0).max(1)
})

const StrokeSchema = z.object({
  color: z.string(),
  width: z.number().min(0),
  opacity: z.number().min(0).max(1),
  position: z.enum(['center', 'inside', 'outside'])
})

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
    fontColor: z.string().optional()
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
    visible: z.boolean().optional(),
    locked: z.boolean().optional()
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

function executeOne(op: ShapeOp, affectedIds: Set<string>, errors: OpError[]): void {
  const store = useCanvasShapeStore.getState()
  switch (op.op) {
    case 'add': {
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
      store.addShape(base, op.parentId)
      affectedIds.add(base.id)
      break
    }
    case 'update': {
      if (!findShape(op.id)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      store.updateShape(op.id, op.patch)
      affectedIds.add(op.id)
      break
    }
    case 'delete': {
      if (!findShape(op.id)) {
        errors.push({
          code: 'SHAPE_NOT_FOUND',
          message: `No shape with id "${op.id}"`,
          suggestion: suggestionForMissingId(op.id)
        })
        return
      }
      store.deleteShape(op.id)
      affectedIds.add(op.id)
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
      break
    }
    case 'move': {
      for (const id of op.ids) {
        const s = findShape(id)
        if (!s) {
          errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${id}"` })
          continue
        }
        store.updateShape(id, { x: s.x + op.dx, y: s.y + op.dy })
        affectedIds.add(id)
      }
      break
    }
    case 'resize': {
      if (!findShape(op.id)) {
        errors.push({ code: 'SHAPE_NOT_FOUND', message: `No shape "${op.id}"` })
        return
      }
      store.updateShape(op.id, {
        x: op.bounds.x,
        y: op.bounds.y,
        width: op.bounds.width,
        height: op.bounds.height
      })
      affectedIds.add(op.id)
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
