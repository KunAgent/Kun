import { petTypingCutouts, petTypingRig } from './typing-rig'
import type { PetSummary } from '@shared/pets'
import type { JointFrame } from '../joint/timeline'
import { armLayerContact } from '../joint/arm-layer'
import { actor, ASPECT, bodyPoint, clamp, ease, grip, lerp, resetLimbs, type Point } from '../joint/geometry'
import type { TypingMotion } from './typing-motion'

export function typingScene(input: {
  pet: PetSummary; width: number; height: number; mascotWidth: number; origin: Point
  motion: TypingMotion; expiresAt: number; now: number; enteredAt: number; paused: boolean
}): JointFrame {
  const { width, height, motion, pet } = input
  const size = Math.min(input.mascotWidth, width - 30)
  const boardW = Math.min(width - 24, size * 1.12), boardH = Math.max(28, size * .25)
  const fade = input.paused ? 1 : ease(clamp((input.expiresAt - input.now) / 220))
  const entrance = ease(clamp((input.now - input.enteredAt) / 70)) * fade
  const a = actor(pet, { x: input.origin.x, y: input.origin.y }, size)
  a.rig = petTypingRig(pet) ?? a.rig
  const cutouts = petTypingCutouts(pet)
  const shoulderOffset = (Math.max(...a.rig.arms.map((arm) => arm.shoulder[1])) - .5) * size * ASPECT
  const fitted = { x: clamp(input.origin.x, boardW / 2 + 12, width - boardW / 2 - 12),
    y: Math.min(input.origin.y, height - boardH - 16 - shoulderOffset - 1.5) }
  a.root.x = lerp(input.origin.x, fitted.x, entrance)
  a.root.y = lerp(input.origin.y, fitted.y, entrance) + (a.rig.ground - .5) * size * ASPECT
  a.soloBlend = 1 - entrance
  resetLimbs(a)
  const shoulders = a.rig.arms.map((arm) => bodyPoint(a, arm.shoulder))
  const boardY = Math.max(...shoulders.map((p) => p.y)) + 1.5
  const keys = [motion.left, motion.right].map((paw, index) => {
    const side = index as 0 | 1, shoulder = shoulders[side], rest = a.hands[side]
    const originalLength = Math.hypot(rest.x - shoulder.x, rest.y - shoulder.y)
    const length = originalLength * (cutouts?.[side].scale ?? 1)
    const depth = Math.min(1.8, length * .24)
    const downY = shoulder.y + length * .70 + depth
    const downX = shoulder.x + (side ? 1 : -1) * Math.sqrt(Math.max(0, length * length - (downY - shoulder.y) ** 2))
    const lift = Math.min(8, length * .4)
    const y = downY - depth - lift * (1 - paw.down) + depth * paw.down
    const x = shoulder.x + (side ? 1 : -1) * Math.sqrt(Math.max(0, length * length - (y - shoulder.y) ** 2))
    // Rotate a solid limb along a fixed-length arc. It cannot stretch into the desk.
    const from = Math.atan2(rest.y - shoulder.y, rest.x - shoulder.x)
    const to = Math.atan2(y - shoulder.y, x - shoulder.x)
    const angle = lerp(from, to, entrance), radius = lerp(originalLength, length, entrance)
    const target = { x: shoulder.x + Math.cos(angle) * radius, y: shoulder.y + Math.sin(angle) * radius }
    grip(a, side, { x: downX, y: downY }, 1)
    const contact = cutouts ? armLayerContact(a, side, cutouts[side]) : a.hands[side]
    grip(a, side, target, 1)
    return { x: contact.x, y: contact.y - depth, depth, down: paw.down, glow: paw.glow }
  })
  if (cutouts) a.armLayers = { cutouts, contactY: [keys[0].y + keys[0].depth * keys[0].down, keys[1].y + keys[1].depth * keys[1].down] }
  else a.frontArms = true
  const accent = pet.sourceId === 'ikun' ? '#e6a75e' : pet.sourceId === 'whale-girl' ? '#83bfdc' : '#c8b37c'
  const keyboard = { x: clamp(a.root.x - boardW / 2, 12, width - boardW - 12), y: boardY,
    width: boardW, height: boardH, left: keys[0], right: keys[1], opacity: entrance, accent }
  return { actors: [a], keyboard, objects: [], links: [], blanket: null, charge: 0,
    contact: Math.max(motion.left.down, motion.right.down), beat: 0, focus: bodyPoint(a, a.rig.head),
    width, height, opacity: 1, phase: 'playing', progress: 0 }
}
