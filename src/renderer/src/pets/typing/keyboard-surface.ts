import { drawMechanicalDesk, drawXiaoKunKeyboard, type MechanicalDeskTheme } from './xiao-kun-keyboard'

export type KeyboardKey = {
  x: number; y: number; down: number; glow: number
  depth?: number; impact?: number; onMouse?: boolean
  col?: number; row?: number; sequence?: number
}
export type KeyboardPopSurface = {
  id: number
  kind: 'key' | 'space' | 'mouse-left' | 'mouse-right' | 'mouse-middle'
  x: number
  y: number
  progress: number
}
export type PetMousePadSurface = {
  x: number; y: number; width: number; height: number
  mouseX: number; mouseY: number
  leftButton: boolean; rightButton: boolean; middleButton?: boolean
  leftPress?: number; rightPress?: number; middlePress?: number
  wheelGlow: number; wheelDir: -1 | 0 | 1
}
export type PetKeyboardSurface = {
  x: number; y: number; width: number; height: number; opacity: number; accent: string
  left: KeyboardKey; right: KeyboardKey
  space?: { down: number; glow: number }
  bounce?: number
  pops?: KeyboardPopSurface[]
  mousePad?: PetMousePadSurface
  theme?: 'xiao-kun'
  caseDepth?: number
}

function buildStandardTheme(accent: string): MechanicalDeskTheme {
  const isOcean = /^#[5-9][0-9a-f][b-f]/i.test(accent)
  const hitTop = isOcean ? '#5cc8ff' : '#d4f044'
  const hitSkirt = isOcean ? '#2563eb' : '#89ab12'
  const enterTop = isOcean ? '#7ac7ff' : accent
  const enterSkirt = isOcean ? '#458dd6' : '#a8752e'
  const mouseMiddleHit = isOcean ? '#2563eb' : '#92ba12'
  return {
    id: `kurocat:${accent}`,
    shadowColor: 'rgba(10, 14, 22, 0.34)',
    caseSkirt: '#17191f',
    caseTop: '#262a34',
    caseStroke: '#3b404e',
    caseHighlight: 'rgba(255, 255, 255, 0.16)',
    plate: '#2e3340',
    alphaTop: '#f8f8f4',
    alphaSkirt: '#c6c8c0',
    modTop: '#e6e5de',
    modSkirt: '#b3b5ad',
    escTop: '#f49d24',
    escSkirt: '#bf700e',
    enterTop,
    enterSkirt,
    hitTop,
    hitSkirt,
    glyphColor: '#2c3038',
    escGlyph: '#ffffff',
    matBase: '#14161c',
    matTop: '#21242d',
    matStroke: '#343946',
    matStitch: 'rgba(255, 255, 255, 0.09)',
    mouseShadow: 'rgba(0, 0, 0, 0.34)',
    mouseSkirt: '#c4c6bf',
    mousePalmTop: '#ebece6',
    mousePalmBot: '#f7f7f2',
    mousePlate: '#fbfbf8',
    mouseStroke: '#2b2d34',
    mouseSeam: 'rgba(42, 45, 52, 0.60)',
    mouseLeftHit: hitTop,
    mouseRightHit: '#ff7b3b',
    mouseMiddleHit,
    wheelHousing: '#2d2f36',
    wheelIdle: '#6b6f78'
  }
}

export function drawPetKeyboard(ctx: CanvasRenderingContext2D, keyboard: PetKeyboardSurface): void {
  if (keyboard.theme === 'xiao-kun') {
    drawXiaoKunKeyboard(ctx, keyboard)
    return
  }
  drawMechanicalDesk(ctx, keyboard, buildStandardTheme(keyboard.accent))
}

/**
 * Foreground 3D PBT keycap pop bubbles (horizontal non-overlapping row, zero typed characters)
 * and KuroCat-style stacked LMB / RMB / MMB mouse click badges.
 */
export function drawPetKeyboardPops(ctx: CanvasRenderingContext2D, keyboard: PetKeyboardSurface): void {
  const pops = keyboard.pops
  if (!pops?.length || keyboard.opacity <= 0.02) return

  const xiaoKun = keyboard.theme === 'xiao-kun'
  const unit = Math.max(0.8, keyboard.width / 112)
  const isOcean = /^#[5-9][0-9a-f][b-f]/i.test(keyboard.accent)
  const primaryHit = xiaoKun ? '#5eb5da' : isOcean ? '#5cc8ff' : '#d4f044'
  const middleHit = xiaoKun ? '#3a95bf' : isOcean ? '#2563eb' : '#92ba12'

  const keyPops = pops.filter((p) => p.kind === 'key' || p.kind === 'space')
  const mousePops = pops.filter((p) => p.kind !== 'key' && p.kind !== 'space')

  // 1) Horizontal spring-arranged 3D PBT keycap pop bubbles above the keyboard
  if (keyPops.length > 0) {
    const widths = keyPops.map((p) => (p.kind === 'space' ? 19.5 : 11.4) * unit)
    const gap = 2.0 * unit
    const totalW = widths.reduce((sum, v) => sum + v, 0) + gap * (keyPops.length - 1)
    const avgSpawnX = keyPops.reduce((sum, p) => sum + p.x, 0) / keyPops.length
    const minLeft = keyboard.x + 4 * unit
    const maxLeft = Math.max(minLeft, keyboard.x + keyboard.width - 4 * unit - totalW)
    let cursorX = Math.max(minLeft, Math.min(maxLeft, avgSpawnX - totalW * 0.5))

    const capFace = xiaoKun ? '#fffef9' : '#ffffff'
    const capSkirt = xiaoKun ? '#9bc2d3' : '#c8cac6'
    const capStroke = xiaoKun ? 'rgba(66, 98, 114, 0.55)' : 'rgba(38, 40, 46, 0.44)'
    const markColor = xiaoKun ? '#2e7ba3' : isOcean ? '#2563eb' : '#5f760a'

    for (let i = 0; i < keyPops.length; i++) {
      const pop = keyPops[i]
      const w = widths[i]
      const slotX = cursorX + w * 0.5
      cursorX += w + gap

      const t = Math.max(0, Math.min(1, pop.progress))
      let scale = 1
      if (t < 0.14) scale = 0.62 + Math.sin((t / 0.14) * Math.PI * 0.65) * 0.44
      else if (t > 0.74) scale = 1 - ((t - 0.74) / 0.26) * 0.10
      const alpha = keyboard.opacity * (t < 0.68 ? 1 : Math.max(0, 1 - (t - 0.68) / 0.32))
      if (alpha <= 0.02) continue

      const settle = Math.min(1, t / 0.22)
      const cx = pop.x + (slotX - pop.x) * settle
      const rise = (1 - (1 - t) * (1 - t)) * 9.5 * unit + ((pop.id % 3) - 1) * 1.1 * unit
      const cy = pop.y + 1.5 * unit - rise
      const rot = ((pop.id % 5) - 2) * 0.022
      const boxH = 9.8 * unit
      const rad = 2.4 * unit

      ctx.save()
      ctx.globalAlpha *= alpha
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.scale(scale, scale)

      ctx.fillStyle = 'rgba(20, 26, 36, 0.18)'
      ctx.beginPath()
      ctx.roundRect(-w * 0.5, -boxH * 0.5 + 2.1 * unit, w, boxH, rad)
      ctx.fill()

      ctx.fillStyle = capSkirt
      ctx.beginPath()
      ctx.roundRect(-w * 0.5, -boxH * 0.5 + 1.3 * unit, w, boxH, rad)
      ctx.fill()

      ctx.fillStyle = capFace
      ctx.strokeStyle = capStroke
      ctx.lineWidth = 0.8 * unit
      ctx.beginPath()
      ctx.roundRect(-w * 0.5, -boxH * 0.5, w, boxH - 0.7 * unit, rad)
      ctx.fill()
      ctx.stroke()

      // Subtle inner keycap dish tint
      ctx.save()
      ctx.globalAlpha *= 0.28 * (1 - t * 0.35)
      ctx.fillStyle = primaryHit
      ctx.beginPath()
      ctx.roundRect(-w * 0.5 + 1.0 * unit, -boxH * 0.5 + 0.8 * unit, w - 2.0 * unit, boxH - 2.3 * unit, rad * 0.65)
      ctx.fill()
      ctx.restore()

      ctx.strokeStyle = markColor
      ctx.fillStyle = markColor
      ctx.lineWidth = 1.15 * unit
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (pop.kind === 'space') {
        // KuroCat iconic U-shaped spacebar tray symbol
        const sw = w * 0.28
        ctx.beginPath()
        ctx.moveTo(-sw, -0.8 * unit)
        ctx.lineTo(-sw, 1.0 * unit)
        ctx.lineTo(sw, 1.0 * unit)
        ctx.lineTo(sw, -0.8 * unit)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(0, -0.15 * unit, 1.25 * unit, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  }

  // 2) KuroCat-style crisp stacked LMB / RMB / MMB pill badges above the mini-mouse
  for (let i = 0; i < mousePops.length; i++) {
    const pop = mousePops[i]
    const t = Math.max(0, Math.min(1, pop.progress))
    let scale = 1
    if (t < 0.14) scale = 0.65 + Math.sin((t / 0.14) * Math.PI * 0.65) * 0.42
    else if (t > 0.72) scale = 1 - ((t - 0.72) / 0.28) * 0.12
    const alpha = keyboard.opacity * (t < 0.68 ? 1 : Math.max(0, 1 - (t - 0.68) / 0.32))
    if (alpha <= 0.02) continue

    const stackLift = t * 9.5 * unit + (mousePops.length - 1 - i) * 12.5 * unit
    const boxW = 22.5 * unit
    const boxH = 11.8 * unit
    const rad = 3.2 * unit
    const isRight = pop.kind === 'mouse-right'
    const isMiddle = pop.kind === 'mouse-middle'
    const badgeFill = isRight ? '#ff7b3b' : isMiddle ? middleHit : primaryHit
    const label = isRight ? 'RMB' : isMiddle ? 'MMB' : 'LMB'
    const textFill = isRight || (isMiddle && !xiaoKun) ? '#ffffff' : '#14161a'

    ctx.save()
    ctx.globalAlpha *= alpha
    ctx.translate(pop.x, pop.y - stackLift)
    ctx.scale(scale, scale)

    ctx.fillStyle = '#22242a'
    ctx.beginPath()
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5 + 1.3 * unit, boxW, boxH, rad)
    ctx.fill()

    ctx.fillStyle = badgeFill
    ctx.strokeStyle = 'rgba(20, 22, 28, 0.45)'
    ctx.lineWidth = 0.8 * unit
    ctx.beginPath()
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH - 0.7 * unit, rad)
    ctx.fill()
    ctx.stroke()

    const fontPx = Math.max(6.2, 6.8 * unit)
    ctx.font = `800 ${fontPx.toFixed(1)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = textFill
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, -0.2 * unit)

    ctx.restore()
  }
}
