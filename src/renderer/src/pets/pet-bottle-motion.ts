import type { PetAnimationState } from '@shared/pets'
import type { PetBottleRecipe } from '@shared/pets-bottle'
import type { PetVisit } from '@shared/pets-visits'

const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n))
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p
const ease = (p: number): number => { const x = clamp(p); return x * x * (3 - 2 * x) }

export function samplePetBottle(input: {
  visit: PetVisit; now: number; width: number; height: number; mascotWidth: number
  primaryOrigin: { x: number; y: number }; recipe: PetBottleRecipe; reduced: boolean
}) {
  const { visit, now, width, height, primaryOrigin: origin, recipe, mascotWidth: size } = input
  const early = visit.playUntil < visit.plannedPlayUntil
  const storyTime = early ? Math.min(now, visit.playUntil) : now
  const duration = visit.plannedPlayUntil + 900 - visit.startedAt
  const p = clamp((storyTime - visit.startedAt) / duration)
  const h = size * 208 / 192, bottleSize = Math.min(84, Math.max(52, size * .62))
  const side = origin.x <= width / 2 ? 1 : -1
  const landingX = clamp(origin.x + side * size * .86, bottleSize / 2 + 10, width - bottleSize / 2 - 10)
  const groundY = Math.min(height - 26, origin.y + h / 2 - 4)
  const landingY = groundY - bottleSize * .42
  const approachX = clamp(landingX - side * size * .44, size / 2 + 6, width - size / 2 - 6)
  const handX = approachX + side * size * .28, handY = origin.y + size * .12
  const hopHeight = Math.max(0, Math.min(12, origin.y - h / 2 - 6))
  let x = origin.x, y = origin.y, lift = 0, tilt = 0, pose: PetAnimationState = 'waiting'
  let bx = landingX, by = landingY, angle = 0, opacity = 1, scale = 1, spark = 0
  let phase: 'falling' | 'approaching' | 'catching' | 'inspecting' | 'celebrating' | 'settling' = 'falling'
  if (p < .18) {
    const t = p / .18
    by = lerp(-bottleSize, landingY, t * t)
    angle = side * 18 * (1 - t)
    tilt = side * Math.sin(t * Math.PI) * 5
  } else if (p < .34) {
    phase = 'approaching'
    const t = (p - .18) / .16
    x = lerp(origin.x, approachX, ease(t))
    pose = side > 0 ? 'running-right' : 'running-left'
    by -= Math.abs(Math.sin(t * Math.PI * 2)) * (recipe.catchStyle === 'bounce' ? 16 : 8) * (1 - t)
    angle = Math.sin(t * Math.PI * 3) * 12 * (1 - t)
  } else if (p < .49) {
    phase = 'catching'
    const t = (p - .34) / .15
    x = approachX; pose = 'waving'
    bx = lerp(landingX, handX, ease(t))
    by = lerp(landingY, handY, ease(t)) - Math.sin(t * Math.PI) * (recipe.catchStyle === 'bounce' ? 28 : 6)
    angle = recipe.catchStyle === 'bounce' ? 360 * ease(t) : side * Math.sin(t * Math.PI) * 8
    tilt = side * 3 * Math.sin(t * Math.PI)
  } else if (p < .73) {
    phase = 'inspecting'
    const t = (p - .49) / .24
    x = approachX; pose = recipe.inspectState; bx = handX; by = handY
    tilt = side * (3 + Math.sin(t * Math.PI * 2) * 3)
    angle = Math.sin(t * Math.PI * 3) * 6
    by += Math.sin(t * Math.PI * 3) * 2
  } else if (p < .88) {
    phase = 'celebrating'
    const t = (p - .73) / .15
    x = approachX; pose = recipe.celebrateState
    lift = Math.sin(t * Math.PI) * hopHeight
    bx = handX; by = handY - lift; angle = Math.sin(t * Math.PI * 2) * 7
    spark = Math.sin(t * Math.PI)
  } else {
    phase = 'settling'
    const t = ease((p - .88) / .12)
    x = lerp(approachX, origin.x, t)
    pose = t > .9 ? 'idle' : side > 0 ? 'running-left' : 'running-right'
    bx = lerp(handX, landingX, t); by = lerp(handY, groundY, t); opacity = 1 - t; scale = 1 - .3 * t
  }
  if (early && now >= visit.playUntil) {
    const t = ease((now - visit.playUntil) / Math.max(1, visit.endsAt - visit.playUntil))
    phase = 'settling'; x = lerp(x, origin.x, t); lift *= 1 - t; tilt *= 1 - t
    opacity *= 1 - t; spark *= 1 - t; pose = 'idle'
  }
  y -= lift
  const room = Math.max(0, Math.min(x - size / 2, width - x - size / 2, y - h / 2, height - y - h / 2))
  const allowedTilt = Math.min(6, room / Math.max(size, h) * 180 / Math.PI)
  tilt = clamp(tilt, -allowedTilt, allowedTilt)
  if (input.reduced) {
    phase = 'inspecting'; x = origin.x; y = origin.y; pose = recipe.inspectState; tilt = 0
    bx = landingX; by = landingY; angle = 0; scale = 1; spark = 0
    opacity = now >= visit.endsAt ? 0 : 1
  }
  return { phase, actor: { x, y, pose, tilt, size }, bottle: { x: bx, y: by, angle, opacity, scale, size: bottleSize },
    spark, groundY, captionBelow: origin.y - h / 2 < 42 }
}
