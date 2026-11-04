import type { ScreenPoint } from '../../shared/pets'

export type Rect = { x: number; y: number; width: number; height: number }

export type PetDisplay = { id: string; workArea: Rect; scaleFactor: number }

export const PET_OVERLAY_MAX_WIDTH = 420
export const PET_OVERLAY_MAX_HEIGHT = 640

/** The pet owns the position. Transparent room around it is reserved for transient panels. */
export function petOverlayFrame(center: ScreenPoint, workArea: Rect): Rect {
  const width = Math.min(PET_OVERLAY_MAX_WIDTH, workArea.width)
  const height = Math.min(PET_OVERLAY_MAX_HEIGHT, workArea.height)
  return {
    x: Math.round(clamp(center.x - width / 2, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(center.y - height / 2, workArea.y, workArea.y + workArea.height - height)),
    width, height
  }
}

export function clampPetCenter(center: ScreenPoint, width: number, workArea: Rect): ScreenPoint {
  const height = Math.round(width * 208 / 192)
  return {
    x: clamp(center.x, workArea.x + width / 2 + 8, workArea.x + workArea.width - width / 2 - 8),
    y: clamp(center.y, workArea.y + height / 2 + 8, workArea.y + workArea.height - height / 2 - 8)
  }
}

export function clampPetBounds(bounds: Rect, workArea: Rect, visible: Rect = bounds): Rect {
  const width = Math.min(Math.max(1, bounds.width), workArea.width)
  const height = Math.min(Math.max(1, bounds.height), workArea.height)
  const visibleWidth = Math.min(visible.width, workArea.width)
  const visibleHeight = Math.min(visible.height, workArea.height)
  const minX = workArea.x - (visible.x - bounds.x)
  const maxX = workArea.x + workArea.width - (visible.x - bounds.x) - visibleWidth
  const minY = workArea.y - (visible.y - bounds.y)
  const maxY = workArea.y + workArea.height - (visible.y - bounds.y) - visibleHeight
  return {
    x: clamp(bounds.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(bounds.y, Math.min(minY, maxY), Math.max(minY, maxY)),
    width,
    height
  }
}

export function placementFromDip(input: {
  display: PetDisplay
  bounds: Rect
  mascotWidthPx: number
  updatedAt: string
  petCenter?: ScreenPoint
}): { displayId: string; workArea: Rect; windowBounds: Rect; mascotWidthPx: number; updatedAt: string; petCenter?: ScreenPoint } {
  return {
    displayId: input.display.id,
    workArea: { ...input.display.workArea },
    windowBounds: { ...input.bounds },
    mascotWidthPx: input.mascotWidthPx,
    updatedAt: input.updatedAt,
    ...(input.petCenter ? { petCenter: { ...input.petCenter } } : {})
  }
}

export function restorePetBounds(input: {
  saved: { displayId: string; windowBounds: Rect } | null
  displays: PetDisplay[]
  fallbackSize: { width: number; height: number }
}): { display: PetDisplay; bounds: Rect } {
  const primary = input.displays[0]
  if (!primary) throw new Error('no display is available')
  const matched = input.saved ? input.displays.find((display) => display.id === input.saved?.displayId) : undefined
  const display = matched ?? primary
  const raw = input.saved && matched
    ? input.saved.windowBounds
    : {
        x: display.workArea.x + Math.max(0, display.workArea.width - input.fallbackSize.width - 24),
        y: display.workArea.y + Math.max(0, display.workArea.height - input.fallbackSize.height - 24),
        ...input.fallbackSize
      }
  return { display, bounds: clampPetBounds(raw, display.workArea) }
}

export function dragBounds(origin: Rect, dx: number, dy: number, workArea: Rect, visible?: Rect): Rect {
  const moved = { ...origin, x: origin.x + dx, y: origin.y + dy }
  const movedVisible = visible ? { ...visible, x: visible.x + dx, y: visible.y + dy } : undefined
  return clampPetBounds(moved, workArea, movedVisible)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
