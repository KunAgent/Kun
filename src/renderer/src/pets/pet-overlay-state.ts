import type { PetAnimationState, PetSessionStatus } from '@shared/pets'

export type PetDragDirection = 'left' | 'right'

export function nextDragDirection(current: PetDragDirection, dx: number): PetDragDirection {
  if (dx > 0) return 'right'
  if (dx < 0) return 'left'
  return current
}

export function effectivePetBusinessState(input: {
  activeStatus: Exclude<PetSessionStatus, 'idle'> | null
  welcomeUntilMs: number | null
  nowMs: number
}): PetAnimationState {
  const business = input.activeStatus ?? 'idle'
  if (input.welcomeUntilMs !== null && input.nowMs < input.welcomeUntilMs && business === 'idle') return 'waving'
  return business
}

export function resolveOverlayAnimationState(input: {
  resizeMode: boolean
  dragging: boolean
  dragDirection: PetDragDirection
  hover: boolean
  effectiveBusinessState: PetAnimationState
}): PetAnimationState {
  if (input.resizeMode) return input.effectiveBusinessState
  if (input.dragging) return input.dragDirection === 'left' ? 'running-left' : 'running-right'
  if (input.hover) return 'jumping'
  return input.effectiveBusinessState
}
