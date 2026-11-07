import type { JointFrame } from './timeline'
import type { SharedObject } from './scenes'

type Context = CanvasRenderingContext2D
export function drawJointGround(ctx: Context, frame: JointFrame): void {
  const { width: w, height: h, opacity } = frame
  const wash = ctx.createRadialGradient(w / 2, h * .80, 5, w / 2, h * .80, w * .36)
  wash.addColorStop(0, `rgba(176,215,222,${.19 * opacity})`); wash.addColorStop(1, 'rgba(176,215,222,0)')
  ctx.fillStyle = wash; ctx.beginPath(); ctx.ellipse(w / 2, h * .80, w * .36, 29, 0, 0, Math.PI * 2); ctx.fill()
  for (const a of frame.actors) {
    ctx.fillStyle = `rgba(42,71,79,${.13 * a.opacity * (1 - Math.min(.6, a.jump / 45))})`
    ctx.beginPath(); ctx.ellipse(a.root.x, a.root.y + 1, a.width * .25, 3.2, 0, 0, Math.PI * 2); ctx.fill()
  }
}

export function drawJointObjects(ctx: Context, frame: JointFrame): void {
  ctx.save(); ctx.globalAlpha = frame.opacity
  if (frame.blanket) {
    const { points, sag, opacity } = frame.blanket
    const sorted = [...points].sort((a, b) => a.x - b.x)
    const left = sorted[0], right = sorted.at(-1)!
    const middle = (left.x + right.x) / 2, y = (left.y + right.y) / 2
    ctx.save(); ctx.globalAlpha *= opacity
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = '#668da4'; ctx.fillStyle = '#c0e2ed'
    ctx.beginPath(); ctx.moveTo(left.x, left.y)
    if (sorted.length > 2) sorted.slice(1, -1).forEach((p) => ctx.lineTo(p.x, p.y))
    else ctx.quadraticCurveTo(middle, y + sag * 2, right.x, right.y)
    ctx.lineTo(right.x, right.y)
    ctx.quadraticCurveTo(middle, y + sag * 2 + 18, left.x, left.y)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#eefbff'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(left.x + 8, left.y + 6); ctx.quadraticCurveTo(middle, y + sag * 2 + 6, right.x - 8, right.y + 6); ctx.stroke()
    ctx.restore()
  }
  for (const object of frame.objects) drawObject(ctx, object)
  // A brief glint at a real joined hand, rather than a permanent badge above a head.
  if (frame.contact > .8 && frame.charge > .5) {
    ctx.strokeStyle = '#f5db92'; ctx.lineWidth = 1.5
    for (const connection of frame.links) {
      const p = connection.a; ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x - 8, p.y - 8)
      ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x + 8, p.y - 8); ctx.stroke()
    }
  }
  ctx.restore()
}

function drawObject(ctx: Context, object: SharedObject): void {
  const { center, radius: r, kind } = object
  ctx.save(); ctx.translate(center.x, center.y); ctx.globalAlpha *= object.opacity
  ctx.lineWidth = 1.7
  if (kind === 'bubble') {
    const glass = ctx.createRadialGradient(-r * .3, -r * .4, 1, 0, 0, r)
    glass.addColorStop(0, '#ffffff12'); glass.addColorStop(.70, '#addce421'); glass.addColorStop(1, '#9bb8ea65')
    ctx.fillStyle = glass; ctx.strokeStyle = '#8abfdb'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#fffdf0'; ctx.lineWidth = 3.3; ctx.beginPath(); ctx.arc(0, 0, r * .84, Math.PI * 1.08, Math.PI * 1.46); ctx.stroke()
    ctx.strokeStyle = '#edbfdd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * .94, .2, 1.1); ctx.stroke()
  } else if (kind === 'ball') {
    ctx.rotate(object.spin); ctx.strokeStyle = '#69432b'; ctx.fillStyle = '#f1a254'
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r)
    ctx.moveTo(-r * .7, -r * .7); ctx.quadraticCurveTo(r * .5, -r * .2, r * .7, r * .7)
    ctx.moveTo(r * .7, -r * .7); ctx.quadraticCurveTo(-r * .5, -r * .2, -r * .7, r * .7); ctx.stroke()
  } else {
    ctx.rotate(object.spin); ctx.fillStyle = '#f9d982'; ctx.strokeStyle = '#b99150'
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5, length = r * (i % 2 ? .48 : 1)
      const x = Math.cos(angle) * length, y = Math.sin(angle) * length
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    }
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#fff7d5'; ctx.beginPath(); ctx.ellipse(-r * .15, -r * .28, r * .11, r * .20, .4, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}
