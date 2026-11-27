import type { KuroCatVisualContext } from './kurocat-eyes-renderer'
import type { Vec2 } from './kurocat-keyboard-desk'

export interface KuroCatTailState {
  tipX: number
  tipY: number
  reach: number
  hover: number
  impactSquash: number
  crossLeft: number
  driftPhase: number
  tailFlick: number
  tailRecoil: number
  thumpLift: number
  thumpLash: number
  kbCenterY: number
  kbHeight: number
  logicalW: number
  sampledPoints: Vec2[]
}

export function drawKuroCatTail(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, tail: KuroCatTailState): void {
  const curiousTwitch = vc.curiousAmount > 0.05 ? Math.sin(vc.elapsed * 14.5) * 4.2 * Math.min(1, vc.curiousAmount) : 0
  const swayAmp = (1.4 + vc.typingEnergy * 2.2) * (1 - vc.sleepAmount * 0.85)
  const gentleDrift = Math.sin(tail.driftPhase) * swayAmp
  const hipRight = vc.spinePoint(0.84, 0)

  const startX = hipRight.x + 56
  const startY = hipRight.y - 2 + vc.sleepAmount * 14
  let restCp1X = startX + 34
  let restCp1Y = startY + 4 + gentleDrift * 0.25
  let restCp2X = startX + 38
  let restCp2Y = startY - 34 + gentleDrift * 0.45
  let restEndX = startX + 70 + gentleDrift * 0.35 + tail.tailFlick * 0.4
  let restEndY = startY - 35 + gentleDrift + tail.tailFlick + curiousTwitch

  if (vc.sleepAmount > 0.01) {
    const sl = vc.sleepAmount
    restCp1X += (startX + 42 - restCp1X) * sl
    restCp1Y += (startY + 14 - restCp1Y) * sl
    restCp2X += (startX + 54 - restCp2X) * sl
    restCp2Y += (startY + 28 - restCp2Y) * sl
    restEndX += (startX + 26 - restEndX) * sl
    restEndY += (startY + 26 - restEndY) * sl
  }
  if (vc.stretchAmount > 0.01) {
    const st = vc.stretchAmount
    const quiver = Math.sin(vc.elapsed * 20) * 3.2 * st
    restCp1X += (startX + 24 - restCp1X) * st
    restCp1Y += (startY - 26 - restCp1Y) * st
    restCp2X += (startX + 44 - restCp2X) * st
    restCp2Y += (startY - 76 - restCp2Y) * st
    restEndX += (startX + 26 + quiver - restEndX) * st
    restEndY += (startY - 82 - restEndY) * st
  }
  if (vc.scruffAmount > 0.01) {
    const sc = Math.min(1, vc.scruffAmount)
    const sw = vc.scruffSwing * 36
    restCp1X += (startX + 22 + sw * 0.4 - restCp1X) * sc
    restCp1Y += (startY + 20 - restCp1Y) * sc
    restCp2X += (startX + 28 + sw * 0.8 - restCp2X) * sc
    restCp2Y += (startY + 42 - restCp2Y) * sc
    restEndX += (startX + 18 + sw - restEndX) * sc
    restEndY += (startY + 52 - restEndY) * sc
  }
  if (tail.tailRecoil > 0.01) {
    const tr = Math.min(1, tail.tailRecoil)
    restCp1X += (startX + 14 - restCp1X) * tr
    restCp1Y += (startY + 12 - restCp1Y) * tr
    restCp2X += (startX + 18 - restCp2X) * tr
    restCp2Y += (startY + 22 - restCp2Y) * tr
    restEndX += (startX - 4 - restEndX) * tr
    restEndY += (startY + 18 - restEndY) * tr
  }

  const r = Math.max(0, Math.min(1, tail.reach))
  const smoothR = r * r * (3 - 2 * r)
  const thumpBlend = vc.crossAmount * (1 - smoothR)
  if (thumpBlend > 0.01) {
    const maxEdge = tail.logicalW - 18
    restCp1X += (Math.min(maxEdge, startX + 36) - restCp1X) * thumpBlend
    restCp1Y += (startY + 14 - tail.thumpLift * 16 - restCp1Y) * thumpBlend
    restCp2X += (Math.min(maxEdge, startX + 64 - tail.thumpLift * 10) - restCp2X) * thumpBlend
    restCp2Y += (startY + 24 - tail.thumpLift * 52 - restCp2Y) * thumpBlend
    restEndX += (Math.min(maxEdge, startX + 78 - tail.thumpLift * 16 + tail.thumpLash * 6) - restEndX) * thumpBlend
    restEndY += (startY + 30 - tail.thumpLift * 76 - restEndY) * thumpBlend
  }

  const patEndX = tail.tipX
  const patEndY = tail.tipY - tail.hover - 2
  const maxEdgeX = tail.logicalW - 14
  const crossLeft = tail.crossLeft
  const nearCp1X = Math.min(maxEdgeX, Math.max(startX + 44, patEndX + 32))
  const nearCp1Y = startY - 12 - tail.hover * 0.35
  const nearCp2X = Math.min(maxEdgeX, Math.max(startX + 54, patEndX + 40))
  const nearCp2Y = Math.min(startY + 24, (startY + patEndY) * 0.5 - 30 - tail.hover * 0.55)
  const farCp1X = Math.min(maxEdgeX, startX + 56)
  const farCp1Y = startY + 36 - tail.hover * 0.25
  const farCp2X = (startX + patEndX) * 0.5 + 24
  const farCp2Y = Math.max(tail.kbCenterY - tail.kbHeight * 0.34, patEndY - 22 - tail.hover * 0.45)

  const cp1X = restCp1X + (nearCp1X + (farCp1X - nearCp1X) * crossLeft - restCp1X) * smoothR
  const cp1Y = restCp1Y + (nearCp1Y + (farCp1Y - nearCp1Y) * crossLeft - restCp1Y) * smoothR
  const cp2X = restCp2X + (nearCp2X + (farCp2X - nearCp2X) * crossLeft - restCp2X) * smoothR
  const cp2Y = restCp2Y + (nearCp2Y + (farCp2Y - nearCp2Y) * crossLeft - restCp2Y) * smoothR
  const endX = restEndX + (patEndX - restEndX) * smoothR
  const endY = restEndY + (patEndY - restEndY) * smoothR
  const tipAngle = Math.atan2(endY - cp2Y, endX - cp2X)
  const tipSquash = tail.impactSquash * smoothR

  tail.sampledPoints.length = 0
  for (const u of [0.22, 0.36, 0.50, 0.64, 0.78, 0.90, 1.0]) {
    const m = 1 - u
    tail.sampledPoints.push({
      x: m * m * m * startX + 3 * m * m * u * cp1X + 3 * m * u * u * cp2X + u * u * u * endX,
      y: m * m * m * startY + 3 * m * m * u * cp1Y + 3 * m * u * u * cp2Y + u * u * u * endY
    })
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (smoothR > 0.35) {
    const shadowA = smoothR * Math.max(0, 1 - tail.hover / 28) * 0.34
    if (shadowA > 0.02) {
      ctx.fillStyle = `rgba(18, 22, 32, ${shadowA.toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(tail.tipX, tail.tipY + 3.5, 12.5 + tipSquash * 3.5, 6.2 + tipSquash * 1.4, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const s = vc.customSkin
  if (s) {
    const tailW = s.tailFluffy ? 20.0 : 16.0
    if (s.outlineColor) {
      ctx.strokeStyle = s.outlineColor
      ctx.lineWidth = tailW + 3.4
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY); ctx.stroke()
    }
    const tailGrad = ctx.createLinearGradient(startX, startY, endX, endY)
    tailGrad.addColorStop(0.0, s.tailColor)
    tailGrad.addColorStop(1.0, s.tailTipColor)
    ctx.strokeStyle = tailGrad
    ctx.lineWidth = tailW
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY); ctx.stroke()

    if (s.tailFluffy) {
      ctx.fillStyle = s.tailTipColor
      ctx.beginPath()
      ctx.ellipse(endX + Math.cos(tipAngle) * 1.2, endY + Math.sin(tipAngle) * 1.2, 11.8 * (1 + tipSquash * 0.14), 10.2 * (1 - tipSquash * 0.10), tipAngle, 0, Math.PI * 2)
      ctx.fill()
    } else if (tipSquash > 0.05) {
      ctx.fillStyle = s.tailTipColor
      ctx.beginPath()
      ctx.ellipse(endX, endY, tailW * 0.54 * (1 + tipSquash * 0.16), tailW * 0.50 * (1 - tipSquash * 0.12), tipAngle, 0, Math.PI * 2)
      ctx.fill()
    }
    if (s.tailStripes && (s.stripeColor || s.tailTipColor)) {
      ctx.strokeStyle = s.stripeColor || s.tailTipColor
      ctx.lineWidth = 3.2
      for (const t of [0.24, 0.44, 0.64, 0.82]) {
        const mt = 1 - t
        const bx = mt * mt * mt * startX + 3 * mt * mt * t * cp1X + 3 * mt * t * t * cp2X + t * t * t * endX
        const by = mt * mt * mt * startY + 3 * mt * mt * t * cp1Y + 3 * mt * t * t * cp2Y + t * t * t * endY
        const tx = 3 * mt * mt * (cp1X - startX) + 6 * mt * t * (cp2X - cp1X) + 3 * t * t * (endX - cp2X)
        const ty = 3 * mt * mt * (cp1Y - startY) + 6 * mt * t * (cp2Y - cp1Y) + 3 * t * t * (endY - cp2Y)
        const tLen = Math.max(1, Math.hypot(tx, ty))
        const nx = (-ty / tLen) * (tailW * 0.42), ny = (tx / tLen) * (tailW * 0.42)
        ctx.beginPath(); ctx.moveTo(bx - nx, by - ny); ctx.lineTo(bx + nx, by + ny); ctx.stroke()
      }
    }
    ctx.restore()
    return
  }

  if (vc.catBreed === 'ragdoll') {
    ctx.strokeStyle = '#4e4239'
    ctx.lineWidth = 23.5
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY); ctx.stroke()
    const tailGrad = ctx.createLinearGradient(startX, startY, endX, endY)
    tailGrad.addColorStop(0.0, '#8d7e6f'); tailGrad.addColorStop(0.5, '#726356'); tailGrad.addColorStop(1.0, '#584b40')
    ctx.strokeStyle = tailGrad; ctx.lineWidth = 20.2
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY); ctx.stroke()
    ctx.fillStyle = '#584b40'
    ctx.beginPath()
    ctx.ellipse(endX + Math.cos(tipAngle) * 1.2, endY + Math.sin(tipAngle) * 1.2, 12.2 * (1 + tipSquash * 0.14), 10.6 * (1 - tipSquash * 0.10), tipAngle, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.strokeStyle = '#141314'; ctx.lineWidth = 16.0
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY); ctx.stroke()
    if (tipSquash > 0.05) {
      ctx.fillStyle = '#141314'
      ctx.beginPath()
      ctx.ellipse(endX, endY, 8.8 * (1 + tipSquash * 0.16), 8.0 * (1 - tipSquash * 0.12), tipAngle, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawHeadphonesBack(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext): void {
  const hs = Math.max(0, Math.min(1.18, vc.headsetAmount))
  if (hs <= 0.015) return
  const settled = Math.min(1, hs)
  const dropY = -(1 - settled) * 38
  const sc = 0.86 + 0.14 * settled + Math.max(0, hs - 1) * 0.12
  ctx.save()
  ctx.globalAlpha = Math.min(1, settled * 1.45)
  ctx.translate(0, dropY); ctx.scale(sc, sc); ctx.lineCap = 'round'
  const arch = (): void => {
    ctx.beginPath(); ctx.moveTo(-64, 4); ctx.bezierCurveTo(-66, -34, -34, -56, 0, -56); ctx.bezierCurveTo(34, -56, 66, -34, 64, 4)
  }
  arch(); ctx.strokeStyle = '#6f7e99'; ctx.lineWidth = 12.2; ctx.stroke()
  arch(); ctx.strokeStyle = '#242a36'; ctx.lineWidth = 10.0; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(-28, -48.5); ctx.quadraticCurveTo(0, -52.5, 28, -48.5)
  ctx.strokeStyle = '#3b4454'; ctx.lineWidth = 5.4; ctx.stroke()
  ctx.restore()
}

export function drawHeadphonesFront(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext): void {
  const hs = Math.max(0, Math.min(1.18, vc.headsetAmount))
  if (hs <= 0.015) return
  const settled = Math.min(1, hs)
  const dropY = -(1 - settled) * 38
  const sc = 0.86 + 0.14 * settled + Math.max(0, hs - 1) * 0.12
  const rgbMix = 0.5 + 0.5 * Math.sin(vc.elapsed * 2.3 + vc.typingEnergy * 2.0)
  const pulse = 0.88 + 0.12 * Math.sin(vc.elapsed * 5.2) + vc.typingEnergy * 0.14
  const t = rgbMix * 0.58
  const r = Math.min(255, Math.round((212 * (1 - t) + 61 * t) * pulse))
  const g = Math.min(255, Math.round((245 * (1 - t) + 242 * t) * pulse))
  const b = Math.min(255, Math.round((61 * (1 - t) + 232 * t) * pulse))
  const ring = `rgb(${r}, ${g}, ${b})`
  const turnShift = vc.faceTurnX * 0.25

  ctx.save()
  ctx.globalAlpha = Math.min(1, settled * 1.45)
  ctx.translate(0, dropY); ctx.scale(sc, sc)
  for (const s of [-1, 1] as const) {
    ctx.save()
    ctx.translate(s * 60 + turnShift * 0.5, 5); ctx.rotate(s * 0.09)
    ctx.fillStyle = '#384050'; ctx.strokeStyle = '#1b1f29'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.ellipse(-s * 3.5, 0, 10.5, 19.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#242934'; ctx.strokeStyle = '#8fa0bd'; ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.ellipse(s * 4.2, 0, 10.2, 18.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.strokeStyle = ring; ctx.lineWidth = 2.4
    ctx.beginPath(); ctx.ellipse(s * 6.0, 0, 5.4, 11.4, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }
  const mx0 = -60 + turnShift * 0.5, mxTip = -22 + vc.faceTurnX * 0.55
  ctx.lineCap = 'round'; ctx.strokeStyle = '#5c6980'; ctx.lineWidth = 4.4
  ctx.beginPath(); ctx.moveTo(mx0, 14); ctx.quadraticCurveTo(mx0 + 6, 29, mxTip, 23); ctx.stroke()
  ctx.fillStyle = '#333b4a'; ctx.beginPath(); ctx.ellipse(mxTip + 2.5, 22.4, 5.4, 3.6, -0.22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#52f7d4'; ctx.beginPath(); ctx.arc(mxTip + 6.2, 21.5, 1.7, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

export function drawCollarWithBell(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, breath: number, purrShift: number): void {
  if (vc.collarColor === 'none') return
  const palette: Record<Exclude<typeof vc.collarColor, 'none'>, [string, string]> = {
    red: ['#e23b4a', '#961e2b'],
    blue: ['#3b82f6', '#1d4ed8'],
    pink: ['#f472b6', '#be185d'],
    green: ['#34d399', '#047857'],
    gold: ['#f59e0b', '#92400e'],
    purple: ['#a855f7', '#6b21a8'],
    black: ['#334155', '#0f172a']
  }
  const [band, rim] = palette[vc.collarColor] ?? palette.red
  const neck = vc.spinePoint(0.41, breath)
  const hw = 49 * (vc.customSkin?.contour.bodyChubbiness ?? 1)

  ctx.save()
  ctx.strokeStyle = rim; ctx.lineWidth = 7.6; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(neck.x + purrShift - hw, neck.y - 2); ctx.quadraticCurveTo(neck.x + purrShift, neck.y + 11, neck.x + purrShift + hw, neck.y - 2); ctx.stroke()
  ctx.strokeStyle = band; ctx.lineWidth = 5.4
  ctx.beginPath(); ctx.moveTo(neck.x + purrShift - hw, neck.y - 2); ctx.quadraticCurveTo(neck.x + purrShift, neck.y + 11, neck.x + purrShift + hw, neck.y - 2); ctx.stroke()

  const bx = neck.x + purrShift + vc.faceTurnX * 0.25, by = neck.y + 9.5
  ctx.fillStyle = '#f6c844'; ctx.strokeStyle = '#785312'; ctx.lineWidth = 1.3
  ctx.beginPath(); ctx.arc(bx, by, 5.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#5c3d0c'; ctx.beginPath(); ctx.arc(bx, by + 1.4, 1.3, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}
