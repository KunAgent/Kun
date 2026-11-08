import { petTypingRig } from './typing-rig'
import type { PetSummary } from '@shared/pets'
import type { JointFrame } from '../joint/timeline'
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
  a.frontArms = true
  const handOffset = ((a.rig.arms[0].hand[1] + a.rig.arms[1].hand[1]) / 2 - .5) * size * ASPECT
  const fitted = { x: clamp(input.origin.x, boardW / 2 + 12, width - boardW / 2 - 12),
    y: Math.min(input.origin.y, height - boardH - 16 - handOffset + 5) }
  a.root.x = lerp(input.origin.x, fitted.x, entrance)
  a.root.y = lerp(input.origin.y, fitted.y, entrance) + (a.rig.ground - .5) * size * ASPECT
  resetLimbs(a)
  const neutral = a.hands.map((point) => ({ ...point }))
  const averageY = (neutral[0].y + neutral[1].y) / 2
  const keyY = averageY - 5 + boardH * .43
  a.crouch = Math.max(motion.left.down, motion.right.down) * 2
  a.lean = (motion.right.down - motion.left.down) * .018
  a.headTilt = -a.lean * .6
  a.soloBlend = 1 - entrance
  resetLimbs(a)
  const keys = [motion.left, motion.right].map((paw, i) => {
    const x = lerp(neutral[i].x, a.root.x + (i ? 1 : -1) * size * .20, .65)
    const target = { x, y: keyY - (1 - paw.down) * 13 + paw.down * 1.8 }
    grip(a, i as 0 | 1, target, entrance)
    return { x, y: keyY, down: paw.down, glow: paw.glow }
  })
  const accent = pet.sourceId === 'ikun' ? '#e6a75e' : pet.sourceId === 'whale-girl' ? '#83bfdc' : '#c8b37c'
  const keyboard = { x: clamp(a.root.x - boardW / 2, 12, width - boardW - 12), y: keyY - boardH * .43,
    width: boardW, height: boardH, left: keys[0], right: keys[1], opacity: entrance, accent }
  return { actors: [a], keyboard, objects: [], links: [], blanket: null, charge: 0,
    contact: Math.max(motion.left.down, motion.right.down), beat: 0, focus: bodyPoint(a, a.rig.head),
    width, height, opacity: 1, phase: 'playing', progress: 0 }
}
