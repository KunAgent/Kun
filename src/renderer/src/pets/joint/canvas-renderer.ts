import { armLayerBounds, armLayerMatrix } from './arm-layer'
import { blinkCell, type JointTexture } from './assets'
import { createRigMesh, paintRigVertices, type RigMesh } from './mesh'
import type { JointFrame } from './timeline'
import { drawJointGround, drawJointObjects } from './draw-world'

/** Same joint geometry on machines without WebGL, using a coarser textured mesh. */
export class JointCanvasRenderer {
  private readonly resources = new Map<string, { mesh: RigMesh; atlas: HTMLCanvasElement; arms?: HTMLCanvasElement }>()
  constructor(private readonly ctx: CanvasRenderingContext2D, textures: JointTexture[], frame: JointFrame) {
    for (const a of frame.actors) {
      const source = textures.find((t) => t.id === a.pet.id)
      if (source) this.resources.set(a.pet.id, { atlas: source.atlas, arms: source.arms, mesh: createRigMesh(a.rig, 3) })
    }
  }
  paint(frame: JointFrame, elapsed: number, reduced: boolean): void {
    const { ctx } = this, canvas = ctx.canvas, ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(frame.width * ratio), height = Math.round(frame.height * ratio)
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawJointGround(ctx, frame)
    const ordered = frame.actors.map((a, i) => ({ a, i })).sort((x, y) => x.a.root.y - y.a.root.y)
    for (const handPass of [false, true]) {
      if (handPass) drawJointObjects(ctx, frame)
      for (const { a, i } of ordered) {
        const resource = this.resources.get(a.pet.id)
        if (!resource || a.opacity < .001) continue
        if (handPass && a.armLayers && resource.arms) {
          for (const side of [0, 1] as const) {
            const bounds = armLayerBounds(a.armLayers.cutouts[side]), m = armLayerMatrix(a, side)
            const x = bounds.left * 192, y = bounds.top * 208
            const w = (bounds.right - bounds.left) * 192, h = (bounds.bottom - bounds.top) * 208
            ctx.save(); ctx.globalAlpha = a.opacity * (1 - a.soloBlend)
            ctx.beginPath(); ctx.rect(0, 0, frame.width, a.armLayers.contactY[side] + .5); ctx.clip()
            ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
            ctx.drawImage(resource.arms, x, y, w, h, x, y, w, h); ctx.restore()
          }
          continue
        }
        const column = a.soloBlend > .5 ? 6 : blinkCell(elapsed, i, reduced)
        const data = paintRigVertices(resource.mesh, a, column)
        ctx.globalAlpha = a.opacity
        for (let t = 0; t < resource.mesh.indices.length; t += 3) {
          const indices = Array.from(resource.mesh.indices.subarray(t, t + 3))
          if (handPass && indices.reduce((n, index) => n + data[index * 5 + 4], 0) / 3 < .83) continue
          const source = indices.map((index) => resource.mesh.points[index].map((v, axis) => v * (axis ? 208 : 192)))
          const target = indices.map((index) => [data[index * 5], data[index * 5 + 1]])
          drawTriangle(ctx, resource.atlas, column, source, target)
        }
      }
    }
    ctx.globalAlpha = 1
  }
  dispose(): void { this.resources.clear() }
}

function drawTriangle(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, column: number, source: number[][], target: number[][]): void {
  const [s0, s1, s2] = source, [d0, d1, d2] = target
  const x1 = s1[0] - s0[0], y1 = s1[1] - s0[1], x2 = s2[0] - s0[0], y2 = s2[1] - s0[1]
  const determinant = x1 * y2 - x2 * y1
  if (Math.abs(determinant) < .0001) return
  const a = ((d1[0] - d0[0]) * y2 - (d2[0] - d0[0]) * y1) / determinant
  const b = ((d1[1] - d0[1]) * y2 - (d2[1] - d0[1]) * y1) / determinant
  const c = ((d2[0] - d0[0]) * x1 - (d1[0] - d0[0]) * x2) / determinant
  const d = ((d2[1] - d0[1]) * x1 - (d1[1] - d0[1]) * x2) / determinant
  ctx.save(); ctx.beginPath(); ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.clip()
  ctx.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1])
  ctx.drawImage(image, column * 192, 0, 192, 208, 0, 0, 192, 208); ctx.restore()
}
