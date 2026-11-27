import type { ResolvedKuroCatSkin } from '@shared/pets-kurocat'
import {
  drawKuroCatEyes,
  drawKuroCatYawnOrLickMouth,
  type KuroCatVisualContext
} from './kurocat-eyes-renderer'
import type { Vec2 } from './kurocat-keyboard-desk'
import {
  drawCollarWithBell,
  drawHeadphonesBack,
  drawHeadphonesFront
} from './kurocat-tail-accessories'

export { drawKuroCatTail, type KuroCatTailState } from './kurocat-tail-accessories'

const BODY_SLICES: ReadonlyArray<{ t: number; hw: number }> = [
  { t: 0.12, hw: 49 },
  { t: 0.21, hw: 56 },
  { t: 0.30, hw: 60 },
  { t: 0.38, hw: 52 },
  { t: 0.47, hw: 54 },
  { t: 0.57, hw: 62 },
  { t: 0.68, hw: 70 },
  { t: 0.79, hw: 73 },
  { t: 0.90, hw: 69 },
  { t: 0.97, hw: 58 },
  { t: 1.00, hw: 46 }
]

export function drawKuroCatBody(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, breath: number, purrShift: number): void {
  if (vc.customSkin) {
    drawCustomBody(ctx, vc, vc.customSkin, breath, purrShift)
    drawCollarWithBell(ctx, vc, breath, purrShift)
    return
  }
  const isRagdoll = vc.catBreed === 'ragdoll'
  const catBlack = '#141314'
  const inkOutline = '#5d5148'
  const leftPts: Vec2[] = [], rightPts: Vec2[] = []
  const scruffSlim = Math.min(1, vc.scruffAmount) * 0.14
  const bellySwell = 1 + vc.typingHunch * 0.04 + vc.sleepAmount * 0.085 - scruffSlim
  const headCenter = vc.spinePoint(0.24, breath)
  const hcx = headCenter.x + purrShift, hcy = headCenter.y

  for (const slice of BODY_SLICES) {
    const sp = vc.spinePoint(slice.t, breath)
    const hw = slice.hw * (slice.t > 0.45 ? bellySwell : 1)
    if (slice.t <= 0.38) {
      const tiltW = slice.t <= 0.30 ? 1.0 : (0.42 - slice.t) / 0.12
      const ang = vc.headTilt * tiltW
      const cosA = Math.cos(ang), sinA = Math.sin(ang)
      const relY = sp.y - hcy
      const lx0 = sp.x + purrShift - hw - hcx, rx0 = sp.x + purrShift + hw - hcx
      leftPts.push({ x: hcx + lx0 * cosA - relY * sinA, y: hcy + lx0 * sinA + relY * cosA })
      rightPts.push({ x: hcx + rx0 * cosA - relY * sinA, y: hcy + rx0 * sinA + relY * cosA })
    } else {
      leftPts.push({ x: sp.x + purrShift - hw, y: sp.y })
      rightPts.push({ x: sp.x + purrShift + hw, y: sp.y })
    }
  }

  const crownRelY = vc.spinePoint(0.11, breath).y - hcy
  const crownPt = { x: hcx - crownRelY * Math.sin(vc.headTilt), y: hcy + crownRelY * Math.cos(vc.headTilt) }
  const basePt = vc.spinePoint(1.0, breath)

  ctx.save()
  ctx.fillStyle = isRagdoll ? '#f7f5f0' : catBlack
  ctx.strokeStyle = inkOutline
  ctx.lineWidth = 1.9
  const scDrop = Math.min(1, vc.scruffAmount) * 12
  const scSway = Math.min(1, vc.scruffAmount) * vc.scruffSwing * 14
  const scRot = Math.min(1, vc.scruffAmount) * vc.scruffSwing * 0.24
  const scSx = 1 - Math.min(1, vc.scruffAmount) * 0.14
  const scSy = 1 + Math.min(1, vc.scruffAmount) * 0.24
  for (const [fx, fy, rx, ry] of [
    [basePt.x - 42 + scSway, basePt.y - 3 + scDrop, 14.5 * scSx, 11.5 * scSy],
    [basePt.x + 32 + scSway, basePt.y - 1 + scDrop, 15.0 * scSx, 11.5 * scSy]
  ] as const) {
    ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, scRot, 0, Math.PI * 2); ctx.fill()
    if (isRagdoll) ctx.stroke()
  }

  const traceBody = (): void => {
    ctx.beginPath()
    const cc = Math.cos(vc.headTilt), cs = Math.sin(vc.headTilt)
    ctx.moveTo(leftPts[0].x + 14 * cc + 6 * cs, leftPts[0].y + 14 * cs - 6 * cc)
    ctx.quadraticCurveTo(crownPt.x, crownPt.y - 2, rightPts[0].x - 14 * cc + 6 * cs, rightPts[0].y - 14 * cs - 6 * cc)
    ctx.lineTo(rightPts[0].x, rightPts[0].y)
    for (let i = 0; i < rightPts.length - 1; i++) {
      const p0 = rightPts[i], p1 = rightPts[i + 1]
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5)
    }
    ctx.lineTo(rightPts[rightPts.length - 1].x, rightPts[rightPts.length - 1].y)
    ctx.quadraticCurveTo(basePt.x + purrShift, basePt.y + 6, leftPts[leftPts.length - 1].x, leftPts[leftPts.length - 1].y)
    for (let i = leftPts.length - 1; i > 0; i--) {
      const p0 = leftPts[i], p1 = leftPts[i - 1]
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5)
    }
    ctx.lineTo(leftPts[0].x, leftPts[0].y)
    ctx.closePath()
  }

  traceBody()
  if (isRagdoll) {
    const furGrad = ctx.createRadialGradient(hcx, hcy + 68, 18, basePt.x, basePt.y - 60, 148)
    furGrad.addColorStop(0.0, '#fbf9f3'); furGrad.addColorStop(0.68, '#f4f0e6'); furGrad.addColorStop(1.0, '#e8e2d6')
    ctx.fillStyle = furGrad; ctx.fill()

    ctx.save(); ctx.clip()
    const midTorso = vc.spinePoint(0.72, breath)
    for (const sgn of [-1, 1] as const) {
      const flankGrad = ctx.createRadialGradient(midTorso.x + purrShift + sgn * 70, midTorso.y + 8, 14, midTorso.x + purrShift + sgn * 50, midTorso.y + 10, 72)
      flankGrad.addColorStop(0.0, 'rgba(130, 115, 100, 0.78)'); flankGrad.addColorStop(0.5, 'rgba(156, 141, 126, 0.45)'); flankGrad.addColorStop(1.0, 'rgba(190, 178, 164, 0)')
      ctx.fillStyle = flankGrad
      ctx.beginPath(); ctx.ellipse(midTorso.x + purrShift + sgn * 60, midTorso.y + 8, 52, 84, sgn * -0.14, 0, Math.PI * 2); ctx.fill()
    }
    ctx.save(); ctx.translate(hcx, hcy); ctx.rotate(vc.headTilt)
    const maskShift = vc.faceTurnX * 0.72
    const capGrad = ctx.createLinearGradient(0, -40, 0, 22)
    capGrad.addColorStop(0.0, '#8d7d6e'); capGrad.addColorStop(0.5, '#9e8e7f'); capGrad.addColorStop(1.0, 'rgba(186, 173, 158, 0.14)')
    ctx.fillStyle = capGrad
    ctx.beginPath()
    ctx.moveTo(-74, -44); ctx.lineTo(74, -44); ctx.lineTo(70, 20)
    ctx.quadraticCurveTo(maskShift + 42, 18, maskShift + 26, 9)
    ctx.quadraticCurveTo(maskShift + 17, 0, maskShift + 13.5, -13)
    ctx.quadraticCurveTo(maskShift + 7, -21.5, maskShift, -22.5)
    ctx.quadraticCurveTo(maskShift - 7, -21.5, maskShift - 13.5, -13)
    ctx.quadraticCurveTo(maskShift - 17, 0, maskShift - 26, 9)
    ctx.quadraticCurveTo(maskShift - 42, 18, -70, 20)
    ctx.closePath(); ctx.fill()
    ctx.restore(); ctx.restore()

    traceBody(); ctx.strokeStyle = inkOutline; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke()
  } else {
    ctx.fillStyle = catBlack; ctx.fill()
  }

  ctx.save(); ctx.translate(hcx, hcy); ctx.rotate(vc.headTilt)
  const lTwitch = Math.sin(vc.earTwitchLeft * Math.PI) * 0.12 + vc.earFlickLeft + vc.groomEarPressLeft * 0.44
  const rTwitch = Math.sin(vc.earTwitchRight * Math.PI) * 0.12 + vc.earFlickRight + vc.groomEarPressRight * 0.44
  const airplaneDrop = Math.max(0, -vc.earPerk) * 11, airplaneSpread = Math.max(0, -vc.earPerk) * 6

  const drawEar = (sideSign: -1 | 1, twitch: number): void => {
    ctx.save()
    ctx.translate(sideSign * (33 + airplaneSpread) + vc.faceTurnX * 0.18, -28 + airplaneDrop)
    ctx.rotate(sideSign * (0.08 - vc.earPerk + twitch))
    ctx.beginPath()
    ctx.moveTo(sideSign * 19, 20)
    ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21)
    ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * -21, 8)
    ctx.closePath()
    if (isRagdoll) {
      const g = ctx.createLinearGradient(0, -23, 0, 18)
      g.addColorStop(0.0, '#463b33'); g.addColorStop(1.0, '#9c8d7e')
      ctx.fillStyle = g; ctx.fill()
      ctx.strokeStyle = '#473c34'; ctx.lineWidth = 1.9; ctx.stroke()
      ctx.fillStyle = '#dec4be'; ctx.beginPath()
      ctx.moveTo(sideSign * 11, 10); ctx.bezierCurveTo(sideSign * 11, -3, sideSign * 7, -13, sideSign * 2, -11)
      ctx.bezierCurveTo(sideSign * -4, -9, sideSign * -9, -1, sideSign * -10, 8); ctx.closePath(); ctx.fill()
    } else {
      ctx.fillStyle = catBlack; ctx.fill()
    }
    ctx.restore()
  }

  drawHeadphonesBack(ctx, vc)
  drawEar(-1, lTwitch); drawEar(1, rTwitch)

  const wShift = vc.faceTurnX * 0.72
  const blushBoost = Math.max(vc.squintAmount, vc.chinAmount * 1.15, vc.kneadAmount * 0.85)
  if (isRagdoll) {
    if (blushBoost > 0.12) {
      ctx.fillStyle = `rgba(244, 146, 166, ${(0.44 * Math.min(1.15, blushBoost)).toFixed(3)})`
      ctx.beginPath(); ctx.ellipse(wShift - 30, 13, 8.5, 4.6, -0.08, 0, Math.PI * 2); ctx.ellipse(wShift + 30, 13, 8.5, 4.6, 0.08, 0, Math.PI * 2); ctx.fill()
    }
    const noseY = -1.4 * vc.boopCrossEye - 1.3 * vc.yawnAmount
    ctx.fillStyle = '#ee8e9e'; ctx.beginPath()
    ctx.moveTo(wShift - 4.1, 9.6 + noseY); ctx.quadraticCurveTo(wShift, 8.5 + noseY, wShift + 4.1, 9.6 + noseY)
    ctx.quadraticCurveTo(wShift + 3.2, 13.8 + noseY, wShift, 14.3 + noseY); ctx.quadraticCurveTo(wShift - 3.2, 13.8 + noseY, wShift - 4.1, 9.6 + noseY)
    ctx.closePath(); ctx.fill()
    if (vc.yawnAmount < 0.25) {
      ctx.save(); ctx.globalAlpha = 1 - vc.yawnAmount / 0.25
      ctx.strokeStyle = 'rgba(72, 77, 92, 0.80)'; ctx.lineWidth = 1.35; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(wShift - 5.8, 16.6); ctx.quadraticCurveTo(wShift - 2.9, 19.6, wShift, 16.4); ctx.quadraticCurveTo(wShift + 2.9, 19.6, wShift + 5.8, 16.6); ctx.stroke()
      ctx.restore()
    }
  } else if (vc.chinAmount > 0.2) {
    ctx.fillStyle = `rgba(255, 168, 186, ${(0.24 * vc.chinAmount).toFixed(3)})`
    ctx.beginPath(); ctx.ellipse(wShift - 30, 14, 7.5, 4.0, -0.08, 0, Math.PI * 2); ctx.ellipse(wShift + 30, 14, 7.5, 4.0, 0.08, 0, Math.PI * 2); ctx.fill()
  }
  drawKuroCatYawnOrLickMouth(ctx, vc, wShift, isRagdoll ? '#473c34' : '#3a232b')

  ctx.strokeStyle = isRagdoll ? 'rgba(98, 86, 76, 0.52)' : 'rgba(205, 208, 214, 0.54)'
  ctx.lineWidth = isRagdoll ? 1.15 : 1.05; ctx.lineCap = 'round'
  const leftLen = Math.max(8, 12 - vc.faceTurnX * 0.55), rightLen = Math.max(8, 12 + vc.faceTurnX * 0.55)
  for (let i = 0; i < 3; i++) {
    const wy = 16 + i * 5, slant = 2 + i * 1.1
    ctx.beginPath(); ctx.moveTo(-34 + wShift, wy); ctx.lineTo(-34 + wShift - leftLen, wy + slant)
    ctx.moveTo(34 + wShift, wy); ctx.lineTo(34 + wShift + rightLen, wy + slant); ctx.stroke()
  }
  drawKuroCatEyes(ctx, vc, wShift, -1)
  drawHeadphonesFront(ctx, vc)
  ctx.restore(); ctx.restore()

  drawCollarWithBell(ctx, vc, breath, purrShift)
}

function drawCustomBody(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, s: ResolvedKuroCatSkin, breath: number, purrShift: number): void {
  const leftPts: Vec2[] = [], rightPts: Vec2[] = []
  const scruffSlim = Math.min(1, vc.scruffAmount) * 0.14
  const bellySwell = 1 + vc.typingHunch * 0.04 + vc.sleepAmount * 0.085 - scruffSlim
  const headCenter = vc.spinePoint(0.24, breath)
  const hcx = headCenter.x + purrShift, hcy = headCenter.y
  const contour = s.contour
  const hwScale = contour.headWidth, jawSq = contour.jawSquareness, chubby = contour.bodyChubbiness
  const isFox = contour.faceShape === 'fox', isOval = contour.faceShape === 'oval'

  for (const slice of BODY_SLICES) {
    const sp = vc.spinePoint(slice.t, breath)
    const mult = slice.t <= 0.14 ? hwScale * (1 + jawSq * 0.08) * (isOval ? 0.94 : 1)
      : slice.t <= 0.24 ? hwScale * (1 + jawSq * 0.10) * (isOval ? 0.96 : 1)
      : slice.t <= 0.33 ? hwScale * (1 + jawSq * 0.11) * (isFox ? 0.88 : 1)
      : slice.t <= 0.40 ? (hwScale * 0.48 + chubby * 0.52) * (1 + jawSq * 0.08) * (isFox ? 0.90 : 1)
      : chubby * (slice.t > 0.45 ? bellySwell : 1)
    const hw = slice.hw * mult
    if (slice.t <= 0.38) {
      const tiltW = slice.t <= 0.30 ? 1.0 : (0.42 - slice.t) / 0.12
      const ang = vc.headTilt * tiltW, cosA = Math.cos(ang), sinA = Math.sin(ang), relY = sp.y - hcy
      const lx0 = sp.x + purrShift - hw - hcx, rx0 = sp.x + purrShift + hw - hcx
      leftPts.push({ x: hcx + lx0 * cosA - relY * sinA, y: hcy + lx0 * sinA + relY * cosA })
      rightPts.push({ x: hcx + rx0 * cosA - relY * sinA, y: hcy + rx0 * sinA + relY * cosA })
    } else {
      leftPts.push({ x: sp.x + purrShift - hw, y: sp.y })
      rightPts.push({ x: sp.x + purrShift + hw, y: sp.y })
    }
  }

  const crownRelY = vc.spinePoint(0.11, breath).y - hcy - jawSq * 1.5 - (isOval ? 6 : 0)
  const crownPt = { x: hcx - crownRelY * Math.sin(vc.headTilt), y: hcy + crownRelY * Math.cos(vc.headTilt) }
  const basePt = vc.spinePoint(1.0, breath)

  ctx.save()
  ctx.fillStyle = s.pawColor; ctx.strokeStyle = s.pawOutlineColor || s.outlineColor || 'transparent'; ctx.lineWidth = 1.85
  const scDrop = Math.min(1, vc.scruffAmount) * 12, scSway = Math.min(1, vc.scruffAmount) * vc.scruffSwing * 14
  const scRot = Math.min(1, vc.scruffAmount) * vc.scruffSwing * 0.24
  const scSx = 1 - Math.min(1, vc.scruffAmount) * 0.14, scSy = 1 + Math.min(1, vc.scruffAmount) * 0.24
  for (const [fx, fy, rx, ry] of [
    [basePt.x - 42 + scSway, basePt.y - 3 + scDrop, 14.5 * scSx, 11.5 * scSy],
    [basePt.x + 32 + scSway, basePt.y - 1 + scDrop, 15.0 * scSx, 11.5 * scSy]
  ] as const) {
    ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, scRot, 0, Math.PI * 2); ctx.fill()
    if (s.pawOutlineColor || s.outlineColor) ctx.stroke()
  }

  const traceBody = (): void => {
    ctx.beginPath()
    const cc = Math.cos(vc.headTilt), cs = Math.sin(vc.headTilt)
    const inset = 14 * (1 - jawSq * 0.35), lift = 6 * (1 - jawSq * 0.30) + (isOval ? 3 : 0), arch = -2 + jawSq * 1.4 - (isOval ? 4 : 0)
    ctx.moveTo(leftPts[0].x + inset * cc + lift * cs, leftPts[0].y + inset * cs - lift * cc)
    ctx.quadraticCurveTo(crownPt.x, crownPt.y + arch, rightPts[0].x - inset * cc + lift * cs, rightPts[0].y - inset * cs - lift * cc)
    ctx.lineTo(rightPts[0].x, rightPts[0].y)
    for (let i = 0; i < rightPts.length - 1; i++) {
      const p0 = rightPts[i], p1 = rightPts[i + 1], k = jawSq > 0.35 && i <= 2 ? 0.5 + jawSq * 0.36 : 0.5
      ctx.quadraticCurveTo(p0.x, p0.y, p0.x + (p1.x - p0.x) * k, p0.y + (p1.y - p0.y) * k)
    }
    ctx.lineTo(rightPts[rightPts.length - 1].x, rightPts[rightPts.length - 1].y)
    ctx.quadraticCurveTo(basePt.x + purrShift, basePt.y + 6, leftPts[leftPts.length - 1].x, leftPts[leftPts.length - 1].y)
    for (let i = leftPts.length - 1; i > 0; i--) {
      const p0 = leftPts[i], p1 = leftPts[i - 1], k = jawSq > 0.35 && i <= 3 ? 0.5 + jawSq * 0.36 : 0.5
      ctx.quadraticCurveTo(p0.x, p0.y, p0.x + (p1.x - p0.x) * k, p0.y + (p1.y - p0.y) * k)
    }
    ctx.lineTo(leftPts[0].x, leftPts[0].y); ctx.closePath()
  }

  traceBody()
  const furGrad = ctx.createRadialGradient(hcx, hcy + 65, 18, basePt.x, basePt.y - 60, 150)
  furGrad.addColorStop(0, s.furColor); furGrad.addColorStop(1, s.furSecondaryColor)
  ctx.fillStyle = furGrad; ctx.fill()

  ctx.save(); ctx.clip()
  const midTorso = vc.spinePoint(0.70, breath), chestSp = vc.spinePoint(0.56, breath)
  if (s.flankColor) {
    ctx.save(); ctx.globalAlpha = 0.62; ctx.fillStyle = s.flankColor
    for (const sgn of [-1, 1] as const) { ctx.beginPath(); ctx.ellipse(midTorso.x + purrShift + sgn * 62, midTorso.y + 6, 48, 82, sgn * -0.14, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
  }
  if (s.bellyBibColor) {
    ctx.fillStyle = s.bellyBibColor; ctx.beginPath(); ctx.ellipse(chestSp.x + purrShift, chestSp.y + 38, 36, 62, 0, 0, Math.PI * 2); ctx.fill()
  }
  if (s.pattern === 'tabby' && s.stripeColor) {
    ctx.save(); ctx.strokeStyle = s.stripeColor; ctx.lineCap = 'round'; ctx.lineWidth = 4.6; ctx.globalAlpha = 0.65
    for (const sgn of [-1, 1] as const) {
      for (let i = 0; i < 4; i++) {
        const ty = midTorso.y - 26 + i * 20
        ctx.beginPath(); ctx.moveTo(midTorso.x + purrShift + sgn * 74, ty)
        ctx.quadraticCurveTo(midTorso.x + purrShift + sgn * 56, ty + 3, midTorso.x + purrShift + sgn * 42, ty + 7); ctx.stroke()
      }
    }
    ctx.restore()
  }
  if (s.pattern === 'calico') {
    ctx.fillStyle = s.maskColor || '#ea9446'; ctx.beginPath(); ctx.ellipse(midTorso.x + purrShift - 54, midTorso.y + 10, 38, 52, -0.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = s.calicoPatchColor || '#3c3634'; ctx.beginPath(); ctx.ellipse(midTorso.x + purrShift + 56, midTorso.y - 4, 36, 56, 0.18, 0, Math.PI * 2); ctx.fill()
  }
  for (const spot of s.spots) {
    if (spot.part !== 'body') continue
    ctx.save(); ctx.globalAlpha = spot.opacity ?? 0.85; ctx.fillStyle = spot.color
    ctx.beginPath(); ctx.ellipse(midTorso.x + purrShift + spot.x * 65, midTorso.y + spot.y * 65, Math.max(2, spot.rx), Math.max(2, spot.ry), spot.rotation || 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  ctx.save(); ctx.translate(hcx, hcy); ctx.rotate(vc.headTilt)
  const maskShift = vc.faceTurnX * 0.72
  if (s.pattern === 'bicolor' && s.maskColor) {
    ctx.fillStyle = s.maskColor; ctx.beginPath()
    ctx.moveTo(-74, -44); ctx.lineTo(74, -44); ctx.lineTo(70, 20)
    ctx.quadraticCurveTo(maskShift + 42, 18, maskShift + 26, 9); ctx.quadraticCurveTo(maskShift + 17, 0, maskShift + 13.5, -13)
    ctx.quadraticCurveTo(maskShift + 7, -21.5, maskShift, -22.5); ctx.quadraticCurveTo(maskShift - 7, -21.5, maskShift - 13.5, -13)
    ctx.quadraticCurveTo(maskShift - 17, 0, maskShift - 26, 9); ctx.quadraticCurveTo(maskShift - 42, 18, -70, 20); ctx.closePath(); ctx.fill()
    if (s.foreheadBridgeColor) { ctx.fillStyle = s.foreheadBridgeColor; ctx.beginPath(); ctx.ellipse(maskShift, -32, 18, 9, 0, 0, Math.PI * 2); ctx.fill() }
  } else if (s.pattern === 'tuxedo' && s.bellyBibColor) {
    ctx.fillStyle = s.bellyBibColor; ctx.beginPath(); ctx.ellipse(maskShift, 22, 26, 15, 0, 0, Math.PI * 2); ctx.fill()
  } else if (s.pattern === 'siamese' && s.maskColor) {
    ctx.fillStyle = s.maskColor; ctx.beginPath(); ctx.ellipse(maskShift, 3, 42, 27, 0, 0, Math.PI * 2); ctx.fill()
  } else if (s.pattern === 'calico') {
    ctx.fillStyle = s.maskColor || '#ea9446'; ctx.beginPath(); ctx.ellipse(-34 + maskShift * 0.4, -18, 34, 28, -0.25, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = s.calicoPatchColor || '#3c3634'; ctx.beginPath(); ctx.ellipse(36 + maskShift * 0.4, -16, 32, 26, 0.25, 0, Math.PI * 2); ctx.fill()
  } else if (s.pattern === 'tabby' && s.stripeColor) {
    ctx.save(); ctx.strokeStyle = s.stripeColor; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.globalAlpha = 0.78
    ctx.beginPath()
    ctx.moveTo(maskShift - 11, -30); ctx.lineTo(maskShift - 8, -19)
    ctx.moveTo(maskShift, -32); ctx.lineTo(maskShift, -18)
    ctx.moveTo(maskShift + 11, -30); ctx.lineTo(maskShift + 8, -19); ctx.stroke()
    ctx.lineWidth = 2.8
    for (const sgn of [-1, 1] as const) {
      ctx.beginPath(); ctx.moveTo(sgn * 58, 6); ctx.lineTo(sgn * 42, 9); ctx.moveTo(sgn * 56, 14); ctx.lineTo(sgn * 41, 16); ctx.stroke()
    }
    ctx.restore()
  }
  for (const spot of s.spots) {
    if (spot.part !== 'head') continue
    ctx.save(); ctx.globalAlpha = spot.opacity ?? 0.85; ctx.fillStyle = spot.color
    ctx.beginPath(); ctx.ellipse(maskShift + spot.x * 52, spot.y * 36, Math.max(2, spot.rx), Math.max(2, spot.ry), spot.rotation || 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  ctx.restore(); ctx.restore()

  if (s.outlineColor) {
    traceBody(); ctx.strokeStyle = s.outlineColor; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke()
  }

  ctx.save(); ctx.translate(hcx, hcy); ctx.rotate(vc.headTilt)
  const lTwitch = Math.sin(vc.earTwitchLeft * Math.PI) * 0.12 + vc.earFlickLeft + vc.groomEarPressLeft * 0.44
  const rTwitch = Math.sin(vc.earTwitchRight * Math.PI) * 0.12 + vc.earFlickRight + vc.groomEarPressRight * 0.44
  const airplaneDrop = Math.max(0, -vc.earPerk) * 11, airplaneSpread = Math.max(0, -vc.earPerk) * 6
  const earShape = contour.earShape, earScale = contour.earScale
  const earMountX = (33 * (0.45 + 0.55 * hwScale) + jawSq * 5 + (earShape === 'floppy' ? 6.5 : earShape === 'folded' ? 3.5 : 0)) * contour.earSpacing
  const earMountY = -28 - jawSq * 2.5 - (isOval ? 3.5 : 0) + (earShape === 'floppy' ? 11.5 : earShape === 'folded' ? 5.5 : 0)

  const drawCustomEar = (sideSign: -1 | 1, twitch: number): void => {
    ctx.save()
    ctx.translate(sideSign * (earMountX + airplaneSpread) + vc.faceTurnX * 0.18, earMountY + airplaneDrop)
    const baseRot = earShape === 'wide' ? 0.28 : earShape === 'folded' ? 0.34 : earShape === 'floppy' ? 0.14 : 0.08
    ctx.rotate(sideSign * (baseRot + contour.earTilt - vc.earPerk + twitch))
    ctx.scale(earScale, earScale)

    const earPath = (strokeOnly: boolean): void => {
      ctx.beginPath()
      if (earShape === 'round') { ctx.arc(sideSign * 1, -2, 17.5, Math.PI * 0.92, Math.PI * 2.08); if (!strokeOnly) ctx.closePath() }
      else if (earShape === 'tall') {
        ctx.moveTo(sideSign * 16, 18); ctx.bezierCurveTo(sideSign * 18, -12, sideSign * 11, -38, sideSign * 2, -37)
        ctx.bezierCurveTo(sideSign * -8, -34, sideSign * -15, -14, sideSign * -17, 10); if (!strokeOnly) ctx.closePath()
      } else if (earShape === 'small') {
        ctx.moveTo(sideSign * 14, 12); ctx.bezierCurveTo(sideSign * 14, -4, sideSign * 9, -15, sideSign * 2, -14)
        ctx.bezierCurveTo(sideSign * -6, -13, sideSign * -12, -3, sideSign * -14, 8); if (!strokeOnly) ctx.closePath()
      } else if (earShape === 'wide') {
        ctx.moveTo(sideSign * 24, 20); ctx.bezierCurveTo(sideSign * 28, -8, sideSign * 20, -28, sideSign * 7, -27)
        ctx.bezierCurveTo(sideSign * -8, -23, sideSign * -18, -8, sideSign * -22, 10); if (!strokeOnly) ctx.closePath()
      } else if (earShape === 'folded') {
        ctx.moveTo(sideSign * -15, 7); ctx.bezierCurveTo(sideSign * -12, -8, sideSign * 2, -15, sideSign * 14, -6)
        ctx.bezierCurveTo(sideSign * 23, 1, sideSign * 24, 15, sideSign * 13, 19); ctx.bezierCurveTo(sideSign * 4, 21, sideSign * -7, 15, sideSign * -15, 7)
        if (!strokeOnly) ctx.closePath()
      } else if (earShape === 'floppy') {
        ctx.moveTo(sideSign * -10, -4); ctx.bezierCurveTo(sideSign * 2, -12, sideSign * 16, -6, sideSign * 20, 10)
        ctx.bezierCurveTo(sideSign * 25, 29, sideSign * 18, 46, sideSign * 7, 45); ctx.bezierCurveTo(sideSign * -5, 44, sideSign * -12, 26, sideSign * -11, 8)
        if (!strokeOnly) ctx.closePath()
      } else {
        ctx.moveTo(sideSign * 19, strokeOnly ? 17 : 20); ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21)
        ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * (strokeOnly ? -19 : -21), strokeOnly ? 5 : 8)
        if (!strokeOnly) ctx.closePath()
      }
    }

    const baseEarCol = s.pattern === 'calico' && sideSign === -1 ? (s.maskColor || s.earOuterColor) : s.earOuterColor
    const earGrad = ctx.createLinearGradient(0, earShape === 'tall' ? -37 : -23, 0, earShape === 'floppy' ? 46 : 18)
    earGrad.addColorStop(0, s.earTipColor || baseEarCol); earGrad.addColorStop(1, baseEarCol)
    ctx.fillStyle = earGrad; earPath(false); ctx.fill()
    if (s.outlineColor) { ctx.strokeStyle = s.outlineColor; ctx.lineWidth = 1.85 / Math.max(0.7, earScale); ctx.lineCap = 'round'; earPath(true); ctx.stroke() }
    if (s.earInnerColor && earShape !== 'folded') {
      ctx.fillStyle = s.earInnerColor; ctx.beginPath()
      if (earShape === 'round') ctx.arc(sideSign * 1, -1, 10.2, Math.PI * 0.95, Math.PI * 2.05)
      else if (earShape === 'floppy') ctx.ellipse(sideSign * 4, 22, 6.2, 13.5, sideSign * -0.1, 0, Math.PI * 2)
      else {
        const sMul = earShape === 'tall' ? 1.7 : earShape === 'small' ? 0.7 : 1
        ctx.moveTo(sideSign * 10, 9); ctx.bezierCurveTo(sideSign * 10, -3 * sMul, sideSign * 6, -13 * sMul, sideSign * 2, -11 * sMul)
        ctx.bezierCurveTo(sideSign * -4, -9 * sMul, sideSign * -8, -1, sideSign * -9, 7)
      }
      ctx.closePath(); ctx.fill()
    }
    ctx.restore()
  }

  drawHeadphonesBack(ctx, vc)
  drawCustomEar(-1, lTwitch); drawCustomEar(1, rTwitch)

  const wShift = vc.faceTurnX * 0.72
  const blushAmt = Math.max(contour.blushAlways ? 0.62 : 0, vc.squintAmount, vc.chinAmount * 1.15, vc.kneadAmount * 0.85)
  const blushX = 30 * (0.55 + 0.45 * contour.eyeSpacing), blushY = 13 + contour.eyeOffsetY * 6
  if ((s.blushColor || contour.blushAlways) && blushAmt > 0.12) {
    ctx.save(); ctx.globalAlpha = 0.42 * Math.min(1.15, blushAmt); ctx.fillStyle = s.blushColor || '#ffa8ba'
    ctx.beginPath()
    ctx.ellipse(wShift - blushX, blushY, 8.5 * contour.blushScale, 4.6 * contour.blushScale, -0.08, 0, Math.PI * 2)
    ctx.ellipse(wShift + blushX, blushY, 8.5 * contour.blushScale, 4.6 * contour.blushScale, 0.08, 0, Math.PI * 2)
    ctx.fill(); ctx.restore()
  }

  const noseBaseY = 11.4 + contour.noseOffsetY * 7 - 1.4 * vc.boopCrossEye - 1.3 * vc.yawnAmount
  if (s.noseColor && contour.noseShape !== 'none') {
    ctx.save(); ctx.translate(wShift, noseBaseY); ctx.scale(contour.noseScale, contour.noseScale); ctx.fillStyle = s.noseColor; ctx.beginPath()
    if (contour.noseShape === 'round' || contour.noseShape === 'small') {
      const nr = contour.noseShape === 'small' ? 2.6 : 4.3
      ctx.ellipse(0, 0, nr, nr * 0.76, 0, 0, Math.PI * 2)
    } else {
      const nw = contour.noseShape === 'wide' ? 6.2 : 4.1
      ctx.moveTo(-nw, -1.8); ctx.quadraticCurveTo(0, -3.0, nw, -1.8)
      ctx.quadraticCurveTo(nw * 0.8, 2.5, 0, 3.0); ctx.quadraticCurveTo(-nw * 0.8, 2.5, -nw, -1.8); ctx.closePath()
    }
    ctx.fill(); ctx.restore()
  }

  const mouthBaseY = 16.6 + contour.mouthOffsetY * 7
  if (s.mouthColor && contour.mouthShape !== 'none' && vc.yawnAmount < 0.25) {
    ctx.save(); ctx.globalAlpha = 1 - vc.yawnAmount / 0.25; ctx.translate(wShift, mouthBaseY); ctx.scale(contour.mouthScale, contour.mouthScale)
    ctx.strokeStyle = s.mouthColor; ctx.lineWidth = 1.35 / Math.max(0.75, Math.sqrt(contour.mouthScale)); ctx.lineCap = 'round'
    if (contour.mouthShape === 'smile') {
      ctx.beginPath(); ctx.moveTo(-6.2, -0.5); ctx.quadraticCurveTo(0, 4.6, 6.2, -0.5); ctx.stroke()
    } else if (contour.mouthShape === 'flat') {
      ctx.beginPath(); ctx.moveTo(-5.8, 0.6); ctx.quadraticCurveTo(0, 0.2, 5.8, 0.6); ctx.stroke()
    } else if (contour.mouthShape === 'open') {
      ctx.fillStyle = '#c85b6f'; ctx.beginPath(); ctx.ellipse(0, 1.5, 3.2, 3.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else {
      if (contour.mouthShape === 'blep') {
        ctx.fillStyle = '#f489a0'; ctx.beginPath(); ctx.moveTo(-2.7, 0.6); ctx.bezierCurveTo(-3, 5.6, 3, 5.6, 2.7, 0.6); ctx.closePath(); ctx.fill()
      }
      ctx.beginPath(); ctx.moveTo(-5.8, 0); ctx.quadraticCurveTo(-2.9, 3, 0, -0.2); ctx.quadraticCurveTo(2.9, 3, 5.8, 0); ctx.stroke()
    }
    ctx.restore()
  }
  drawKuroCatYawnOrLickMouth(ctx, vc, wShift, s.mouthColor || s.outlineColor || '#3a232b')

  if (contour.whiskerLength > 0.01) {
    const wx0 = 34 * (0.55 + 0.45 * hwScale)
    ctx.strokeStyle = s.whiskerColor; ctx.lineWidth = 1.1; ctx.lineCap = 'round'
    const lLen = Math.max(8, 12 - vc.faceTurnX * 0.55) * contour.whiskerLength
    const rLen = Math.max(8, 12 + vc.faceTurnX * 0.55) * contour.whiskerLength
    for (let i = 0; i < 3; i++) {
      const wy = 16 + i * 5, slant = (2 + i * 1.1) * Math.min(1.25, contour.whiskerLength)
      ctx.beginPath(); ctx.moveTo(-wx0 + wShift, wy); ctx.lineTo(-wx0 + wShift - lLen, wy + slant)
      ctx.moveTo(wx0 + wShift, wy); ctx.lineTo(wx0 + wShift + rLen, wy + slant); ctx.stroke()
    }
  }
  drawKuroCatEyes(ctx, vc, wShift, -1 + contour.eyeOffsetY * 11)
  drawHeadphonesFront(ctx, vc)
  ctx.restore(); ctx.restore()
}
