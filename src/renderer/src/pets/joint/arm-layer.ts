import type { PetRigPoint } from '@shared/pets-joint'
import { bodyPoint, type JointActor, type Point } from './geometry'

export type ArmCutout = {
  contour: PetRigPoint[]; scale: number
  source?: { row: number; column: number; offset: PetRigPoint; mirrorX?: boolean }
  eraseContour?: PetRigPoint[] | null
  eraseFrom?: number
}
export type ArmCutouts = [ArmCutout, ArmCutout]
export type ArmLayers = { cutouts: ArmCutouts; contactY: [number, number] }
export type ArmMatrix = { a: number; b: number; c: number; d: number; e: number; f: number }

/** One rigid cutout per limb: no mesh weight can pull in a cheek, shirt or hair. */
export function armLayerMatrix(actor: JointActor, side: 0 | 1): ArmMatrix {
  const rig = actor.rig.arms[side], shoulder = bodyPoint(actor, rig.shoulder), hand = actor.hands[side]
  const sx = rig.shoulder[0] * 192, sy = rig.shoulder[1] * 208
  const vx = (rig.hand[0] - rig.shoulder[0]) * 192, vy = (rig.hand[1] - rig.shoulder[1]) * 208
  const tx = hand.x - shoulder.x, ty = hand.y - shoulder.y, length2 = vx * vx + vy * vy
  const a = (tx * vx + ty * vy) / length2, b = (ty * vx - tx * vy) / length2
  return { a, b, c: -b, d: a, e: shoulder.x - a * sx + b * sy, f: shoulder.y - b * sx - a * sy }
}

export function armLayerPoint(actor: JointActor, side: 0 | 1, uv: PetRigPoint): Point {
  const m = armLayerMatrix(actor, side), x = uv[0] * 192, y = uv[1] * 208
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/** A broad wing touches with its lower outline, which need not be the rig tip. */
export function armLayerContact(actor: JointActor, side: 0 | 1, cutout: ArmCutout): Point {
  return cutout.contour.map((uv) => armLayerPoint(actor, side, uv))
    .reduce((lowest, point) => point.y > lowest.y ? point : lowest)
}

export function armLayerBounds(cutout: ArmCutout): { left: number; top: number; right: number; bottom: number } {
  return { left: Math.min(...cutout.contour.map((p) => p[0])), right: Math.max(...cutout.contour.map((p) => p[0])),
    top: Math.min(...cutout.contour.map((p) => p[1])), bottom: Math.max(...cutout.contour.map((p) => p[1])) }
}

export function armLayerVertices(actor: JointActor, side: 0 | 1, column = 0): Float32Array {
  const bounds = armLayerBounds(actor.armLayers!.cutouts[side])
  const points: PetRigPoint[] = [[bounds.left, bounds.top], [bounds.right, bounds.top],
    [bounds.left, bounds.bottom], [bounds.right, bounds.bottom]]
  return new Float32Array(points.flatMap((uv) => {
    const world = armLayerPoint(actor, side, uv)
    return [world.x, world.y, (column + uv[0]) / 7, uv[1], 1]
  }))
}
