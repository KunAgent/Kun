/**
 * Token-economic canvas snapshot for the AI. Drops transform matrices and other
 * rendering noise and uses parent NAMES instead of opaque ids so the AI can
 * reason about layer structure in human terms — but DOES carry a compact color
 * digest (primary fill / stroke / fontColor / cornerRadius) so a visual agent
 * can match the existing palette and styling instead of guessing.
 *
 * The id is still included so the AI can target shapes precisely in ShapeOps.
 */
import { fillColor, isImplicitImageSlot } from './canvas-types'
import type { CanvasDocument, CanvasShape, Point } from './canvas-types'

export type CanvasSnapshotShape = {
  id: string
  name: string
  type: CanvasShape['type']
  x: number
  y: number
  w: number
  h: number
  rotation?: number
  parentName: string | null
  textContent?: string
  htmlArtifactId?: string
  /** True when this shape is in the user's current selection (what "this"/"here" refers to). */
  selected?: boolean
  /**
   * True when this shape is an AI image slot the agent should fill on request —
   * either explicitly marked (`aiImageHolder`) or an empty box the user has
   * currently selected (auto-detected, so no manual marking is needed).
   */
  aiImageHolder?: boolean
  /**
   * Workspace-relative path of the picture already in this image shape
   * (e.g. `.deepseekgui-images/img-….png`). Present only on `image` shapes
   * that have been filled — empty image holders omit it. The agent passes
   * this path back into `generate_image` as `reference_image_paths` when the
   * user asks to edit/restyle/redo the existing picture.
   */
  imageUrl?: string

  /** Primary fill color (hex) when the shape has a visible fill. */
  fill?: string
  /** Gradient summary (e.g. `linear 90deg #a→#b`) for gradient-filled shapes. */
  gradient?: string
  /** Primary stroke as `color/width` (e.g. `#111827/1`) when visibly stroked. */
  stroke?: string
  /** Text color (hex) for text shapes. */
  fontColor?: string
  /** Corner radius in px when rounded. */
  cornerRadius?: number
  /** Compact shadow summary (e.g. `0/4 b8`) when the shape has a shadow. */
  shadow?: string
  /** CSS mix-blend-mode when not normal. */
  blendMode?: string
  /** Auto-layout summary (e.g. `row gap12 pad16`) on laid-out frames/groups. */
  layout?: string
  /** Design-token bindings (prop → token name) so the agent sees what's already systematized. */
  tokenBindings?: Record<string, string>

  /** Linear shapes only: vertices in ABSOLUTE canvas coords. */
  points?: Point[]
}

/**
 * Compact, token-cheap style summary: only the primary visible fill/stroke plus
 * fontColor/cornerRadius, and only when present. Lets the agent reuse the real
 * palette ("match the same blue", "restyle to fit") instead of guessing blind.
 */
type StyleDigest = {
  fill?: string
  /** Gradient fills only: `linear 90deg #a→#b` so the agent can match/extend them. */
  gradient?: string
  stroke?: string
  fontColor?: string
  cornerRadius?: number
  /** Compact effect summary, e.g. `shadow 0/4 b8` so the agent reuses the elevation. */
  shadow?: string
  blendMode?: string
  /** Auto-layout summary, e.g. `row gap12 pad16` — present on laid-out frames. */
  layout?: string
}

function styleDigest(s: CanvasShape): StyleDigest {
  const out: StyleDigest = {}
  const fill = s.fills?.find((f) => f.opacity > 0)
  if (fill) {
    if (fill.type === 'solid') {
      out.fill = fill.color
    } else {
      const dir = fill.type === 'linear' ? `linear ${round(fill.angle ?? 90)}deg` : 'radial'
      out.gradient = `${dir} ${fill.stops.map((st) => st.color).join('→')}`
      const primary = fillColor(fill)
      if (primary) out.fill = primary
    }
  }
  const stroke = s.strokes?.find((st) => st.opacity > 0 && st.width > 0)
  if (stroke) out.stroke = `${stroke.color}/${round(stroke.width)}`
  if (s.fontColor) out.fontColor = s.fontColor
  if (typeof s.cornerRadius === 'number' && s.cornerRadius > 0) out.cornerRadius = round(s.cornerRadius)
  if (s.shadows && s.shadows.length > 0) {
    const sh = s.shadows[0]
    out.shadow = `${sh.type === 'inner' ? 'inner ' : ''}${round(sh.x)}/${round(sh.y)} b${round(sh.blur)}`
  }
  if (s.blendMode && s.blendMode !== 'normal') out.blendMode = s.blendMode
  if (s.layout) {
    const dir = s.layout.direction === 'horizontal' ? 'row' : 'col'
    out.layout = `${dir} gap${round(s.layout.gap)} pad${round(s.layout.paddingTop)}`
  }
  return out
}

export type CanvasSnapshot = {
  shapeCount: number
  shapes: CanvasSnapshotShape[]
  /** When `maxShapes` truncated the result, how many shapes were dropped. */
  omitted?: number
}

/**
 * Options to keep big-document snapshots token-cheap:
 * - `rootFrameId` scopes the walk to one frame's subtree (the active screen)
 *   instead of the whole canvas.
 * - `maxShapes` caps how many shapes are emitted; the overflow count is reported
 *   as `omitted` so the agent knows the view is partial.
 */
export type SnapshotOptions = {
  rootFrameId?: string
  maxShapes?: number
}

export function snapshotCanvas(
  doc: CanvasDocument,
  selectedIds?: ReadonlySet<string>,
  opts?: SnapshotOptions
): CanvasSnapshot {
  const { objects, rootId } = doc
  const shapes: CanvasSnapshotShape[] = []
  const seen = new Set<string>()
  const startId = opts?.rootFrameId && objects[opts.rootFrameId] ? opts.rootFrameId : rootId
  const startName = startId === rootId ? null : (objects[startId]?.name ?? null)

  function walk(parentId: string, parentName: string | null): void {
    const parent = objects[parentId]
    if (!parent) return
    for (const childId of parent.children) {
      if (seen.has(childId)) continue
      seen.add(childId)
      const s = objects[childId]
      if (!s) continue
      const selected = selectedIds?.has(s.id) ?? false
      // A selected empty box is an implicit slot — the user shouldn't have to
      // mark it for the agent to fill it on request. A selected image whose
      // imageUrl is a data: URL is also effectively unreferenceable (the
      // snapshot drops data: URLs to avoid base64 blowing the prompt), so we
      // flag it as a holder too — otherwise the model would see neither
      // imageUrl nor aiImageHolder and have no rule to follow.
      const isUnreferenceableImage =
        s.type === 'image' && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:')
      const isHolder =
        Boolean(s.aiImageHolder) || (selected && (isImplicitImageSlot(s) || isUnreferenceableImage))
      shapes.push({
        id: s.id,
        name: s.name,
        type: s.type,
        x: round(s.x),
        y: round(s.y),
        w: round(s.width),
        h: round(s.height),
        ...(s.rotation ? { rotation: round(s.rotation) } : {}),
        parentName,
        ...(s.textContent ? { textContent: s.textContent.slice(0, 120) } : {}),
        ...(s.htmlArtifactId ? { htmlArtifactId: s.htmlArtifactId } : {}),
        ...(s.imageUrl && !s.imageUrl.startsWith('data:') ? { imageUrl: s.imageUrl } : {}),
        ...styleDigest(s),
        ...(s.tokenBindings && Object.keys(s.tokenBindings).length > 0
          ? { tokenBindings: s.tokenBindings }
          : {}),
        ...(selected ? { selected: true } : {}),
        ...(isHolder ? { aiImageHolder: true } : {}),
        ...(s.points && s.points.length > 0
          ? { points: s.points.map((p) => ({ x: round(s.x + p.x), y: round(s.y + p.y) })) }
          : {})
      })
      if (s.children.length > 0) walk(s.id, s.name)
    }
  }

  walk(startId, startName)

  const max = opts?.maxShapes
  if (typeof max === 'number' && shapes.length > max) {
    const omitted = shapes.length - max
    return { shapeCount: shapes.length, shapes: shapes.slice(0, max), omitted }
  }
  return { shapeCount: shapes.length, shapes }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function snapshotToCompactJson(snapshot: CanvasSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}
