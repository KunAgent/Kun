import type { PetJointRig, PetRigPoint } from '@shared/pets-joint'
import type { PetSummary } from '@shared/pets'

export type Point = { x: number; y: number }
export type JointActor = {
  pet: PetSummary; rig: PetJointRig; root: Point; width: number; opacity: number
  lean: number; crouch: number; headTilt: number; step: number; jump: number
  hands: [Point, Point]; grips: [number, number]; feet: [Point, Point]
  soloBlend: number
}
export const ASPECT = 208 / 192
export const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const mix = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })
export const ease = (n: number): number => { const p = clamp(n); return p * p * (3 - 2 * p) }
export const cue = (p: number, a: number, b: number): number => ease((p - a) / (b - a))
export const pulse = (p: number, a: number, b: number): number => p <= a || p >= b ? 0 : Math.sin((p - a) / (b - a) * Math.PI)
export const spring = (p: number, at: number, speed = 24): number => {
  const t = Math.max(0, p - at) * speed
  return Math.sin(t * 3.5) * Math.exp(-t * 1.8)
}

const fallbackRig: PetJointRig = {
  version: 1, row: 0, blink: [0, 1, 2, 3, 4, 5], ground: .92, head: [.5, .55],
  arms: [{ shoulder: [.33, .55], hand: [.25, .70], radius: .08 }, { shoulder: [.67, .55], hand: [.75, .70], radius: .08 }],
  feet: [[.38, .89], [.62, .89]]
}

export function actor(pet: PetSummary, root: Point, width: number): JointActor {
  const value: JointActor = { pet, rig: pet.interactions?.joint ?? fallbackRig, root, width, opacity: 1,
    lean: 0, crouch: 0, headTilt: 0, step: 0, jump: 0, hands: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    grips: [0, 0], feet: [{ x: 0, y: 0 }, { x: 0, y: 0 }], soloBlend: 0 }
  resetLimbs(value)
  return value
}

/** A planted pelvis/feet with a bending torso, instead of rotating the whole sticker. */
export function bodyPoint(a: JointActor, point: PetRigPoint): Point {
  const [u, v] = point, ground = a.rig.ground
  const height = a.width * ASPECT
  const aboveGround = (ground - v) * height
  return { x: a.root.x + (u - .5) * a.width + Math.sin(a.lean) * aboveGround * .72,
    y: a.root.y - a.jump - aboveGround + a.crouch * ease((ground - v) / .45) }
}

export function resetLimbs(a: JointActor): void {
  a.hands = a.rig.arms.map((arm) => bodyPoint(a, arm.hand)) as JointActor['hands']
  a.feet = a.rig.feet.map((p, i) => {
    const swing = Math.sin(a.step + i * Math.PI)
    return { x: a.root.x + (p[0] - .5) * a.width + (a.step ? swing * a.width * .035 : 0),
      y: a.root.y - a.jump - (a.rig.ground - p[1]) * a.width * ASPECT - (a.step ? Math.max(0, swing) * 4 : 0) }
  }) as JointActor['feet']
}

export function grip(a: JointActor, side: 0 | 1, point: Point, amount: number): void {
  a.hands[side] = mix(a.hands[side], point, amount)
  a.grips[side] = amount
}

/** Both hands resolve to the very same contact, including when either partner moves. */
export function linkHands(a: JointActor, sideA: 0 | 1, b: JointActor, sideB: 0 | 1, amount: number, lift = 0): Point {
  const contact = mix(a.hands[sideA], b.hands[sideB], .5)
  contact.y -= lift
  grip(a, sideA, contact, amount); grip(b, sideB, contact, amount)
  return contact
}

export function armWeight(a: JointActor, uv: PetRigPoint, side: number): number {
  const arm = a.rig.arms[side]
  const vx = arm.hand[0] - arm.shoulder[0], vy = arm.hand[1] - arm.shoulder[1]
  const t = ((uv[0] - arm.shoulder[0]) * vx + (uv[1] - arm.shoulder[1]) * vy) / (vx * vx + vy * vy)
  const nearest = { x: arm.shoulder[0] + vx * clamp(t), y: arm.shoulder[1] + vy * clamp(t) }
  const distance = Math.hypot(uv[0] - nearest.x, uv[1] - nearest.y) / arm.radius
  return (1 - ease((distance - .55) / .45)) * ease(t / .65)
}

/** Skinning uses the original pixels. The face rotates rigidly and is never redrawn. */
export function skinPoint(a: JointActor, uv: PetRigPoint): Point {
  let result = bodyPoint(a, uv)
  const head = bodyPoint(a, a.rig.head)
  const headWeight = ease((a.rig.head[1] - uv[1]) / .07)
  const dx = result.x - head.x, dy = result.y - head.y, angle = a.headTilt * headWeight
  result = { x: head.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: head.y + dx * Math.sin(angle) + dy * Math.cos(angle) }
  for (const side of [0, 1] as const) {
    const arm = a.rig.arms[side], shoulder = bodyPoint(a, arm.shoulder), base = bodyPoint(a, arm.hand)
    const weight = armWeight(a, uv, side)
    const vx = base.x - shoulder.x, vy = base.y - shoulder.y, length = Math.hypot(vx, vy)
    const tx = a.hands[side].x - shoulder.x, ty = a.hands[side].y - shoulder.y, targetLength = Math.max(.001, Math.hypot(tx, ty))
    const dx = result.x - shoulder.x, dy = result.y - shoulder.y
    const along = (dx * vx + dy * vy) / (length * length)
    const across = (-dx * vy + dy * vx) / length
    const moved = { x: shoulder.x + along * tx - across * ty / targetLength,
      y: shoulder.y + along * ty + across * tx / targetLength }
    result.x += (moved.x - result.x) * weight
    result.y += (moved.y - result.y) * weight
    const foot = a.rig.feet[side], footBase = bodyPoint(a, foot)
    const footWeight = ease(1 - Math.hypot((uv[0] - foot[0]) / .13, (uv[1] - foot[1]) / .09))
    result.x += (a.feet[side].x - footBase.x) * footWeight
    result.y += (a.feet[side].y - footBase.y) * footWeight
  }
  return result
}
