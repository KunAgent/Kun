import type { PetJointSceneId } from '@shared/pets-joint'
import { clamp, cue, grip, lerp, linkHands, mix, pulse, resetLimbs, spring, type JointActor, type Point } from './geometry'

export type SharedObject = { kind: 'bubble' | 'ball' | 'star'; center: Point; radius: number; opacity: number; spin: number }
export type JointConnection = { a: Point; b: Point; opacity: number }
export type JointScene = {
  actors: JointActor[]; objects: SharedObject[]; links: JointConnection[]
  blanket: { points: Point[]; sag: number; opacity: number } | null
  charge: number; focus: Point; contact: number; beat: number
}
export type SceneContext = JointScene & { scene: PetJointSceneId; p: number; width: number; height: number; floor: number }
const settle = (a: JointActor, c: SceneContext, side: number, amount: number): void => {
  a.lean = side * amount; a.headTilt = -side * amount * .65; resetLimbs(a)
}

export function sharedBubble(c: SceneContext): void {
  const { p, actors, width: w, floor } = c
  const join = cue(p, .17, .32), lift = cue(p, .41, .63), release = cue(p, .72, .80)
  const tension = pulse(p, .33, .45)
  const sway = Math.sin(lift * Math.PI * 1.4) * 5
  const center = { x: w * .5 + sway, y: floor - 55 - lift * 28 - cue(p, .77, 1) * 50 }
  const radius = lerp(10, actors.length === 3 ? 46 : 39, cue(p, .04, .25)) + tension * 2
  const heldY = floor - 55 - lift * 28
  actors.forEach((a, i) => {
    const side = a.root.x < w / 2 ? 1 : -1
    if (actors.length === 2 || i !== 1) {
      const hand = side > 0 ? 1 : 0
      const aligned = center.x - side * radius * .82 - (a.rig.arms[hand].hand[0] - .5) * a.width - side * 7
      a.root.x = lerp(a.root.x, aligned, join * (1 - release))
    } else a.root.x += sway * join * (1 - release)
    a.jump = lift * 25 * (1 - cue(p, .78, .91))
    a.crouch = tension * 5 + Math.max(0, spring(p, .89)) * 5
    settle(a, c, side, .055 * join + tension * .04)
    const outer = actors.length === 2 || i !== 1
    if (outer) {
      const hand = (side > 0 ? 1 : 0) as 0 | 1
      const target = { x: center.x - side * radius * .82, y: heldY + radius * .28 }
      grip(a, hand, target, join * (1 - release))
      const free = hand === 1 ? 0 : 1
      grip(a, free, { x: a.hands[free].x - side * tension * 4, y: a.hands[free].y - tension * 3 }, join * (1 - release))
    } else {
      grip(a, 0, { x: center.x - 13, y: heldY + 12 }, join * (1 - release))
      grip(a, 1, { x: center.x + 13, y: heldY + 12 }, join * (1 - release))
    }
    if (release > 0) a.headTilt = side * cue(p, .76, .92) * .10
  })
  c.objects.push({ kind: 'bubble', center, radius, opacity: cue(p, .03, .12) * (1 - cue(p, .93, 1)), spin: p })
  c.focus = center; c.charge = tension; c.contact = join * (1 - release)
  c.beat = p < .17 ? 0 : p < .41 ? 1 : p < .72 ? 2 : 3
}

export function sharedDance(c: SceneContext): void {
  const { p, actors, width: w } = c
  const together = cue(p, .09, .24) * (1 - cue(p, .82, .93))
  const dancing = pulse(p, .27, .79)
  const step = Math.sin(clamp((p - .27) / .52) * Math.PI * 6) * dancing
  const gaps = actors.slice(1).map((a, i) => {
    const left = actors[i]
    return (left.rig.arms[1].hand[0] - .5) * left.width + (.5 - a.rig.arms[0].hand[0]) * a.width + (left.width + a.width) * .07
  })
  const start = w / 2 - gaps.reduce((a, b) => a + b, 0) / 2
  actors.forEach((a, i) => {
    const target = start + gaps.slice(0, i).reduce((a, b) => a + b, 0)
    a.root.x = lerp(a.root.x, target, together) + step * 7
    a.lean = (i % 2 ? -1 : 1) * step * .075
    a.headTilt = -a.lean * .6 + pulse(p, .90, 1) * .10
    a.step = dancing > .01 ? p * 65 + i * Math.PI : 0
    a.crouch = Math.abs(step) * 2 + pulse(p, .90, 1) * 4
    resetLimbs(a)
  })
  for (let i = 0; i < actors.length - 1; i++) {
    const a = actors[i], b = actors[i + 1]
    const contact = linkHands(a, 1, b, 0, together, 5 + dancing * 6)
    c.links.push({ a: a.hands[1], b: b.hands[0], opacity: together })
    c.focus = contact
  }
  c.contact = together; c.charge = Math.abs(step); c.beat = p < .24 ? 0 : p < .51 ? 1 : p < .82 ? 2 : 3
}

export function sharedBall(c: SceneContext): void {
  const { p, actors, floor } = c
  const owner = Math.max(0, actors.findIndex((a) => a.pet.sourceId === 'ikun'))
  const order = [owner, ...actors.map((_, i) => i).filter((i) => i !== owner), owner]
  const count = order.length - 1
  const progress = clamp((p - .18) / .62) * count
  const passIndex = Math.min(count - 1, Math.floor(progress))
  const flight = clamp(progress - passIndex)
  const from = actors[order[passIndex]], to = actors[order[passIndex + 1]]
  const side = from.root.x < to.root.x ? 1 : -1
  const fromHand = (side > 0 ? 1 : 0) as 0 | 1, toHand = (side > 0 ? 0 : 1) as 0 | 1
  const launch = cue(flight, .20, .32), travel = cue(flight, .30, .77), caught = cue(flight, .76, .88)
  actors.forEach((a) => {
    a.crouch = a === to ? Math.max(0, spring(flight, .77, 15)) * 7 : 0
    a.lean = a === from ? side * pulse(flight, .15, .48) * .10 : a === to ? side * spring(flight, .77, 15) * .055 : 0
    a.headTilt = (a.root.x < (from.root.x + to.root.x) / 2 ? 1 : -1) * pulse(flight, .30, .80) * -.07
    resetLimbs(a)
  })
  const start = { x: from.hands[fromHand].x + side * 5, y: from.hands[fromHand].y - 5 }
  const end = { x: to.hands[toHand].x - side * 5, y: to.hands[toHand].y - 5 }
  const previous = passIndex > 0 ? actors[order[passIndex - 1]] : to
  const incoming = (previous.root.x < from.root.x ? 0 : 1) as 0 | 1
  const carry = { x: from.hands[incoming].x, y: from.hands[incoming].y - 5 }
  let center = flight < .30 ? mix(carry, start, cue(flight, 0, .25)) : mix(start, end, travel)
  center.y -= Math.sin(travel * Math.PI) * 36
  if (p < .18) {
    const holder = actors[owner], h = actors[order[1]].root.x > holder.root.x ? 1 : 0
    center = { x: holder.hands[h].x, y: holder.hands[h].y - 4 + Math.abs(Math.sin(p / .18 * Math.PI * 3)) * 24 }
    grip(holder, h as 0 | 1, { x: center.x, y: center.y - 7 }, .8)
  } else {
    grip(from, fromHand, { x: center.x, y: center.y + 5 }, cue(flight, .12, .24) * (1 - launch))
    if (flight < .25) grip(from, incoming, { x: center.x, y: center.y + 5 }, 1 - cue(flight, .12, .25))
    // The receiving hands prepare before impact, then move with the ball's weight.
    grip(to, toHand, { x: end.x, y: end.y + 5 }, cue(flight, .42, .70))
    if (travel >= 1) {
      center = { x: end.x + side * caught * 4, y: end.y + to.crouch * .4 }
      grip(to, toHand, { x: center.x, y: center.y + 6 }, 1)
    }
  }
  if (p > .80) {
    const holder = actors[owner], h = toHand
    const resting = { x: holder.hands[h].x, y: holder.hands[h].y - 3 }
    center = mix(center, resting, cue(p, .80, .88))
    grip(holder, h as 0 | 1, { x: center.x, y: center.y + 6 }, 1)
  }
  const radius = 12 - caught * Math.max(0, spring(flight, .77, 15)) * 1.5
  c.objects.push({ kind: 'ball', center, radius, opacity: 1 - cue(p, .95, 1), spin: p * 20 })
  c.focus = center; c.contact = caught; c.charge = caught; c.beat = p < .18 ? 0 : p < .50 ? 1 : p < .80 ? 2 : 3
  // A common floor keeps the bounce and every receiver in the same world.
  center.y = Math.min(center.y, floor - radius)
}

export function sharedStar(c: SceneContext): void {
  const { p, actors, width: w, floor } = c
  const join = cue(p, .04, .19), fall = cue(p, .22, .42), push = cue(p, .53, .64)
  const impact = Math.max(0, spring(p, .42, 19)), gather = pulse(p, .43, .64)
  const blanketY = floor - 25 + gather * 8 - push * 7
  const points: Point[] = []
  actors.forEach((a, i) => {
    if (actors.length === 2 || i !== 1) {
      const side = i === 0 ? 1 : -1, hand = side > 0 ? 1 : 0
      const corner = w * (i === 0 ? .40 : .60)
      const aligned = corner - (a.rig.arms[hand].hand[0] - .5) * a.width - side * 6
      a.root.x = lerp(a.root.x, aligned, join)
    }
    a.crouch = gather * 9 + impact * 5
    a.lean = (a.root.x < w / 2 ? 1 : -1) * (gather * .065 + impact * .02)
    a.jump = pulse(p, .61, .78) * 11
    a.headTilt = (a.root.x < w / 2 ? 1 : -1) * -cue(p, .65, .83) * .08
    resetLimbs(a)
    const middle = i === 1 && actors.length === 3
    const x = middle ? w / 2 : i === 0 ? w * .40 : w * .60
    const y = blanketY - (middle ? 26 : 0) - a.jump
    const sides: Array<0 | 1> = middle ? [0, 1] : [i === 0 ? 1 : 0]
    for (const side of sides) {
      const contact = { x: x + (middle ? side ? 9 : -9 : 0), y }
      grip(a, side, contact, join * (1 - cue(p, .87, 1)))
      points.push(a.hands[side])
    }
  })
  const launchY = floor - 40 - Math.sin((.64 - .61) / (.78 - .61) * Math.PI) * 11
  const flight = clamp((p - .64) / .36)
  const starY = p < .42 ? lerp(floor - 104, blanketY - 8, fall)
    : p < .64 ? blanketY - actors[0].jump - 8 + gather * 10 + impact * 8 : launchY - 220 * flight + 140 * flight * flight
  c.blanket = { points, sag: 7 + gather * 10 + impact * 8, opacity: join * (1 - cue(p, .91, 1)) }
  c.objects.push({ kind: 'star', center: { x: w / 2, y: starY }, radius: 15,
    opacity: cue(p, .17, .23) * (1 - cue(p, .94, 1)), spin: p > .64 ? (p - .64) * 10 : 0 })
  c.focus = { x: w / 2, y: starY }; c.charge = gather; c.contact = impact
  c.beat = p < .22 ? 0 : p < .43 ? 1 : p < .64 ? 2 : 3
}
