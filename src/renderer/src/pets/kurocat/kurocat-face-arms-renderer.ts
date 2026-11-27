import type {
  KuroCatFxParticle,
  KuroCatPawState,
  KuroCatVisualContext
} from './kurocat-eyes-renderer'

export type {
  KuroCatFxParticle,
  KuroCatPawMode,
  KuroCatPawState,
  KuroCatSmearFrame,
  KuroCatVisualContext
} from './kurocat-eyes-renderer'
export { drawKuroCatCustomEyes, drawKuroCatEyes, drawKuroCatYawnOrLickMouth } from './kurocat-eyes-renderer'

export function parseKuroRgb(color: string): [number, number, number] | null {
  const c = color.trim()
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  return rgb ? [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])] : null
}

export function blendKuroHex(colorA: string, colorB: string, t: number): string {
  const a = parseKuroRgb(colorA), b = parseKuroRgb(colorB)
  if (!a || !b) return colorA
  const u = Math.max(0, Math.min(1, t))
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)}, ${Math.round(a[1] + (b[1] - a[1]) * u)}, ${Math.round(a[2] + (b[2] - a[2]) * u)})`
}

export function kuroColorWithAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  const c = color.trim()
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${a.toFixed(3)})`
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgb) {
    const baseA = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${(baseA * a).toFixed(3)})`
  }
  return c
}

function drawPlumpArm(
  ctx: CanvasRenderingContext2D,
  vc: KuroCatVisualContext,
  side: 'left' | 'right',
  sx: number,
  sy: number,
  px: number,
  py: number,
  squash: number,
  withCrease: boolean,
  isSmear = false
): void {
  const s = vc.customSkin
  if (s && s.isDarkBase && s.bellyBibColor) sx += side === 'left' ? -5 : 5
  const dx = px - sx, dy = py - sy
  const len = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / len, uy = dy / len
  const nx = -uy, ny = ux
  const wristDist = Math.max(6, len - 8)
  const wx = sx + ux * wristDist, wy = sy + uy * wristDist
  const rShoulder = s && s.isDarkBase && s.bellyBibColor ? 13.8 : 15.0
  const rWrist = 10.6
  const pawRx = 14.8 * (1 + squash * 0.14)
  const pawRy = 12.0 * (1 - squash * 0.12)
  const bowSide = side === 'left' ? -1 : 1
  const bowAmp = Math.min(7.5, len * 0.052)
  const midX = (sx + wx) * 0.5 + bowSide * bowAmp * Math.abs(uy)
  const midY = (sy + wy) * 0.5 + bowAmp * 0.45 * Math.abs(ux)

  const traceArm = (): void => {
    ctx.beginPath()
    ctx.moveTo(sx + nx * rShoulder, sy + ny * rShoulder)
    ctx.quadraticCurveTo(midX + nx * (rShoulder * 0.86), midY + ny * (rShoulder * 0.86), wx + nx * rWrist, wy + ny * rWrist)
    ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist)
    ctx.quadraticCurveTo(midX - nx * (rShoulder * 0.86), midY - ny * (rShoulder * 0.86), sx - nx * rShoulder, sy - ny * rShoulder)
    ctx.closePath()
  }

  ctx.save()
  const armCol = s ? s.armColor : vc.catBreed === 'ragdoll' ? '#f9f6ef' : '#141314'
  const pawCol = s ? s.pawColor : vc.catBreed === 'ragdoll' ? '#fcfaf4' : '#141314'
  const edgeCol = s ? (s.pawOutlineColor || s.outlineColor) : vc.catBreed === 'ragdoll' ? '#5d5148' : null
  const creaseCol = s ? s.armCreaseColor : vc.catBreed === 'ragdoll' ? null : 'rgba(216, 218, 222, 0.62)'

  if (isSmear) {
    const grad = ctx.createLinearGradient(sx, sy, px, py)
    grad.addColorStop(0.0, kuroColorWithAlpha(armCol, 0))
    grad.addColorStop(0.45, kuroColorWithAlpha(armCol, 0))
    grad.addColorStop(0.75, kuroColorWithAlpha(armCol, 0.58))
    grad.addColorStop(1.0, kuroColorWithAlpha(pawCol, 0.85))
    ctx.fillStyle = grad
  } else if (s && s.pattern === 'calico') {
    const patch = side === 'left' ? (s.maskColor || '#ea9446') : (s.calicoPatchColor || '#3c3634')
    const grad = ctx.createLinearGradient(sx, sy, px, py)
    grad.addColorStop(0.0, kuroColorWithAlpha(patch, 0))
    grad.addColorStop(0.10, patch)
    grad.addColorStop(0.46, armCol)
    grad.addColorStop(1.0, armCol)
    ctx.fillStyle = grad
  } else if (s && s.armColor.toLowerCase() !== s.furColor.toLowerCase()) {
    const flank = s.flankColor ? blendKuroHex(s.furSecondaryColor, s.flankColor, 0.45) : s.furColor
    const grad = ctx.createLinearGradient(sx, sy, px, py)
    grad.addColorStop(0.0, kuroColorWithAlpha(flank, 0))
    grad.addColorStop(0.14, flank)
    grad.addColorStop(0.56, blendKuroHex(flank, armCol, 0.55))
    grad.addColorStop(0.84, armCol)
    grad.addColorStop(1.0, pawCol)
    ctx.fillStyle = grad
  } else {
    const grad = ctx.createLinearGradient(sx, sy, px, py)
    grad.addColorStop(0.0, kuroColorWithAlpha(armCol, s || vc.catBreed === 'ragdoll' ? 0 : 1))
    grad.addColorStop(0.10, armCol)
    grad.addColorStop(1.0, armCol)
    ctx.fillStyle = grad
  }
  traceArm()
  ctx.fill()
  if (!isSmear && !s && vc.catBreed === 'black') {
    ctx.beginPath(); ctx.arc(sx, sy, rShoulder, 0, Math.PI * 2); ctx.fill()
  }

  if (!isSmear && s) {
    const armPart = side === 'left' ? 'leftArm' : 'rightArm'
    const spots = s.spots.filter((sp) => sp.part === armPart)
    if (spots.length > 0 && len > 24) {
      const armAng = Math.atan2(dy, dx)
      ctx.save(); traceArm(); ctx.clip()
      for (const sp of spots) {
        const frac = Math.max(0.1, Math.min(0.9, sp.x))
        ctx.fillStyle = kuroColorWithAlpha(sp.color, sp.opacity ?? 0.85)
        ctx.beginPath()
        ctx.ellipse(sx + ux * (len * frac) + nx * sp.y, sy + uy * (len * frac) + ny * sp.y, Math.max(2, sp.rx), Math.max(2, sp.ry), armAng + (sp.rotation || 0), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  ctx.fillStyle = pawCol
  ctx.beginPath(); ctx.ellipse(px, py, pawRx, pawRy, 0, 0, Math.PI * 2); ctx.fill()

  if (!isSmear && edgeCol) {
    ctx.lineWidth = 1.65; ctx.lineCap = 'round'
    const startFrac = withCrease ? 0.22 : 0.16
    for (const sgn of [-1, 1] as const) {
      const p0x = sx + nx * sgn * rShoulder, p0y = sy + ny * sgn * rShoulder
      const p1x = midX + nx * sgn * (rShoulder * 0.86), p1y = midY + ny * sgn * (rShoulder * 0.86)
      const p2x = wx + nx * sgn * rWrist, p2y = wy + ny * sgn * rWrist
      const q0x = p0x + (p1x - p0x) * startFrac, q0y = p0y + (p1y - p0y) * startFrac
      const q1x = p1x + (p2x - p1x) * startFrac, q1y = p1y + (p2y - p1y) * startFrac
      const esx = q0x + (q1x - q0x) * startFrac, esy = q0y + (q1y - q0y) * startFrac
      const edgeGrad = ctx.createLinearGradient(esx, esy, p2x, p2y)
      edgeGrad.addColorStop(0.0, kuroColorWithAlpha(edgeCol, 0))
      edgeGrad.addColorStop(0.28, kuroColorWithAlpha(edgeCol, 0.74))
      edgeGrad.addColorStop(1.0, kuroColorWithAlpha(edgeCol, 0.90))
      ctx.strokeStyle = edgeGrad
      ctx.beginPath(); ctx.moveTo(esx, esy); ctx.quadraticCurveTo(q1x, q1y, p2x, p2y); ctx.stroke()
    }
    const pawAng = Math.atan2(dy, dx)
    ctx.strokeStyle = kuroColorWithAlpha(edgeCol, 0.92)
    ctx.beginPath(); ctx.ellipse(px, py, pawRx, pawRy, 0, pawAng - Math.PI * 0.62, pawAng + Math.PI * 0.62); ctx.stroke()
  } else if (!isSmear && creaseCol && withCrease && len > 28) {
    for (const sgn of [-1, 1] as const) {
      const csx = sx + ux * (len * 0.20) + nx * sgn * (rShoulder * 0.86)
      const csy = sy + uy * (len * 0.20) + ny * sgn * (rShoulder * 0.86)
      const cex = sx + ux * (len * 0.76) + nx * sgn * (rWrist * 1.02)
      const cey = sy + uy * (len * 0.76) + ny * sgn * (rWrist * 1.02)
      const creaseGrad = ctx.createLinearGradient(csx, csy, cex, cey)
      creaseGrad.addColorStop(0.0, kuroColorWithAlpha(creaseCol, 0))
      creaseGrad.addColorStop(0.24, kuroColorWithAlpha(creaseCol, 0.85))
      creaseGrad.addColorStop(0.84, kuroColorWithAlpha(creaseCol, 0.70))
      creaseGrad.addColorStop(1.0, kuroColorWithAlpha(creaseCol, 0))
      ctx.strokeStyle = creaseGrad; ctx.lineWidth = 1.3; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(csx, csy); ctx.lineTo(cex, cey); ctx.stroke()
    }
  }
  ctx.restore()
}

export function drawKuroCatPaw(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, paw: KuroCatPawState, breath: number): void {
  const s = vc.customSkin
  const isRagdoll = vc.catBreed === 'ragdoll'
  const sign = paw.side === 'left' ? -1 : 1

  if (paw.idleWeight > 0.05) {
    ctx.save()
    ctx.globalAlpha = paw.idleWeight
    if (paw.side === 'right' && vc.leftPawMode === 'mouse') {
      const sh = vc.liveShoulder(paw, breath)
      const baseSp = vc.spinePoint(1.0, breath)
      drawPlumpArm(ctx, vc, 'right', sh.x, sh.y + 4, baseSp.x + 30, baseSp.y - 2, 0, true, false)
    } else {
      const topSp = vc.spinePoint(0.66, breath)
      const midSp = vc.spinePoint(0.84, breath)
      const botSp = vc.spinePoint(1.0, breath)
      if (s && s.pawColor !== s.furColor) {
        ctx.fillStyle = s.pawColor
        ctx.beginPath(); ctx.ellipse(botSp.x + sign * 22, botSp.y - 4, 13.5, 9.5, 0, 0, Math.PI * 2); ctx.fill()
      } else if (!s && isRagdoll && paw.side === 'right') {
        ctx.fillStyle = 'rgba(134, 118, 102, 0.80)'
        ctx.beginPath(); ctx.ellipse(midSp.x + 21, midSp.y + 12, 9.5, 13.5, 0.22, 0, Math.PI * 2); ctx.fill()
      }
      const lineCol = s ? s.legLineColor : isRagdoll ? 'rgba(93, 81, 72, 0.65)' : 'rgba(210, 212, 216, 0.64)'
      const lineGrad = ctx.createLinearGradient(topSp.x, topSp.y, botSp.x, botSp.y)
      lineGrad.addColorStop(0.0, kuroColorWithAlpha(lineCol, 0))
      lineGrad.addColorStop(0.18, lineCol); lineGrad.addColorStop(0.92, lineCol)
      lineGrad.addColorStop(1.0, kuroColorWithAlpha(lineCol, 0.35))
      ctx.strokeStyle = lineGrad; ctx.lineWidth = s || isRagdoll ? 1.55 : 1.4; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(topSp.x + sign * 41, topSp.y); ctx.quadraticCurveTo(midSp.x + sign * 41, midSp.y, botSp.x + sign * 35, botSp.y - 1); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(topSp.x + sign * 6.5, topSp.y + 10); ctx.lineTo(botSp.x + sign * 9.5, botSp.y - 1); ctx.stroke()
    }
    ctx.restore()
  }

  if (paw.curlWeight > 0.05) {
    const sh = vc.liveShoulder(paw, breath)
    const cp = vc.liveCurledPawPos(paw, breath)
    const elbowX = sh.x + sign * 8, elbowY = cp.y + 8
    const armCol = s ? s.armColor : isRagdoll ? '#f6f2ea' : '#141314'
    const pawCol = s ? s.pawColor : isRagdoll ? '#fcfaf4' : '#141314'
    const outlineCol = s ? (s.pawOutlineColor || s.legLineColor) : isRagdoll ? 'rgba(93, 81, 72, 0.72)' : 'rgba(218, 220, 224, 0.68)'
    ctx.save()
    ctx.globalAlpha = paw.curlWeight; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.strokeStyle = armCol; ctx.lineWidth = 20.5
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.quadraticCurveTo(elbowX, elbowY, cp.x, cp.y); ctx.stroke()
    ctx.fillStyle = pawCol
    ctx.beginPath(); ctx.ellipse(cp.x, cp.y, 12.6, 11.1, sign * 0.2, 0, Math.PI * 2); ctx.fill()
    const grad = ctx.createLinearGradient(elbowX, elbowY - 12, cp.x, cp.y + 12)
    grad.addColorStop(0.0, kuroColorWithAlpha(outlineCol, 0)); grad.addColorStop(0.30, outlineCol)
    grad.addColorStop(0.86, outlineCol); grad.addColorStop(1.0, kuroColorWithAlpha(outlineCol, 0.35))
    ctx.strokeStyle = grad; ctx.lineWidth = 1.55
    ctx.beginPath(); ctx.moveTo(elbowX + sign * 8, elbowY - 16)
    ctx.quadraticCurveTo(elbowX + sign * 4, elbowY + 12, cp.x + sign * 2, cp.y + 10)
    ctx.quadraticCurveTo(cp.x - sign * 11, cp.y + 8, cp.x - sign * 12, cp.y - 4); ctx.stroke()
    ctx.restore()
  }

  const activeArmWeight = Math.max(0, 1 - paw.idleWeight - paw.curlWeight)
  if (activeArmWeight > 0.05) {
    const sh = vc.liveShoulder(paw, breath)
    const mouseDrop = paw.mode === 'mouse' ? Math.max(vc.mouseLeftPress, vc.mouseRightPress, vc.mouseMiddlePress) * 1.8 : 0
    ctx.save()
    ctx.globalAlpha = Math.min(1, activeArmWeight * 1.2)
    const smearMult = s || isRagdoll ? 0.58 : 1.0
    for (const sm of paw.smears) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, sm.alpha * activeArmWeight * smearMult)
      drawPlumpArm(ctx, vc, paw.side, sm.sx, sm.sy, sm.px, sm.py, 0, false, true)
      ctx.restore()
    }
    drawPlumpArm(ctx, vc, paw.side, sh.x, sh.y, paw.pos.x, paw.pos.y + mouseDrop, paw.impactSquash, paw.mode !== 'mouse', false)
    ctx.restore()
  }
}

export function drawKuroCatAliveFx(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, particles: readonly KuroCatFxParticle[], breath: number): void {
  if (vc.crossAmount > 0.12) {
    const headPt = vc.spinePoint(0.18, breath)
    const sc = vc.crossAmount * (1 + 0.24 * Math.max(0, 1 - (vc.now - vc.lastSlamAt) / 250))
    ctx.save()
    ctx.translate(headPt.x - 57 + vc.faceTurnX * 0.4, headPt.y - 34)
    ctx.rotate(-0.14); ctx.scale(sc, sc); ctx.globalAlpha = Math.min(1, vc.crossAmount * 1.1); ctx.lineCap = 'round'
    for (const [col, w] of [['#fbfaf3', 5.2], ['#e2483d', 2.6]] as const) {
      ctx.strokeStyle = col; ctx.lineWidth = w
      for (const [ox, oy, a0, a1] of [[-6, -6, 0.05, 0.45], [6, -6, 0.55, 0.95], [6, 6, 1.05, 1.45], [-6, 6, 1.55, 1.95]] as const) {
        ctx.beginPath(); ctx.arc(ox, oy, 5.2, a0 * Math.PI, a1 * Math.PI); ctx.stroke()
      }
    }
    ctx.restore()
  }
  for (const fx of particles) {
    const age = vc.now - fx.createdAt
    const u = Math.max(0, Math.min(1, age / fx.lifetime))
    ctx.save()
    if (fx.kind === 'bang') {
      const s = fx.size * (0.55 + 0.65 * Math.min(1, u / 0.35))
      ctx.globalAlpha = u < 0.45 ? 1 : Math.max(0, 1 - (u - 0.45) / 0.55)
      ctx.translate(fx.x, fx.y); ctx.beginPath()
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, rad = i % 2 === 0 ? s : s * 0.46
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
      }
      ctx.closePath(); ctx.fillStyle = '#fbfaf3'; ctx.strokeStyle = '#1d1d1b'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke()
    } else if (fx.kind === 'dust') {
      ctx.globalAlpha = 0.85 * (1 - u); ctx.fillStyle = '#f4f1e6'; ctx.strokeStyle = '#b9b4a4'; ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.size * (0.65 + 0.85 * u), 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else if (fx.kind === 'z') {
      const sc = 0.72 + u * 0.55
      ctx.globalAlpha = Math.min(1, u / 0.16) * Math.max(0, Math.min(1, (1 - u) / 0.25))
      ctx.translate(fx.x + Math.sin(age * 0.0028) * 6.5, fx.y); ctx.scale(sc, sc)
      ctx.font = '800 18px "Comic Sans MS", "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 4.2
      ctx.strokeStyle = '#1d1d1b'; ctx.strokeText('Z', 0, 0); ctx.fillStyle = '#fbfaf3'; ctx.fillText('Z', 0, 0)
    } else if (fx.kind === 'heart') {
      const pop = Math.min(1, u / 0.18), sc = (0.65 + 0.45 * pop) * (1 - u * 0.15)
      ctx.globalAlpha = pop * Math.max(0, Math.min(1, (1 - u) / 0.30))
      ctx.translate(fx.x + Math.sin(age * 0.0055) * 5, fx.y); ctx.scale(sc, sc)
      const r = fx.size * 0.55
      ctx.beginPath(); ctx.moveTo(0, r * 0.9)
      ctx.bezierCurveTo(-r * 1.45, -r * 0.1, -r * 1.1, -r * 1.35, 0, -r * 0.45)
      ctx.bezierCurveTo(r * 1.1, -r * 1.35, r * 1.45, -r * 0.1, 0, r * 0.9)
      ctx.closePath(); ctx.fillStyle = '#ffcb52'; ctx.strokeStyle = '#241f1c'; ctx.lineWidth = 1.9; ctx.fill(); ctx.stroke()
    } else if (fx.kind === 'sparkle') {
      const pop = Math.sin(u * Math.PI), s = fx.size * (0.4 + 0.75 * pop)
      ctx.globalAlpha = Math.max(0, pop); ctx.translate(fx.x, fx.y); ctx.rotate(u * 0.75); ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, rad = i % 2 === 0 ? s : s * 0.28
        if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad)
      }
      ctx.closePath(); ctx.fillStyle = '#fff5b8'; ctx.strokeStyle = '#332e22'; ctx.lineWidth = 1.35; ctx.fill(); ctx.stroke()
    } else {
      const sc = 0.55 + u * 0.8
      ctx.globalAlpha = Math.max(0, (1 - u) * 0.92); ctx.translate(fx.x, fx.y); ctx.scale(sc, sc)
      ctx.strokeStyle = '#fbfaf3'; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(0, 0, fx.size * 0.55, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#e7f5ff'; ctx.fill()
    }
    ctx.restore()
  }
}
