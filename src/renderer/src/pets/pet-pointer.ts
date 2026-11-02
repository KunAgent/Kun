import { PET_DRAG_THRESHOLD_PX, PET_FIRST_AWAKE_TTL_MS, clampMascotWidth } from '@shared/pets'

export function classifyPointerGesture(input: {
  cancelled: boolean
  dx: number
  dy: number
}): 'cancel' | 'drag' | 'click' {
  if (input.cancelled) return 'cancel'
  if (Math.hypot(input.dx, input.dy) >= PET_DRAG_THRESHOLD_PX) return 'drag'
  return 'click'
}

export function welcomeUntil(petId: string | null, welcomedPetIds: readonly string[], nowMs: number): number | null {
  if (!petId || welcomedPetIds.includes(petId)) return null
  return nowMs + PET_FIRST_AWAKE_TTL_MS
}

export function nextMascotWidth(current: number, direction: -1 | 1): number {
  return clampMascotWidth(current + direction * 16)
}

export function overlayKeyAction(key: string): 'close' | 'reply' | 'stop' | 'expand' | 'shrink' | 'dismiss' | null {
  if (key === 'Escape') return 'close'
  if (key === 'Enter') return 'reply'
  if (key === 'Backspace' || key === 'Delete') return 'dismiss'
  if (key === '+' || key === '=') return 'expand'
  if (key === '-' || key === '_') return 'shrink'
  if (key === 's' || key === 'S') return 'stop'
  return null
}
