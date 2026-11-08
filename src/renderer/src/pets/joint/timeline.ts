import type { PetKeyboardSurface } from '../typing/keyboard-surface'
import type { PetSummary } from '@shared/pets'
import { jointSceneFor } from '@shared/pets-joint'
import { PET_VISIT_ARRIVAL_MS, type PetVisit } from '@shared/pets-visits'
import { actor, ASPECT, clamp, cue, ease, grip, lerp, mix, resetLimbs, type JointActor, type Point } from './geometry'
import { sharedBall, sharedBubble, sharedDance, sharedStar, type SceneContext, type JointScene } from './scenes'

export type JointTimelineInput = {
  visit: PetVisit; now: number; cast: PetSummary[]; width: number; height: number; mascotWidth: number
  primaryOrigin: Point; reduced: boolean
}
export type JointFrame = JointScene & {
  keyboard?: PetKeyboardSurface
  phase: 'arriving' | 'playing' | 'departing'; progress: number; opacity: number; width: number; height: number
}

export function sampleJointVisit(input: JointTimelineInput): JointFrame {
  const { visit, cast, width, height, now, reduced } = input
  const arriveEnd = visit.startedAt + PET_VISIT_ARRIVAL_MS
  const departing = now >= visit.playUntil
  const phase = departing ? 'departing' : now < arriveEnd ? 'arriving' : 'playing'
  const play = clamp((Math.min(now, visit.playUntil) - arriveEnd) / Math.max(1, visit.plannedPlayUntil - arriveEnd))
  const p = reduced ? .48 : play
  const count = Math.max(1, cast.length), floor = height * .80
  const commonSize = Math.min(input.mascotWidth, 124, width / (count + .65), height * .38)
  const actors = cast.map((pet, i) => {
    const size = commonSize * (pet.sourceId === 'whale-girl' ? 1.08 : 1)
    const root = { x: width * (count === 1 ? .5 : count === 2 ? i === 0 ? .33 : .67 : [.29, .5, .71][i]),
      y: floor - (count === 3 && i === 1 ? 19 : 0) }
    return actor(pet, root, size)
  })
  const context: SceneContext = { scene: jointSceneFor(visit.scene), actors, width, height, floor, p,
    objects: [], links: [], blanket: null, charge: 0, contact: 0, beat: 0, focus: { x: width / 2, y: height * .6 } }
  if (context.scene === 'bubbles') sharedBubble(context)
  if (context.scene === 'beatbox') sharedBall(context)
  if (context.scene === 'dance') sharedDance(context)
  if (context.scene === 'cheer') sharedStar(context)
  const entry = ease((now - visit.startedAt) / PET_VISIT_ARRIVAL_MS)
  const exit = cue(now, visit.playUntil, visit.endsAt)
  const entryAtExit = ease((visit.playUntil - visit.startedAt) / PET_VISIT_ARRIVAL_MS)
  const ballOwner = Math.max(0, actors.findIndex((a) => a.pet.sourceId === 'ikun'))
  context.actors.forEach((a, i) => {
    const host = i === 0
    const startWidth = host ? input.mascotWidth : a.width
    const start = host ? { x: input.primaryOrigin.x,
      y: input.primaryOrigin.y + (a.rig.ground - .5) * startWidth * ASPECT }
      : { x: (i + Math.floor(visit.seed * 9)) % 2 ? width + a.width : -a.width, y: a.root.y }
    if (!reduced && (phase === 'arriving' || (departing && entryAtExit < 1))) {
      const amount = departing ? entryAtExit : entry
      transformActor(a, mix(start, a.root, amount), lerp(startWidth, a.width, amount))
      a.opacity = host ? 1 : amount
      a.step = amount > 0 && amount < 1 ? amount * Math.PI * 5 : 0
      a.lean = 0; a.crouch = 0; a.headTilt = 0; a.jump = 0; a.grips = [0, 0]
      a.soloBlend = host ? 1 - cue(amount, 0, .35) : 0
      resetLimbs(a)
      if (context.scene === 'beatbox' && i === ballOwner) {
        const next = actors.findIndex((_, n) => n !== ballOwner)
        const outgoing = (next > ballOwner ? 1 : 0) as 0 | 1
        const incoming = (host && a.pet.sourceId === 'ikun' ? 0 : outgoing) as 0 | 1
        const transfer = cue(amount, .38, .90)
        const held = mix(a.hands[incoming], a.hands[outgoing], transfer)
        context.objects[0].center = { x: held.x, y: held.y - 4 }
        context.objects[0].opacity = 1 - a.soloBlend
        grip(a, incoming, held, incoming === outgoing ? 1 : 1 - transfer)
        grip(a, outgoing, held, incoming === outgoing ? 1 : transfer)
      }
    }
    if (!reduced && departing) {
      const hands = [...a.hands] as JointActor['hands']
      transformActor(a, mix(a.root, start, exit), lerp(a.width, startWidth, exit))
      a.lean *= 1 - exit; a.crouch *= 1 - exit; a.headTilt *= 1 - exit; a.jump *= 1 - exit
      a.step = exit > .25 && exit < 1 ? exit * Math.PI * 5 : 0
      a.soloBlend = host ? cue(exit, .65, 1) : 0
      resetLimbs(a)
      const release = 1 - cue(exit, 0, .25)
      a.hands = a.hands.map((point, side) => mix(point, hands[side], release)) as JointActor['hands']
      a.grips = [a.grips[0] * release, a.grips[1] * release]
      a.opacity *= host ? 1 : 1 - exit
    }
    if (reduced) {
      a.lean = 0; a.crouch = 0; a.jump = 0; a.step = 0; a.headTilt = 0
      if (host) { transformActor(a, start, startWidth); a.soloBlend = 1 }
      resetLimbs(a)
      a.opacity = departing && exit >= 1 && !host ? 0 : 1
    }
  })
  const opacity = reduced ? 1 : departing ? 1 - cue(exit, 0, .65) : phase === 'arriving' ? entry : 1
  return { ...context, phase, progress: play, opacity, width, height }
}

function transformActor(a: JointActor, root: Point, width: number): void {
  const scale = width / a.width, old = a.root
  a.hands = a.hands.map((p) => ({ x: root.x + (p.x - old.x) * scale, y: root.y + (p.y - old.y) * scale })) as JointActor['hands']
  a.feet = a.feet.map((p) => ({ x: root.x + (p.x - old.x) * scale, y: root.y + (p.y - old.y) * scale })) as JointActor['feet']
  a.root = root; a.width = width
}

export function jointHitPath(frame: JointFrame): string {
  const ellipse = (x: number, y: number, rx: number, ry: number): string =>
    `M${x - rx},${y}a${rx},${ry} 0 1 0 ${rx * 2},0a${rx},${ry} 0 1 0 ${-rx * 2},0`
  const bodies = frame.actors.filter((a) => a.opacity > .08).map((a) =>
    ellipse(a.root.x, a.root.y - a.width * .41 - a.jump, a.width * .49, a.width * .50))
  if (frame.opacity > .1) {
    for (const object of frame.objects) if (object.opacity > .1) bodies.push(ellipse(object.center.x, object.center.y, object.radius + 3, object.radius + 3))
    if (frame.blanket && frame.blanket.opacity > .1) {
      const points = [...frame.blanket.points].sort((a, b) => a.x - b.x), first = points[0], last = points.at(-1)!
      bodies.push(`M${first.x},${first.y} ${points.slice(1).map((p) => `L${p.x},${p.y}`).join(' ')} Q${(first.x + last.x) / 2},${Math.max(first.y, last.y) + frame.blanket.sag * 2 + 18} ${first.x},${first.y}Z`)
    }
  }
  if (frame.keyboard && frame.keyboard.opacity > .1) {
    const k = frame.keyboard
    bodies.push(`M${k.x - 8},${k.y}h${k.width + 16}v${k.height + 14}h${-k.width - 16}Z`)
  }
  return bodies.join(' ')
}
