import i18n from '../../i18n'
import type { CanvasShape } from './canvas-types'

/**
 * Image-slot overlays for PPT review cards. Each image the editable deck
 * places on a slide gets a dashed outline and an origin tag (the user's
 * material, a generated supplement, or an image already in the deck), so a
 * reviewer can see which parts of a page are replaceable pictures. They are
 * annotation shapes: never serialized back as user feedback, and shown or
 * hidden together by the board's image-slot toggle.
 */

export type PptReviewSlotAsset = {
  path: string
  origin: 'user' | 'generated' | 'project'
  rect?: { x: number; y: number; width: number; height: number }
}

const SLOT_MARK = ':slot:'
const MAX_SLOTS_PER_SLIDE = 8
const TAG_HEIGHT = 18
const ORIGIN_STYLE: Readonly<Record<PptReviewSlotAsset['origin'], { color: string; labelKey: string }>> = {
  user: { color: '#2E9B5F', labelKey: 'common:pptReviewSlotUser' },
  generated: { color: '#4F6BED', labelKey: 'common:pptReviewSlotGenerated' },
  project: { color: '#8A909A', labelKey: 'common:pptReviewSlotProject' }
}

export function isPptReviewSlotShape(shape: Pick<CanvasShape, 'name' | 'pptReviewRef'>): boolean {
  return shape.pptReviewRef?.role === 'annotation' && shape.name.includes(SLOT_MARK)
}

function validRect(rect: PptReviewSlotAsset['rect']): rect is NonNullable<PptReviewSlotAsset['rect']> {
  if (!rect) return false
  const values = [rect.x, rect.y, rect.width, rect.height]
  return values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) &&
    rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1.000_001 && rect.y + rect.height <= 1.000_001
}

function slotAssets(assets: readonly PptReviewSlotAsset[] | undefined): PptReviewSlotAsset[] {
  // Bundles come from tool output, so tolerate malformed entries instead of trusting the type.
  const list: readonly PptReviewSlotAsset[] = Array.isArray(assets) ? assets : []
  return list
    .filter((asset) => Boolean(asset && ORIGIN_STYLE[asset.origin] && validRect(asset.rect)))
    .slice(0, MAX_SLOTS_PER_SLIDE)
}

/** Shape names this slide's slots will use; anything else marked as a slot is stale. */
export function pptReviewSlotNames(key: string, assets: readonly PptReviewSlotAsset[] | undefined): string[] {
  return slotAssets(assets).flatMap((_, index) => ['frame', 'tag', 'label'].map((part) => `${key}${SLOT_MARK}${index}:${part}`))
}

export function pptReviewSlotOps(input: {
  key: string
  assets: readonly PptReviewSlotAsset[] | undefined
  preview: { x: number; y: number; width: number; height: number }
  ref: NonNullable<CanvasShape['pptReviewRef']>
  byName: ReadonlyMap<string, CanvasShape>
}): unknown[] {
  return slotAssets(input.assets).flatMap((asset, index) => {
    const rect = asset.rect!
    const style = ORIGIN_STYLE[asset.origin]
    const name = `${input.key}${SLOT_MARK}${index}`
    const x = input.preview.x + rect.x * input.preview.width
    const y = input.preview.y + rect.y * input.preview.height
    const width = Math.max(rect.width * input.preview.width, 4)
    const height = Math.max(rect.height * input.preview.height, 4)
    const label = i18n.t(style.labelKey)
    const tagWidth = Math.min(Math.max(label.length * 7 + 14, 48), Math.max(width, 48))
    const tagY = Math.min(y + height, input.preview.y + input.preview.height) - TAG_HEIGHT
    const shapes = [
      {
        type: 'rect', name: `${name}:frame`, x, y, width, height, cornerRadius: 4,
        fills: [{ type: 'solid', color: style.color, opacity: 0.08 }],
        strokes: [{ color: style.color, width: 2, opacity: 1, position: 'inside', dash: 'dashed' }],
        pptReviewRef: input.ref
      },
      {
        type: 'rect', name: `${name}:tag`, x, y: tagY, width: tagWidth, height: TAG_HEIGHT, cornerRadius: 4,
        fills: [{ type: 'solid', color: style.color, opacity: 1 }],
        pptReviewRef: input.ref
      },
      {
        type: 'text', name: `${name}:label`, x: x + 6, y: tagY + 2, width: tagWidth - 8, height: TAG_HEIGHT - 2,
        textContent: label, fontSize: 11, fontWeight: 600, fontColor: '#FFFFFF', lineHeight: 1.2,
        pptReviewRef: input.ref
      }
    ]
    return shapes.map((shape) => {
      const existing = input.byName.get(shape.name)
      const { type, ...patch } = shape
      void type
      return existing ? { op: 'update', id: existing.id, patch } : { op: 'add', shape }
    })
  })
}
