import type { PetOverlayLayout } from '@shared/pets'

export type PetSurfaceSize = { width: number; height: number }
export type PetSurfaceRect = PetSurfaceSize & { left: number; top: number }
const GAP = 8
const MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/** All coordinates are relative to the native canvas; no panel participates in pet layout. */
export function petSurfaceLayout(input: {
  anchor: PetOverlayLayout
  petWidth: number
  petSize?: PetSurfaceSize
  controls: PetSurfaceSize
  notification: PetSurfaceSize
  menu: PetSurfaceSize
}) {
  const { anchor, petWidth } = input
  const { viewportWidth: width, viewportHeight: height } = anchor
  const petSize = input.petSize ?? { width: petWidth, height: Math.round(petWidth * 208 / 192) }
  const pet = { left: anchor.anchorX - petSize.width / 2, top: anchor.anchorY - petSize.height / 2, ...petSize }
  if (input.petSize) {
    pet.left = clamp(pet.left, MARGIN, width - MARGIN - pet.width)
    pet.top = clamp(pet.top, MARGIN, height - MARGIN - pet.height)
  }
  const horizontal = (w: number): number => clamp(anchor.anchorX - w / 2, MARGIN, width - MARGIN - w)
  const controlsWidth = Math.min(input.controls.width, width - MARGIN * 2)
  const controlsHeight = input.controls.height
  const above = pet.top - GAP - MARGIN
  const below = height - MARGIN - (pet.top + pet.height + GAP)
  const controlsBelow = below >= controlsHeight || below >= above
  const controls = {
    left: horizontal(controlsWidth),
    top: clamp(controlsBelow ? pet.top + pet.height + GAP : pet.top - GAP - controlsHeight,
      MARGIN, height - MARGIN - controlsHeight),
    width: controlsWidth, height: controlsHeight
  }
  const notificationAboveSpace = Math.max(0, (controlsBelow ? pet.top : controls.top) - GAP - MARGIN)
  const notificationBelowSpace = Math.max(0, height - MARGIN -
    (controlsBelow ? controls.top + controls.height : pet.top + pet.height) - GAP)
  const desiredNoticeHeight = Math.min(248, input.notification.height)
  const noticeBelow = notificationAboveSpace < desiredNoticeHeight && notificationBelowSpace > notificationAboveSpace
  const notificationMaxHeight = Math.max(0, Math.min(248, noticeBelow ? notificationBelowSpace : notificationAboveSpace))
  const notificationHeight = Math.min(input.notification.height, notificationMaxHeight)
  const notificationWidth = Math.min(330, width - MARGIN * 2)
  const notification = {
    left: horizontal(notificationWidth),
    top: noticeBelow
      ? (controlsBelow ? controls.top + controls.height : pet.top + pet.height) + GAP
      : (controlsBelow ? pet.top : controls.top) - GAP - notificationHeight,
    width: notificationWidth, height: notificationHeight
  }
  const menuWidth = Math.min(input.menu.width, width - MARGIN * 2)
  const menu = {
    left: clamp(pet.left + pet.width * .42, MARGIN, width - MARGIN - menuWidth),
    top: clamp(pet.top + (pet.height - input.menu.height) / 2, MARGIN, height - MARGIN - input.menu.height),
    width: menuWidth, height: input.menu.height
  }
  return { pet, controls, notification, menu, notificationMaxHeight,
    controlsSide: controlsBelow ? 'below' as const : 'above' as const,
    notificationSide: noticeBelow ? 'below' as const : 'above' as const }
}

/** The small gap from the pet to its controls must stay traversable without a hover flicker. */
export function petControlsBridge(pet: DOMRect, controls: DOMRect): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.max(pet.left, controls.left), right: Math.min(pet.right, controls.right),
    top: controls.top >= pet.bottom ? pet.bottom : controls.bottom,
    bottom: controls.top >= pet.bottom ? controls.top : pet.top
  }
}
