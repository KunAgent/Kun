import type { KuroCatCollarColor, ResolvedKuroCatSkin } from '@shared/pets-kurocat'
import type { Vec2 } from './kurocat-keyboard-desk'

export interface KuroCatSmearFrame {
  sx: number
  sy: number
  px: number
  py: number
  alpha: number
}

export type KuroCatPawMode = 'idle' | 'curled' | 'poke' | 'mouse' | 'groom' | 'stretch' | 'knead' | 'scruff'

export interface KuroCatPawState {
  side: 'left' | 'right'
  shoulderNormY: number
  shoulderHalfX: number
  pos: Vec2
  target: Vec2
  mode: KuroCatPawMode
  idleWeight: number
  curlWeight: number
  pokeTime: number
  impactSquash: number
  lastActiveAt: number
  smears: KuroCatSmearFrame[]
}

export interface KuroCatFxParticle {
  kind: 'bang' | 'dust' | 'z' | 'heart' | 'sparkle' | 'sneeze'
  x: number
  y: number
  vx: number
  vy: number
  size: number
  createdAt: number
  lifetime: number
}

export interface KuroCatVisualContext {
  catBreed: 'black' | 'ragdoll'
  customSkin: ResolvedKuroCatSkin | null
  elapsed: number
  now: number
  isBlinking: boolean
  blinkProgress: number
  slowBlinkVal: number
  squintAmount: number
  sleepAmount: number
  dozeLidClose: number
  yawnAmount: number
  stretchAmount: number
  groomAmount: number
  groomLickAmount: number
  chinAmount: number
  kneadAmount: number
  curiousAmount: number
  scruffAmount: number
  scruffSwing: number
  crossAmount: number
  typingHunch: number
  typingEnergy: number
  boopCrossEye: number
  eyeLookX: number
  eyeLookY: number
  faceTurnX: number
  headTilt: number
  earPerk: number
  earTwitchLeft: number
  earTwitchRight: number
  earFlickLeft: number
  earFlickRight: number
  groomEarPressLeft: number
  groomEarPressRight: number
  headsetAmount: number
  collarColor: KuroCatCollarColor
  mouseLeftPress: number
  mouseRightPress: number
  mouseMiddlePress: number
  leftPawMode: KuroCatPawMode
  lastSlamAt: number
  spinePoint: (t: number, breath: number) => Vec2
  liveShoulder: (paw: KuroCatPawState, breath: number) => Vec2
  liveCurledPawPos: (paw: KuroCatPawState, breath: number) => Vec2
}

export function drawKuroCatYawnOrLickMouth(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, cx: number, rimColor: string): void {
  if (vc.yawnAmount > 0.04) {
    const y = Math.min(1, vc.yawnAmount)
    const topY = 17.2
    const w = 4.2 + y * 5.2
    const h = 2.0 + y * 11.4
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(cx, topY + 1.4)
    ctx.quadraticCurveTo(cx + w * 0.52, topY - 1.1, cx + w, topY + 2.0)
    ctx.bezierCurveTo(cx + w * 1.12, topY + h * 0.58, cx + w * 0.72, topY + h, cx, topY + h)
    ctx.bezierCurveTo(cx - w * 0.72, topY + h, cx - w * 1.12, topY + h * 0.58, cx - w, topY + 2.0)
    ctx.quadraticCurveTo(cx - w * 0.52, topY - 1.1, cx, topY + 1.4)
    ctx.closePath()
    ctx.fillStyle = '#6d2c3e'
    ctx.fill()

    ctx.save()
    ctx.clip()
    ctx.fillStyle = '#ff9bb3'
    ctx.beginPath()
    ctx.ellipse(cx, topY + h * 0.88, w * 0.78, h * 0.44, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = rimColor
    ctx.lineWidth = 1.3
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.restore()
    return
  }
  if (vc.groomLickAmount > 0.08) {
    const l = Math.min(1, vc.groomLickAmount)
    ctx.save()
    ctx.fillStyle = '#ff9bb3'
    ctx.strokeStyle = '#6c2a3a'
    ctx.lineWidth = 1.05
    ctx.beginPath()
    ctx.ellipse(cx, 19.4 + l * 2.6, 3.6 * l + 1.1, 4.2 * l + 1.0, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

export function drawKuroCatEyes(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, cx: number, eyeY: number): void {
  if (vc.customSkin) {
    drawKuroCatCustomEyes(ctx, vc, vc.customSkin, cx, eyeY)
    return
  }
  const isRagdoll = vc.catBreed === 'ragdoll'
  const blinkVal = Math.max(vc.isBlinking ? 1 - Math.abs(vc.blinkProgress - 1) : 0, vc.slowBlinkVal)
  const yawnClose = Math.min(1, vc.yawnAmount * 1.45)
  const stretchClose = Math.min(1, vc.stretchAmount * 1.25)
  const groomClose = Math.min(0.85, vc.groomAmount * 0.95)
  const closedness = Math.max(blinkVal, vc.squintAmount * 0.85, vc.sleepAmount, vc.dozeLidClose, yawnClose, stretchClose, groomClose)
  const curious = Math.min(1, vc.curiousAmount)
  const scruff = Math.min(1, vc.scruffAmount)
  const cross = vc.crossAmount
  const eyeXs = [cx - 23.0, cx + 23.0]
  const rx = (14.8 + vc.typingHunch * 1.0) * (1 + curious * 0.06 + scruff * 0.09)
  const ry = (13.4 - vc.typingHunch * 0.5) * (1 + curious * 0.09 + scruff * 0.13)

  for (let idx = 0; idx < 2; idx++) {
    ctx.save()
    ctx.translate(eyeXs[idx], eyeY)

    if (vc.sleepAmount > 0.52) {
      ctx.strokeStyle = isRagdoll ? '#212533' : '#d4f044'
      ctx.lineWidth = 2.9
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-13.5, -0.5)
      ctx.quadraticCurveTo(0, 5.2, 13.5, -0.5)
      ctx.stroke()
      ctx.restore()
      continue
    }
    if (yawnClose > 0.48 || stretchClose > 0.52 || (vc.chinAmount > 0.36 && blinkVal < 0.3)) {
      ctx.strokeStyle = isRagdoll ? '#212533' : '#d4f044'
      ctx.lineWidth = 2.9
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-12.5, 2.2)
      ctx.quadraticCurveTo(0, -4.8, 12.5, 2.2)
      ctx.stroke()
      ctx.restore()
      continue
    }
    if ((vc.squintAmount > 0.38 || groomClose > 0.48) && blinkVal < 0.3) {
      if (isRagdoll) {
        ctx.strokeStyle = 'rgba(174, 224, 255, 0.72)'
        ctx.lineWidth = 4.4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-12.5, 0.2)
        ctx.quadraticCurveTo(0, 2.2, 12.5, 1.8)
        ctx.stroke()
      }
      ctx.strokeStyle = isRagdoll ? '#212533' : '#d4f044'
      ctx.lineWidth = 2.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-13.5, -0.5)
      ctx.quadraticCurveTo(0, 1.4, 13.5, 1.2)
      ctx.stroke()
      ctx.restore()
      continue
    }

    const openRy = Math.max(1.2, ry * (1 - closedness))
    const curiousTilt = (idx === 0 ? -0.1 : 0.1) * (0.25 + vc.typingHunch * 0.75) * (1 - scruff * 0.8)
    ctx.rotate(curiousTilt)

    const hasGrumpyLid = cross > 0.04
    const innerDrop = -openRy + openRy * 0.90 * cross
    const outerDrop = -openRy + openRy * 0.56 * cross
    const leftDrop = idx === 0 ? outerDrop : innerDrop
    const rightDrop = idx === 0 ? innerDrop : outerDrop

    ctx.save()
    if (hasGrumpyLid) {
      ctx.beginPath()
      ctx.moveTo(-rx - 4, leftDrop)
      ctx.lineTo(rx + 4, rightDrop)
      ctx.lineTo(rx + 4, openRy + 4)
      ctx.lineTo(-rx - 4, openRy + 4)
      ctx.closePath()
      ctx.clip()
    }
    if (isRagdoll) {
      const irisGrad = ctx.createLinearGradient(0, -openRy, 0, openRy)
      irisGrad.addColorStop(0.0, '#2c5594')
      irisGrad.addColorStop(0.5, '#5a94d6')
      irisGrad.addColorStop(1.0, '#a3d2f2')
      ctx.fillStyle = irisGrad
    } else {
      ctx.fillStyle = '#d4f044'
    }
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.clip()
    if (openRy > 3.2) {
      const boopShrink = 1 - vc.boopCrossEye * 0.22
      const pupilRx = Math.min(rx - 2.4, (6.2 + curious * 4.2 + scruff * 3.4 + vc.typingEnergy * 0.8) * (1 - cross * 0.34) * boopShrink)
      const pupilRy = Math.min(openRy - 1.4, (8.8 + curious * 1.9 + scruff * 2.2) * (1 - cross * 0.08) * boopShrink)
      const maxTravelX = Math.max(2.6, rx - pupilRx - 1.0)
      const maxTravelY = Math.max(2.2, openRy - pupilRy - 0.6)
      const crossEyeDir = idx === 0 ? 1 : -1
      const gazeXEff = vc.eyeLookX * (1 - vc.boopCrossEye) + crossEyeDir * 0.94 * vc.boopCrossEye
      const gazeYEff = vc.eyeLookY * (1 - vc.boopCrossEye) + 0.42 * vc.boopCrossEye
      const px = Math.max(-maxTravelX, Math.min(maxTravelX, gazeXEff * maxTravelX))
      const py = Math.max(-maxTravelY, Math.min(maxTravelY, gazeYEff * maxTravelY))

      ctx.fillStyle = isRagdoll ? '#101624' : '#0e0e10'
      ctx.beginPath()
      ctx.ellipse(px, py, pupilRx, pupilRy, 0, 0, Math.PI * 2)
      ctx.fill()

      const sparkleBoost = Math.max(curious, scruff * 0.75, vc.boopCrossEye * 0.65)
      if (isRagdoll || sparkleBoost > 0.25) {
        const ca = isRagdoll ? 0.94 : Math.min(0.92, sparkleBoost * 0.95)
        ctx.fillStyle = `rgba(255, 255, 255, ${ca.toFixed(2)})`
        ctx.beginPath()
        ctx.arc(px - 3.6 - sparkleBoost * 0.8, py - 4.0 - sparkleBoost * 0.5, 2.5 + sparkleBoost * 0.7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255, 255, 255, ${(ca * 0.76).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(px + 3.2, py + 3.2, 1.2 + sparkleBoost * 0.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()

    if (isRagdoll && openRy > 2.2) {
      ctx.strokeStyle = 'rgba(34, 39, 54, 0.85)'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    ctx.restore()
  }
}

export function drawKuroCatCustomEyes(ctx: CanvasRenderingContext2D, vc: KuroCatVisualContext, s: ResolvedKuroCatSkin, cx: number, eyeY: number): void {
  const blinkVal = Math.max(vc.isBlinking ? 1 - Math.abs(vc.blinkProgress - 1) : 0, vc.slowBlinkVal)
  const yawnClose = Math.min(1, vc.yawnAmount * 1.45)
  const stretchClose = Math.min(1, vc.stretchAmount * 1.25)
  const groomClose = Math.min(0.85, vc.groomAmount * 0.95)
  const closedness = Math.max(blinkVal, vc.squintAmount * 0.85, vc.sleepAmount, vc.dozeLidClose, yawnClose, stretchClose, groomClose)
  const curious = Math.min(1, vc.curiousAmount)
  const scruff = Math.min(1, vc.scruffAmount)
  const cross = vc.crossAmount
  const contour = s.contour
  const eScale = contour.eyeScale
  const eAspect = contour.eyeAspect
  const eyeXs = [cx - 23.0 * contour.eyeSpacing, cx + 23.0 * contour.eyeSpacing]
  const rx = (14.8 * eScale + vc.typingHunch * 1.0) * (1 + curious * 0.06 + scruff * 0.09)
  const ry = (13.4 * eScale * eAspect - vc.typingHunch * 0.5) * (1 + curious * 0.09 + scruff * 0.13)

  for (let idx = 0; idx < 2; idx++) {
    const side: -1 | 1 = idx === 0 ? -1 : 1
    ctx.save()
    ctx.translate(eyeXs[idx], eyeY)

    if (vc.sleepAmount > 0.52) {
      ctx.strokeStyle = s.squintColor; ctx.lineWidth = 2.9; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-13.5 * eScale, -0.5); ctx.quadraticCurveTo(0, 5.2 * eScale, 13.5 * eScale, -0.5); ctx.stroke()
      ctx.restore(); continue
    }
    if (yawnClose > 0.48 || stretchClose > 0.52 || (vc.chinAmount > 0.36 && blinkVal < 0.3)) {
      ctx.strokeStyle = s.squintColor; ctx.lineWidth = 2.9; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-12.5 * eScale, 2.2); ctx.quadraticCurveTo(0, -4.8 * eScale, 12.5 * eScale, 2.2); ctx.stroke()
      ctx.restore(); continue
    }
    if ((vc.squintAmount > 0.38 || groomClose > 0.48) && blinkVal < 0.3) {
      if (s.squintGlowColor) {
        ctx.strokeStyle = s.squintGlowColor; ctx.lineWidth = 4.4; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(-12.5 * eScale, 0.2); ctx.quadraticCurveTo(0, 2.2 * eScale, 12.5 * eScale, 1.8); ctx.stroke()
      }
      ctx.strokeStyle = s.squintColor; ctx.lineWidth = 2.8; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-13.5 * eScale, -0.5); ctx.quadraticCurveTo(0, 1.4 * eScale, 13.5 * eScale, 1.2); ctx.stroke()
      ctx.restore(); continue
    }

    const openRy = Math.max(1.2, ry * (1 - closedness))
    const curiousTilt = (idx === 0 ? -0.1 : 0.1) * (0.25 + vc.typingHunch * 0.75) * (1 - scruff * 0.8)
    ctx.rotate(curiousTilt - side * contour.eyeTilt)

    const restSquint = contour.eyeSquint
    const hasLid = cross > 0.04 || restSquint > 0.02
    const restDrop = -openRy + openRy * 1.12 * restSquint
    const innerDrop = Math.max(restDrop, -openRy + openRy * 0.90 * cross)
    const outerDrop = Math.max(restDrop, -openRy + openRy * 0.56 * cross)
    const leftDrop = idx === 0 ? outerDrop : innerDrop
    const rightDrop = idx === 0 ? innerDrop : outerDrop

    ctx.save()
    if (hasLid) {
      ctx.beginPath()
      ctx.moveTo(-rx - 4, leftDrop); ctx.lineTo(rx + 4, rightDrop)
      ctx.lineTo(rx + 4, openRy + 4); ctx.lineTo(-rx - 4, openRy + 4)
      ctx.closePath(); ctx.clip()
    }

    const irisGrad = ctx.createLinearGradient(0, -openRy, 0, openRy)
    irisGrad.addColorStop(0.0, idx === 1 ? s.rightEyeColorTop : s.eyeColorTop)
    irisGrad.addColorStop(1.0, idx === 1 ? s.rightEyeColorBottom : s.eyeColorBottom)
    ctx.fillStyle = irisGrad
    ctx.beginPath(); ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2); ctx.fill()

    ctx.save()
    ctx.clip()
    if (openRy > 3.2) {
      const boopShrink = 1 - vc.boopCrossEye * 0.22
      const pMul = contour.pupilScale * eScale
      const pShape = contour.pupilShape
      let pupilRx: number, pupilRy: number
      if (pShape === 'round') {
        const rP = (7.4 + curious * 3.4 + scruff * 2.8 + vc.typingEnergy * 0.6) * pMul * (1 - cross * 0.24) * boopShrink
        pupilRx = Math.min(rx - 2.2, rP); pupilRy = Math.min(openRy - 1.4, rP)
      } else if (pShape === 'slit') {
        pupilRx = Math.min(rx - 2.4, (2.8 + curious * 4.6 + scruff * 3.8 + vc.typingEnergy * 0.4) * pMul * (1 - cross * 0.35) * boopShrink)
        pupilRy = Math.min(openRy - 1.0, (9.8 + curious * 1.4 + scruff * 1.6) * pMul * eAspect * boopShrink)
      } else if (pShape === 'dot') {
        const rDot = (4.0 + curious * 1.8 + scruff * 1.6) * pMul * boopShrink
        pupilRx = Math.min(rx - 2.4, rDot); pupilRy = Math.min(openRy - 1.4, rDot)
      } else {
        pupilRx = Math.min(rx - 2.4, (6.2 + curious * 4.2 + scruff * 3.4 + vc.typingEnergy * 0.8) * pMul * (1 - cross * 0.34) * boopShrink)
        pupilRy = Math.min(openRy - 1.4, (8.8 + curious * 1.9 + scruff * 2.2) * pMul * eAspect * (1 - cross * 0.08) * boopShrink)
      }
      const maxTravelX = Math.max(2.0, rx - pupilRx - 1.0)
      const maxTravelY = Math.max(1.8, openRy - pupilRy - 0.6)
      const crossEyeDir = idx === 0 ? 1 : -1
      const gazeXEff = vc.eyeLookX * (1 - vc.boopCrossEye) + crossEyeDir * 0.94 * vc.boopCrossEye
      const gazeYEff = vc.eyeLookY * (1 - vc.boopCrossEye) + 0.42 * vc.boopCrossEye
      const px = Math.max(-maxTravelX, Math.min(maxTravelX, gazeXEff * maxTravelX))
      const py = Math.max(-maxTravelY, Math.min(maxTravelY, gazeYEff * maxTravelY))

      ctx.fillStyle = s.pupilColor
      ctx.beginPath()
      if (pShape === 'slit') {
        ctx.moveTo(px, py - pupilRy)
        ctx.quadraticCurveTo(px + pupilRx * 1.35, py, px, py + pupilRy)
        ctx.quadraticCurveTo(px - pupilRx * 1.35, py, px, py - pupilRy)
        ctx.closePath()
      } else {
        ctx.ellipse(px, py, pupilRx, pupilRy, 0, 0, Math.PI * 2)
      }
      ctx.fill()

      if (pShape === 'star') {
        const sr = Math.max(2.6, Math.min(pupilRx, pupilRy) * 0.82)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.beginPath()
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 - Math.PI * 0.5
          const rad = k % 2 === 0 ? sr : sr * 0.32
          const sx = px + Math.cos(ang) * rad, sy = py + Math.sin(ang) * rad
          if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
        }
        ctx.closePath(); ctx.fill()
      }

      const sparkleBoost = Math.max(curious, scruff * 0.75, vc.boopCrossEye * 0.65)
      if (s.eyeCatchlight || sparkleBoost > 0.25) {
        const ca = s.eyeCatchlight ? 0.94 : Math.min(0.92, sparkleBoost * 0.95)
        ctx.fillStyle = `rgba(255, 255, 255, ${ca.toFixed(2)})`
        ctx.beginPath(); ctx.arc(px - (3.6 + sparkleBoost * 0.8) * eScale, py - (4.0 + sparkleBoost * 0.5) * eScale, (2.5 + sparkleBoost * 0.7) * Math.max(0.7, eScale), 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = `rgba(255, 255, 255, ${(ca * 0.76).toFixed(2)})`
        ctx.beginPath(); ctx.arc(px + 3.2 * eScale, py + 3.2 * eScale, (1.2 + sparkleBoost * 0.4) * Math.max(0.7, eScale), 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.restore()

    if (s.eyeRimColor && openRy > 2.2) {
      ctx.strokeStyle = s.eyeRimColor; ctx.lineWidth = 1.25
      ctx.beginPath(); ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()

    if (hasLid && openRy > 2.2) {
      ctx.save()
      ctx.beginPath(); ctx.ellipse(0, 0, rx + 0.9, openRy + 0.9, 0, 0, Math.PI * 2); ctx.clip()
      ctx.strokeStyle = s.eyeRimColor || s.outlineColor || '#262426'; ctx.lineWidth = 1.9; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-rx - 2, leftDrop); ctx.lineTo(rx + 2, rightDrop); ctx.stroke()
      ctx.restore()
    }
    ctx.restore()

    if (contour.eyebrowStyle !== 'none') {
      ctx.save()
      ctx.translate(eyeXs[idx], eyeY - ry - 5.5)
      ctx.fillStyle = s.eyebrowColor; ctx.strokeStyle = s.eyebrowColor; ctx.lineCap = 'round'
      if (contour.eyebrowStyle === 'thick') {
        ctx.beginPath(); ctx.ellipse(side * -1.5, 0, 5.4 * eScale, 3.3 * eScale, side * -0.18, 0, Math.PI * 2); ctx.fill()
      } else if (contour.eyebrowStyle === 'angry') {
        ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(side * -9.5 * eScale, 2.8); ctx.lineTo(side * 9.5 * eScale, -3.0); ctx.stroke()
      } else if (contour.eyebrowStyle === 'worried') {
        ctx.lineWidth = 2.3; ctx.beginPath(); ctx.moveTo(side * -9.0 * eScale, -2.6); ctx.quadraticCurveTo(0, -1.0, side * 9.5 * eScale, 2.8); ctx.stroke()
      } else {
        ctx.lineWidth = 2.0; ctx.beginPath(); ctx.moveTo(side * -9.5 * eScale, 1.2); ctx.quadraticCurveTo(0, -3.4, side * 9.5 * eScale, 1.4); ctx.stroke()
      }
      ctx.restore()
    }
  }
}
