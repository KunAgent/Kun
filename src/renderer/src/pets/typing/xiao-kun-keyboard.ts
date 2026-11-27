import {
  blendDeskHex,
  clampUnit as clamp,
  drawCordlessMiniMouse,
  drawUnifiedDeskMat,
  type DeskMouseTheme
} from './desk-mouse-surface'
import type { KeyboardKey, PetKeyboardSurface } from './keyboard-surface'

export type MechanicalDeskTheme = DeskMouseTheme & {
  id: string
  shadowColor: string
  caseSkirt: string
  caseTop: string
  caseStroke: string
  caseHighlight: string
  plate: string
  alphaTop: string
  alphaSkirt: string
  modTop: string
  modSkirt: string
  escTop: string
  escSkirt: string
  enterTop: string
  enterSkirt: string
  hitTop: string
  hitSkirt: string
  glyphColor: string
  escGlyph: string
  crestGold?: string
}

type KeyRole = 'alpha' | 'mod' | 'esc' | 'enter' | 'space'
type KeyGlyph = 'none' | 'left' | 'down' | 'right' | 'up' | 'shift' | 'enter' | 'bs' | 'tab' | 'esc' | 'homing'
type KeySpec65 = { id: string; row: number; uStart: number; uWidth: number; role: KeyRole; glyph: KeyGlyph; legend?: string }

const TOTAL_UNITS = 15
const TOTAL_ROWS = 5

const ROW1_LEGENDS = ['/', '.', ',', 'M', 'N', 'B', 'V', 'C', 'X', 'Z']
const ROW2_LEGENDS = ["'", ';', 'L', 'K', 'J', 'H', 'G', 'F', 'D', 'S', 'A']
const ROW3_LEGENDS = [']', '[', 'P', 'O', 'I', 'U', 'Y', 'T', 'R', 'E', 'W', 'Q']
const ROW4_LEGENDS = ['=', '-', '0', '9', '8', '7', '6', '5', '4', '3', '2', '1']

/**
 * Complete 63-key staggered 65% mechanical layout in cat-facing mirror perspective (15.0U per row, zero gaps):
 * - Row 0 (far/top edge closest to pet): Arrows + Fn/Alt + 6.25U Spacebar + Alt/Win/Ctrl
 * - Row 2 (home row): Accent Enter + 11 alphas (with F/J homing bars) + Caps
 * - Row 4 (near/bottom edge facing viewer): 2U Backspace + 12 number keys + Iconic Orange Esc
 */
const KEYS_65: readonly KeySpec65[] = (() => {
  const keys: KeySpec65[] = [
    { id: 'left', row: 0, uStart: 0, uWidth: 1, role: 'mod', glyph: 'left' },
    { id: 'down', row: 0, uStart: 1, uWidth: 1, role: 'mod', glyph: 'down' },
    { id: 'right', row: 0, uStart: 2, uWidth: 1, role: 'mod', glyph: 'right' },
    { id: 'fn', row: 0, uStart: 3, uWidth: 1, role: 'mod', glyph: 'none', legend: 'Fn' },
    { id: 'ralt', row: 0, uStart: 4, uWidth: 1, role: 'mod', glyph: 'none', legend: 'Alt' },
    { id: 'space', row: 0, uStart: 5, uWidth: 6.25, role: 'space', glyph: 'none' },
    { id: 'lalt', row: 0, uStart: 11.25, uWidth: 1.25, role: 'mod', glyph: 'none', legend: 'Alt' },
    { id: 'lwin', row: 0, uStart: 12.5, uWidth: 1.25, role: 'mod', glyph: 'none', legend: 'Win' },
    { id: 'lctrl', row: 0, uStart: 13.75, uWidth: 1.25, role: 'mod', glyph: 'none', legend: 'Ctrl' },
    { id: 'up', row: 1, uStart: 0, uWidth: 1, role: 'mod', glyph: 'up' },
    { id: 'rshift', row: 1, uStart: 1, uWidth: 1.75, role: 'mod', glyph: 'shift' }
  ]
  for (let i = 0; i < 10; i++) {
    keys.push({ id: `r1_${i}`, row: 1, uStart: 2.75 + i, uWidth: 1, role: 'alpha', glyph: 'none', legend: ROW1_LEGENDS[i] })
  }
  keys.push({ id: 'lshift', row: 1, uStart: 12.75, uWidth: 2.25, role: 'mod', glyph: 'shift' })
  keys.push({ id: 'enter', row: 2, uStart: 0, uWidth: 2.25, role: 'enter', glyph: 'enter' })
  for (let i = 0; i < 11; i++) {
    const homing = i === 4 || i === 7
    keys.push({ id: `r2_${i}`, row: 2, uStart: 2.25 + i, uWidth: 1, role: 'alpha', glyph: homing ? 'homing' : 'none', legend: ROW2_LEGENDS[i] })
  }
  keys.push({ id: 'caps', row: 2, uStart: 13.25, uWidth: 1.75, role: 'mod', glyph: 'none', legend: 'Caps' })
  keys.push({ id: 'bslash', row: 3, uStart: 0, uWidth: 1.5, role: 'mod', glyph: 'none', legend: '\\' })
  for (let i = 0; i < 12; i++) {
    keys.push({ id: `r3_${i}`, row: 3, uStart: 1.5 + i, uWidth: 1, role: 'alpha', glyph: 'none', legend: ROW3_LEGENDS[i] })
  }
  keys.push({ id: 'tab', row: 3, uStart: 13.5, uWidth: 1.5, role: 'mod', glyph: 'tab' })
  keys.push({ id: 'bs', row: 4, uStart: 0, uWidth: 2, role: 'mod', glyph: 'bs' })
  for (let i = 0; i < 12; i++) {
    keys.push({ id: `r4_${i}`, row: 4, uStart: 2 + i, uWidth: 1, role: 'alpha', glyph: 'none', legend: ROW4_LEGENDS[i] })
  }
  keys.push({ id: 'esc', row: 4, uStart: 14, uWidth: 1, role: 'esc', glyph: 'none', legend: 'Esc' })
  return keys
})()

const staticBoardCache = new Map<string, HTMLCanvasElement>()

function traceTrapezoid(
  ctx: CanvasRenderingContext2D,
  topHalfW: number,
  botHalfW: number,
  topY: number,
  botY: number,
  r: number
): void {
  const rad = Math.min(r, topHalfW * 0.4, (botY - topY) * 0.42)
  ctx.beginPath()
  ctx.moveTo(-topHalfW + rad, topY)
  ctx.lineTo(topHalfW - rad, topY)
  ctx.quadraticCurveTo(topHalfW, topY, topHalfW + 0.4, topY + rad)
  ctx.lineTo(botHalfW, botY - rad)
  ctx.quadraticCurveTo(botHalfW, botY, botHalfW - rad, botY)
  ctx.lineTo(-botHalfW + rad, botY)
  ctx.quadraticCurveTo(-botHalfW, botY, -botHalfW, botY - rad)
  ctx.lineTo(-topHalfW - 0.4, topY + rad)
  ctx.quadraticCurveTo(-topHalfW, topY, -topHalfW + rad, topY)
  ctx.closePath()
}

function resolveHitSpec(key: KeyboardKey, boardX: number, boardW: number): KeySpec65 {
  const uTarget = key.col !== undefined
    ? 0.9 + (clamp(key.col, 0, 5) / 5) * 13.2
    : clamp(((key.x - boardX) / Math.max(1, boardW)) * TOTAL_UNITS, 0.5, TOTAL_UNITS - 0.5)
  const rawRow = key.row ?? 1
  const targetRow = rawRow < 0.55
    ? ((uTarget < 4.6 || uTarget > 11.4) ? 0 : 1)
    : rawRow <= 1.45
      ? 2
      : (((key.sequence ?? 0) & 1) === 1 ? 4 : 3)
  let best = KEYS_65[24]
  let bestDist = Infinity
  for (const spec of KEYS_65) {
    if (spec.row !== targetRow || spec.role === 'space') continue
    const center = spec.uStart + spec.uWidth * 0.5
    const inside = uTarget >= spec.uStart && uTarget <= spec.uStart + spec.uWidth
    const dist = inside ? 0 : Math.abs(uTarget - center)
    if (dist < bestDist) {
      bestDist = dist
      best = spec
    }
  }
  return best
}

function drawKeyGlyph(
  ctx: CanvasRenderingContext2D,
  spec: KeySpec65,
  cx: number,
  cy: number,
  kw: number,
  kh: number,
  unit: number,
  color: string
): void {
  const { glyph, legend } = spec
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (legend && kw >= 4.2) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(Math.PI)
    ctx.globalAlpha *= spec.role === 'esc' ? 0.95 : 0.72
    const fontPx = legend.length >= 3 ? Math.max(2.6, 2.75 * unit) : legend.length === 2 ? Math.max(2.9, 3.05 * unit) : Math.max(3.2, 3.45 * unit)
    ctx.font = `700 ${fontPx.toFixed(2)}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(legend, 0, 0)
    ctx.restore()
  }

  if (glyph === 'none') {
    ctx.restore()
    return
  }

  ctx.lineWidth = Math.max(0.65, 0.72 * unit)
  const s = Math.min(kw, kh) * 0.24
  ctx.beginPath()
  if (glyph === 'homing') {
    const hw = Math.max(1.0, kw * 0.20)
    ctx.moveTo(cx - hw, cy - kh * 0.30)
    ctx.lineTo(cx + hw, cy - kh * 0.30)
  } else if (glyph === 'esc') {
    const hw = Math.max(1.2, kw * 0.24)
    ctx.lineWidth = Math.max(0.85, 0.92 * unit)
    ctx.moveTo(cx - hw, cy)
    ctx.lineTo(cx + hw, cy)
  } else if (glyph === 'enter') {
    ctx.moveTo(cx - kw * 0.18, cy + s * 0.65)
    ctx.lineTo(cx - kw * 0.18, cy - s * 0.45)
    ctx.lineTo(cx + kw * 0.18, cy - s * 0.45)
    ctx.moveTo(cx + kw * 0.08, cy + s * 0.15)
    ctx.lineTo(cx + kw * 0.2, cy - s * 0.45)
    ctx.lineTo(cx + kw * 0.08, cy - s * 1.0)
  } else if (glyph === 'bs') {
    ctx.moveTo(cx - kw * 0.18, cy)
    ctx.lineTo(cx + kw * 0.16, cy)
    ctx.moveTo(cx + kw * 0.04, cy - s * 0.72)
    ctx.lineTo(cx + kw * 0.18, cy)
    ctx.lineTo(cx + kw * 0.04, cy + s * 0.72)
  } else if (glyph === 'shift') {
    ctx.moveTo(cx - s * 0.85, cy - s * 0.32)
    ctx.lineTo(cx, cy + s * 0.62)
    ctx.lineTo(cx + s * 0.85, cy - s * 0.32)
  } else if (glyph === 'tab') {
    ctx.moveTo(cx - kw * 0.18, cy)
    ctx.lineTo(cx + kw * 0.18, cy)
  } else if (glyph === 'left' || glyph === 'right') {
    const dir = glyph === 'left' ? -1 : 1
    ctx.moveTo(cx - dir * s * 0.65, cy)
    ctx.lineTo(cx + dir * s * 0.65, cy)
    ctx.moveTo(cx + dir * s * 0.1, cy - s * 0.65)
    ctx.lineTo(cx + dir * s * 0.65, cy)
    ctx.lineTo(cx + dir * s * 0.1, cy + s * 0.65)
  } else if (glyph === 'up' || glyph === 'down') {
    const dir = glyph === 'up' ? -1 : 1
    ctx.moveTo(cx, cy - dir * s * 0.65)
    ctx.lineTo(cx, cy + dir * s * 0.65)
    ctx.moveTo(cx - s * 0.65, cy + dir * s * 0.1)
    ctx.lineTo(cx, cy + dir * s * 0.65)
    ctx.lineTo(cx + s * 0.65, cy + dir * s * 0.1)
  }
  ctx.stroke()
  ctx.restore()
}

function drawKeycap65(
  ctx: CanvasRenderingContext2D,
  spec: KeySpec65,
  w: number,
  h: number,
  unit: number,
  theme: MechanicalDeskTheme,
  down: number,
  glow: number
): { cx: number; cy: number; kw: number; kh: number } {
  const padX = 4.0 * unit
  const padY = 3.0 * unit
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const rowH = innerH / TOTAL_ROWS
  const unitW = innerW / TOTAL_UNITS
  const gap = Math.max(0.75, 0.88 * unit)
  const rowFrac = (spec.row + 0.5) / TOTAL_ROWS
  const depthScale = 0.955 + rowFrac * 0.068

  const rawX = -innerW * 0.5 + spec.uStart * unitW + gap * 0.5
  const rawW = spec.uWidth * unitW - gap
  const kx = rawX * depthScale
  const kw = Math.max(2, rawW * depthScale)
  const baseY = -innerH * 0.5 + spec.row * rowH + gap * 0.5
  const kh = Math.max(2.2, rowH - gap - 0.55 * unit)
  const travel = clamp(down, 0, 1) * 1.45 * unit
  const ky = baseY + travel
  const skirtOffset = Math.max(0.35 * unit, (1.15 - clamp(down, 0, 1) * 0.72) * unit)
  const radius = Math.min(1.35 * unit, kw * 0.24, kh * 0.30)

  if (down > 0.01 || glow > 0.02) {
    ctx.fillStyle = theme.plate
    ctx.fillRect(kx - 0.35 * unit, baseY - 0.35 * unit, kw + 0.7 * unit, kh + 2.1 * unit)
  }

  let baseTop = theme.alphaTop
  let baseSkirt = theme.alphaSkirt
  if (spec.role === 'mod') { baseTop = theme.modTop; baseSkirt = theme.modSkirt }
  else if (spec.role === 'esc') { baseTop = theme.escTop; baseSkirt = theme.escSkirt }
  else if (spec.role === 'enter') { baseTop = theme.enterTop; baseSkirt = theme.enterSkirt }

  const hitMix = glow > 0.02 ? clamp(0.32 + glow * 0.68, 0, 1) : 0
  const topColor = hitMix > 0 ? blendDeskHex(baseTop, theme.hitTop, hitMix) : baseTop
  const skirtColor = hitMix > 0 ? blendDeskHex(baseSkirt, theme.hitSkirt, hitMix) : baseSkirt

  ctx.fillStyle = skirtColor
  ctx.beginPath()
  ctx.roundRect(kx, ky + skirtOffset, kw, kh, radius)
  ctx.fill()

  ctx.fillStyle = topColor
  ctx.beginPath()
  ctx.roundRect(kx, ky, kw, kh - 0.35 * unit, radius)
  ctx.fill()

  if (hitMix < 0.4) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)'
    ctx.beginPath()
    ctx.roundRect(kx + 0.35 * unit, ky + 0.18 * unit, Math.max(0.8, kw - 0.7 * unit), Math.max(0.55, kh * 0.25), radius * 0.7)
    ctx.fill()
  }

  const glyphCol = spec.role === 'esc' && hitMix < 0.35 ? theme.escGlyph : theme.glyphColor
  drawKeyGlyph(ctx, spec, kx + kw * 0.5, ky + (kh - 0.35 * unit) * 0.5, kw, kh, unit, glyphCol)
  return { cx: kx + kw * 0.5, cy: ky + kh * 0.5, kw, kh }
}

function paintStaticBoard(
  cg: CanvasRenderingContext2D,
  w: number,
  h: number,
  skirtDepth: number,
  unit: number,
  theme: MechanicalDeskTheme,
  withShadow: boolean
): void {
  const topHalfW = (w * 0.962) * 0.5
  const botHalfW = (w * 1.024) * 0.5
  const halfH = h * 0.5

  cg.save()
  if (withShadow) {
    cg.shadowColor = theme.shadowColor
    cg.shadowBlur = 6.5 * unit
    cg.shadowOffsetY = 2.8 * unit
  }
  cg.fillStyle = theme.caseSkirt
  traceTrapezoid(cg, topHalfW, botHalfW, -halfH + 1.8 * unit, halfH + skirtDepth, 4.6 * unit)
  cg.fill()
  cg.restore()

  cg.fillStyle = theme.caseTop
  cg.strokeStyle = theme.caseStroke
  cg.lineWidth = 0.95 * unit
  traceTrapezoid(cg, topHalfW, botHalfW, -halfH, halfH, 4.4 * unit)
  cg.fill()
  cg.stroke()

  cg.strokeStyle = theme.caseHighlight
  cg.lineWidth = 0.75 * unit
  cg.beginPath()
  cg.moveTo(-topHalfW + 4.5 * unit, -halfH + 0.8 * unit)
  cg.lineTo(topHalfW - 4.5 * unit, -halfH + 0.8 * unit)
  cg.stroke()

  cg.fillStyle = theme.plate
  traceTrapezoid(cg, topHalfW - 3.2 * unit, botHalfW - 3.2 * unit, -halfH + 2.3 * unit, halfH - 2.3 * unit, 2.6 * unit)
  cg.fill()

  for (const spec of KEYS_65) {
    drawKeycap65(cg, spec, w, h, unit, theme, 0, 0)
  }

  if (theme.crestGold) {
    cg.strokeStyle = theme.crestGold
    cg.lineWidth = 0.95 * unit
    cg.lineCap = 'round'
    cg.beginPath()
    cg.arc(botHalfW - 6.5 * unit, halfH + skirtDepth * 0.48, 1.5 * unit, -0.2, Math.PI * 1.65)
    cg.stroke()
  }
}

function getCachedBoard(
  w: number,
  h: number,
  skirtDepth: number,
  unit: number,
  theme: MechanicalDeskTheme
): { canvas: HTMLCanvasElement; margin: number } | null {
  if (typeof document === 'undefined') return null
  const dpr = typeof window !== 'undefined' ? Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 2)) : 2
  const scale = Math.round(dpr * 2) / 2
  const margin = Math.ceil(11 * unit)
  const logW = Math.ceil(w * 1.06 + margin * 2)
  const logH = Math.ceil(h + skirtDepth + margin * 2)
  const key = `v2|${theme.id}|${w.toFixed(1)}|${h.toFixed(1)}|${skirtDepth.toFixed(1)}|${scale}|${theme.enterTop}|${theme.hitTop}`
  const hit = staticBoardCache.get(key)
  if (hit) return { canvas: hit, margin }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(logW * scale))
  canvas.height = Math.max(1, Math.round(logH * scale))
  const cg = canvas.getContext('2d')
  if (!cg) return null

  cg.save()
  cg.scale(scale, scale)
  cg.translate(logW * 0.5, margin + h * 0.5)
  paintStaticBoard(cg, w, h, skirtDepth, unit, theme, true)
  cg.restore()

  if (staticBoardCache.size >= 8) {
    const oldest = staticBoardCache.keys().next().value
    if (oldest) staticBoardCache.delete(oldest)
  }
  staticBoardCache.set(key, canvas)
  return { canvas, margin }
}

export function drawMechanicalDesk(
  ctx: CanvasRenderingContext2D,
  keyboard: PetKeyboardSurface,
  theme: MechanicalDeskTheme
): void {
  const { x, y, width: w, height: h, mousePad, space } = keyboard
  const unit = Math.max(0.75, w / 112)
  const skirtDepth = Math.max(3.6 * unit, Math.min(6.4 * unit, keyboard.caseDepth ?? h * 0.16))
  const bounceY = (keyboard.bounce ?? 0) * 1.15 * unit
  const cx = x + w * 0.5
  const cy = y + h * 0.5 + bounceY

  ctx.save()
  ctx.globalAlpha *= keyboard.opacity

  drawUnifiedDeskMat(ctx, keyboard, skirtDepth, unit, theme)
  if (mousePad) drawCordlessMiniMouse(ctx, mousePad, unit, theme)

  ctx.save()
  ctx.translate(cx, cy)

  const cached = getCachedBoard(w, h, skirtDepth, unit, theme)
  if (cached) {
    const logW = Math.ceil(w * 1.06 + cached.margin * 2)
    const logH = Math.ceil(h + skirtDepth + cached.margin * 2)
    ctx.drawImage(cached.canvas, -logW * 0.5, -(cached.margin + h * 0.5), logW, logH)
  } else {
    paintStaticBoard(ctx, w, h, skirtDepth, unit, theme, false)
  }

  const spaceActive = Boolean(space && (space.down > 0.02 || space.glow > 0.03))
  if (spaceActive && space) {
    const spaceSpec = KEYS_65.find((s) => s.role === 'space')!
    drawKeycap65(ctx, spaceSpec, w, h, unit, theme, space.down, space.glow)
  } else {
    const drawnIds = new Set<string>()
    for (const key of [keyboard.left, keyboard.right]) {
      if (key.onMouse || (key.down <= 0.03 && key.glow <= 0.03)) continue
      const spec = resolveHitSpec(key, x, w)
      if (drawnIds.has(spec.id)) continue
      drawnIds.add(spec.id)
      const hitRect = drawKeycap65(ctx, spec, w, h, unit, theme, key.down, key.glow)
      if (key.impact) drawImpactSpark(ctx, hitRect.cx, hitRect.cy, hitRect.kw, key, unit, theme.hitTop)
    }
  }

  ctx.restore()
  ctx.restore()
}

function drawImpactSpark(
  ctx: CanvasRenderingContext2D,
  kx: number,
  ky: number,
  kw: number,
  key: KeyboardKey,
  unit: number,
  color: string
): void {
  if (!key.impact) return
  const travel = (1 - key.glow) * 3.6 * unit
  ctx.save()
  ctx.globalAlpha *= key.impact * 0.82
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.85, 0.95 * unit)
  ctx.lineCap = 'round'
  for (const dir of [-1, 1] as const) {
    const sx = kx + dir * (kw * 0.55 + travel)
    const sy = ky - 2.6 * unit - travel
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx + dir * 1.8 * unit, sy - 2.1 * unit)
    ctx.stroke()
  }
  ctx.restore()
}

const XIAO_KUN_THEME: MechanicalDeskTheme = {
  id: 'xiao-kun',
  shadowColor: 'rgba(32, 62, 80, 0.28)',
  caseSkirt: '#5f879c',
  caseTop: '#bddae6',
  caseStroke: '#5d8498',
  caseHighlight: 'rgba(255, 255, 255, 0.82)',
  plate: '#8cb0c2',
  alphaTop: '#fffdf6',
  alphaSkirt: '#bbd0d9',
  modTop: '#dceef5',
  modSkirt: '#97b8c7',
  escTop: '#f39e44',
  escSkirt: '#b86919',
  enterTop: '#76c4e6',
  enterSkirt: '#428db2',
  hitTop: '#56b6e0',
  hitSkirt: '#2879a1',
  glyphColor: '#486b7d',
  escGlyph: '#ffffff',
  matBase: '#7fa4b6',
  matTop: '#dfeff5',
  matStroke: '#6f94a7',
  matStitch: 'rgba(255, 255, 255, 0.65)',
  mouseShadow: 'rgba(52, 86, 104, 0.28)',
  mouseSkirt: '#a3bfc9',
  mousePalmTop: '#ecf5f8',
  mousePalmBot: '#fffdf7',
  mousePlate: '#fffef9',
  mouseStroke: '#46697c',
  mouseSeam: 'rgba(62, 92, 108, 0.60)',
  mouseLeftHit: '#5eb5da',
  mouseRightHit: '#ff8552',
  mouseMiddleHit: '#3a95bf',
  wheelHousing: '#344e5e',
  wheelIdle: '#d8bd79',
  crestGold: '#d8bd79'
}

/** Artisan sky-blue, ivory-cream, and warm-gold 65% mechanical desk tailored to Xiao Kun. */
export function drawXiaoKunKeyboard(ctx: CanvasRenderingContext2D, keyboard: PetKeyboardSurface): void {
  drawMechanicalDesk(ctx, keyboard, XIAO_KUN_THEME)
}
