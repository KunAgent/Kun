import type { PetKeyboardSurface, PetMousePadSurface } from './keyboard-surface'

export type DeskMouseTheme = {
  matBase: string
  matTop: string
  matStroke: string
  matStitch: string
  mouseShadow: string
  mouseSkirt: string
  mousePalmTop: string
  mousePalmBot: string
  mousePlate: string
  mouseStroke: string
  mouseSeam: string
  mouseLeftHit: string
  mouseRightHit: string
  mouseMiddleHit: string
  wheelHousing: string
  wheelIdle: string
}

export function clampUnit(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(full, 16)
  if (Number.isNaN(n)) return [240, 240, 236]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function blendDeskHex(a: string, b: string, t: number): string {
  const u = clampUnit(t, 0, 1)
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return `rgb(${Math.round(ar + (br - ar) * u)}, ${Math.round(ag + (bg - ag) * u)}, ${Math.round(ab + (bb - ab) * u)})`
}

/** Unified stitched studio desk mat spanning under both the left-side mouse and right-side keyboard. */
export function drawUnifiedDeskMat(
  ctx: CanvasRenderingContext2D,
  keyboard: PetKeyboardSurface,
  skirtDepth: number,
  unit: number,
  theme: DeskMouseTheme
): void {
  const pad = keyboard.mousePad
  if (!pad) return
  const matX = Math.min(pad.x - 1.5 * unit, keyboard.x - 3 * unit)
  const matRight = keyboard.x + keyboard.width + 3.5 * unit
  const matW = matRight - matX
  const matY = Math.min(pad.y, keyboard.y - 1.5 * unit)
  const matBottom = keyboard.y + keyboard.height + skirtDepth + 2.2 * unit
  const matH = matBottom - matY
  const matSkirt = Math.max(1.4, 1.8 * unit)
  const matRadius = 5.4 * unit

  ctx.save()
  ctx.fillStyle = 'rgba(12, 18, 28, 0.20)'
  ctx.beginPath()
  ctx.roundRect(matX - 0.6 * unit, matY + matSkirt + 1.4 * unit, matW + 1.2 * unit, matH, matRadius)
  ctx.fill()

  ctx.fillStyle = theme.matBase
  ctx.beginPath()
  ctx.roundRect(matX, matY + matSkirt, matW, matH, matRadius)
  ctx.fill()

  ctx.fillStyle = theme.matTop
  ctx.strokeStyle = theme.matStroke
  ctx.lineWidth = 0.85 * unit
  ctx.beginPath()
  ctx.roundRect(matX, matY, matW, matH, matRadius)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = theme.matStitch
  ctx.lineWidth = 0.6 * unit
  ctx.beginPath()
  ctx.roundRect(matX + 2 * unit, matY + 1.8 * unit, Math.max(4, matW - 4 * unit), Math.max(4, matH - 3.6 * unit), Math.max(2, matRadius - 1.5 * unit))
  ctx.stroke()
  ctx.restore()
}

/** Cordless ergonomic oval split-plate mini-mouse modeled 1:1 after KuroCat's desktop gear. */
export function drawCordlessMiniMouse(
  ctx: CanvasRenderingContext2D,
  pad: PetMousePadSurface,
  unit: number,
  theme: DeskMouseTheme
): void {
  const { width: w, mouseX, mouseY } = pad
  const lPress = clampUnit(pad.leftPress ?? (pad.leftButton ? 1 : 0), 0, 1)
  const rPress = clampUnit(pad.rightPress ?? (pad.rightButton ? 1 : 0), 0, 1)
  const mPress = clampUnit(Math.max(pad.middlePress ?? (pad.middleButton ? 1 : 0), pad.wheelGlow), 0, 1)
  const anyPress = Math.max(lPress, rPress, pad.middlePress ?? 0)

  const rx = clampUnit(w * 0.228, 7.2, 10.6)
  const ry = rx * 1.27
  const pressY = anyPress * 0.85 * unit

  ctx.save()
  ctx.translate(mouseX, mouseY + pressY)
  ctx.rotate(-0.06)
  ctx.scale(1 + 0.032 * anyPress, 1 - 0.052 * anyPress)

  // Grounded contact shadow + 3D lower mouse chassis skirt
  ctx.fillStyle = theme.mouseShadow
  ctx.beginPath()
  ctx.ellipse(0.35 * unit, 2.2 * unit, rx * 1.07, ry * 1.02, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = theme.mouseSkirt
  ctx.beginPath()
  ctx.ellipse(0, 1.35 * unit, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()

  // Sculpted upper palm dome (cat-facing: palm rest at -Y closest to pet; split L/R buttons at +Y)
  const palmGrad = ctx.createLinearGradient(0, -ry, 0, ry * 0.35)
  palmGrad.addColorStop(0, theme.mousePalmTop)
  palmGrad.addColorStop(1, theme.mousePalmBot)
  ctx.fillStyle = palmGrad
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()

  // Crown specular sheen on upper palm dome
  ctx.fillStyle = 'rgba(255, 255, 255, 0.56)'
  ctx.beginPath()
  ctx.ellipse(-rx * 0.16, -ry * 0.46, rx * 0.42, ry * 0.21, -0.18, 0, Math.PI * 2)
  ctx.fill()

  // Clipped split front plates: L = inner (+X), R = outer (-X)
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, Math.max(1, rx - 0.35 * unit), Math.max(1, ry - 0.35 * unit), 0, 0, Math.PI * 2)
  ctx.clip()

  const seamEdgeY = -ry * 0.04
  const seamMidY = ry * 0.08

  // 1) Left Mouse Button plate (+X inner half)
  ctx.beginPath()
  ctx.moveTo(0, seamMidY * 0.55)
  ctx.quadraticCurveTo(rx * 0.52, seamMidY * 0.45, rx + 2, seamEdgeY)
  ctx.lineTo(rx + 2, ry + 2)
  ctx.lineTo(0, ry + 2)
  ctx.closePath()
  ctx.fillStyle = lPress > 0.04 ? blendDeskHex(theme.mousePlate, theme.mouseLeftHit, clampUnit(0.34 + lPress * 0.66, 0, 1)) : theme.mousePlate
  ctx.fill()
  if (lPress > 0.06) {
    ctx.fillStyle = `rgba(18, 22, 28, ${(0.18 * lPress).toFixed(3)})`
    ctx.fillRect(0, seamEdgeY - 0.5, rx + 2, 2.0 * unit)
    ctx.fillRect(0, seamEdgeY, 1.2 * unit, ry + 2)
  }

  // 2) Right Mouse Button plate (-X outer half)
  ctx.beginPath()
  ctx.moveTo(-rx - 2, seamEdgeY)
  ctx.quadraticCurveTo(-rx * 0.52, seamMidY * 0.45, 0, seamMidY * 0.55)
  ctx.lineTo(0, ry + 2)
  ctx.lineTo(-rx - 2, ry + 2)
  ctx.closePath()
  ctx.fillStyle = rPress > 0.04 ? blendDeskHex(theme.mousePlate, theme.mouseRightHit, clampUnit(0.34 + rPress * 0.66, 0, 1)) : theme.mousePlate
  ctx.fill()
  if (rPress > 0.06) {
    ctx.fillStyle = `rgba(18, 22, 28, ${(0.18 * rPress).toFixed(3)})`
    ctx.fillRect(-rx - 2, seamEdgeY - 0.5, rx + 2, 2.0 * unit)
    ctx.fillRect(-1.2 * unit, seamEdgeY, 1.2 * unit, ry + 2)
  }

  // Curved palm-to-button waist seam & center split seam
  ctx.strokeStyle = theme.mouseSeam
  ctx.lineWidth = Math.max(0.75, 0.85 * unit)
  ctx.beginPath()
  ctx.moveTo(-rx - 1, seamEdgeY)
  ctx.quadraticCurveTo(0, seamMidY, rx + 1, seamEdgeY)
  ctx.moveTo(0, seamMidY * 0.55)
  ctx.lineTo(0, ry + 1)
  ctx.stroke()

  // Recessed scroll wheel housing + interactive wheel
  const houseW = Math.max(2.4, rx * 0.27)
  const houseH = Math.max(4.2, ry * 0.40)
  const houseY = ry * 0.16
  ctx.fillStyle = theme.wheelHousing
  ctx.beginPath()
  ctx.roundRect(-houseW * 0.5, houseY, houseW, houseH, houseW * 0.5)
  ctx.fill()

  const wheelW = houseW * 0.68
  const wheelH = houseH * 0.78
  const wheelShift = pad.wheelGlow > 0.02 ? pad.wheelDir * 0.7 * unit : 0
  const wheelY = houseY + (houseH - wheelH) * 0.5 + wheelShift
  ctx.fillStyle = mPress > 0.06 ? blendDeskHex(theme.wheelIdle, theme.mouseMiddleHit, clampUnit(0.35 + mPress * 0.65, 0, 1)) : theme.wheelIdle
  ctx.beginPath()
  ctx.roundRect(-wheelW * 0.5, wheelY, wheelW, wheelH, wheelW * 0.5)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)'
  ctx.lineWidth = Math.max(0.55, 0.6 * unit)
  ctx.beginPath()
  ctx.moveTo(-wheelW * 0.3, wheelY + wheelH * 0.5)
  ctx.lineTo(wheelW * 0.3, wheelY + wheelH * 0.5)
  ctx.stroke()

  // Upright crisp L / R front micro-legends
  if (rx >= 7.2) {
    const fontPx = Math.max(4.4, Math.min(6.0, rx * 0.46))
    ctx.font = `800 ${fontPx.toFixed(1)}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = lPress > 0.18 ? '#14161a' : 'rgba(68, 74, 86, 0.56)'
    ctx.fillText('L', rx * 0.43, ry * 0.61 + lPress * 0.42 * unit)
    ctx.fillStyle = rPress > 0.18 ? '#ffffff' : 'rgba(68, 74, 86, 0.56)'
    ctx.fillText('R', -rx * 0.43, ry * 0.61 + rPress * 0.42 * unit)
  }

  ctx.restore()

  // Crisp outer mouse silhouette stroke
  ctx.strokeStyle = theme.mouseStroke
  ctx.lineWidth = Math.max(0.95, 1.05 * unit)
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  ctx.restore()
}
