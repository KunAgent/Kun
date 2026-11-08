import type { PetJointRig, PetRigPoint } from '@shared/pets-joint'
import { armWeight, clamp, skinPoint, type JointActor } from './geometry'

export type RigMesh = { points: PetRigPoint[]; indices: Uint16Array; vertices: Float32Array }
const axis = (extra: number[], divisions: number): number[] => [...new Set([...Array.from({ length: divisions + 1 }, (_, i) => i / divisions), ...extra])].sort((a, b) => a - b)

export function createRigMesh(rig: PetJointRig, divisions = 12): RigMesh {
  const controls = [...rig.arms.flatMap((a) => [a.shoulder, a.hand]), ...rig.feet, rig.head]
  const detail = rig.arms.flatMap((arm) => [-1, -.5, .5, 1].map((offset) => [arm.hand[0] + arm.radius * offset, arm.hand[1] + arm.radius * offset]))
  const xs = axis([...controls, ...detail].map((p) => p[0]), divisions), ys = axis([...controls, ...detail].map((p) => p[1]), divisions)
  const points = ys.flatMap((y) => xs.map((x): PetRigPoint => [x, y]))
  const indices: number[] = []
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1
    indices.push(a, b, c, b, d, c)
  }
  return { points, indices: new Uint16Array(indices), vertices: new Float32Array(points.length * 5) }
}

export function paintRigVertices(mesh: RigMesh, actor: JointActor, column: number): Float32Array {
  mesh.points.forEach((uv, i) => {
    const p = skinPoint(actor, uv), index = i * 5
    mesh.vertices[index] = p.x; mesh.vertices[index + 1] = p.y
    mesh.vertices[index + 2] = (column + uv[0]) / 7
    mesh.vertices[index + 3] = uv[1]
    let left = armWeight(actor, uv, 0) * actor.grips[0], right = armWeight(actor, uv, 1) * actor.grips[1]
    if (actor.frontArms) {
      left = Math.pow(left, .28); right = Math.pow(right, .28)
      if (actor.pet.id === 'kun:xiao-kun') {
        left *= clamp((.155 - uv[0]) / .015) * clamp((uv[1] - .53) / .04)
        right *= clamp((uv[0] - .695) / .025) * clamp((uv[1] - .59) / .04)
      }
    }
    mesh.vertices[index + 4] = Math.max(left, right)
  })
  return mesh.vertices
}
