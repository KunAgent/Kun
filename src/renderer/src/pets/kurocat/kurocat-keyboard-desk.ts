import type {
  KuroCatKeyboardLayout,
  KuroCatKeyboardOrientation,
  ResolvedKuroCatSkin
} from '@shared/pets-kurocat'

export interface Vec2 {
  x: number
  y: number
}

export interface KuroCatKeySpec {
  id: string
  label: string
  row: number
  rowY?: number
  rowSpan?: number
  uStart: number
  uWidth: number
  accent?: 'orange' | 'mod'
}

export interface KuroCatKeyboardLayoutSpec {
  id: KuroCatKeyboardLayout
  totalUnits: number
  totalRows: number
  keys: readonly KuroCatKeySpec[]
  byId: ReadonlyMap<string, KuroCatKeySpec>
}

export interface KuroCatKeyAnim {
  pressed: boolean
  pressAmount: number
  lastHitAt: number
}

export interface KuroCatKeyBubble {
  id: number
  label: string
  isSpace: boolean
  x: number
  targetX: number
  y: number
  targetY: number
  rot: number
  createdAt: number
  lifetime: number
}

export interface KuroCatMouseBadge {
  id: number
  label: 'LMB' | 'RMB' | 'MMB'
  color: string
  x: number
  y: number
  createdAt: number
  lifetime: number
}

function buildKeys65(): KuroCatKeySpec[] {
  const keys: KuroCatKeySpec[] = [
    { id: 'esc', label: 'Esc', row: 0, uStart: 0, uWidth: 1, accent: 'orange' }
  ]
  const r0 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']
  r0.forEach((l, i) => keys.push({ id: `n_${i}`, label: l, row: 0, uStart: 1 + i, uWidth: 1 }))
  keys.push({ id: 'bs', label: '⌫', row: 0, uStart: 13, uWidth: 2, accent: 'mod' })
  keys.push({ id: 'pgup', label: 'PgUp', row: 0, uStart: 15, uWidth: 1, accent: 'mod' })

  keys.push({ id: 'tab', label: 'Tab', row: 1, uStart: 0, uWidth: 1.5, accent: 'mod' })
  const r1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']']
  r1.forEach((l, i) => keys.push({ id: `q_${i}`, label: l, row: 1, uStart: 1.5 + i, uWidth: 1 }))
  keys.push({ id: 'bslash', label: '\\', row: 1, uStart: 13.5, uWidth: 1.5, accent: 'mod' })
  keys.push({ id: 'pgdn', label: 'PgDn', row: 1, uStart: 15, uWidth: 1, accent: 'mod' })

  keys.push({ id: 'caps', label: 'Caps', row: 2, uStart: 0, uWidth: 1.75, accent: 'mod' })
  const r2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"]
  r2.forEach((l, i) => keys.push({ id: `a_${i}`, label: l, row: 2, uStart: 1.75 + i, uWidth: 1 }))
  keys.push({ id: 'enter', label: '↵', row: 2, uStart: 12.75, uWidth: 2.25, accent: 'mod' })
  keys.push({ id: 'del', label: 'Del', row: 2, uStart: 15, uWidth: 1, accent: 'mod' })

  keys.push({ id: 'lshift', label: '⇧', row: 3, uStart: 0, uWidth: 2.25, accent: 'mod' })
  const r3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/']
  r3.forEach((l, i) => keys.push({ id: `z_${i}`, label: l, row: 3, uStart: 2.25 + i, uWidth: 1 }))
  keys.push({ id: 'rshift', label: '⇧', row: 3, uStart: 12.25, uWidth: 1.75, accent: 'mod' })
  keys.push({ id: 'up', label: '↑', row: 3, uStart: 14, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'end', label: 'End', row: 3, uStart: 15, uWidth: 1, accent: 'mod' })

  keys.push({ id: 'lctrl', label: 'Ctrl', row: 4, uStart: 0, uWidth: 1.25, accent: 'mod' })
  keys.push({ id: 'lwin', label: 'Win', row: 4, uStart: 1.25, uWidth: 1.25, accent: 'mod' })
  keys.push({ id: 'lalt', label: 'Alt', row: 4, uStart: 2.5, uWidth: 1.25, accent: 'mod' })
  keys.push({ id: 'space', label: '', row: 4, uStart: 3.75, uWidth: 6.25 })
  keys.push({ id: 'ralt', label: 'Alt', row: 4, uStart: 10, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'fn', label: 'Fn', row: 4, uStart: 11, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'rctrl', label: 'Ctrl', row: 4, uStart: 12, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'left', label: '←', row: 4, uStart: 13, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'down', label: '↓', row: 4, uStart: 14, uWidth: 1, accent: 'mod' })
  keys.push({ id: 'right', label: '→', row: 4, uStart: 15, uWidth: 1, accent: 'mod' })
  return keys
}

function buildKeys108(): KuroCatKeySpec[] {
  const keys: KuroCatKeySpec[] = [
    { id: 'esc', label: 'Esc', row: 0, rowY: 0, uStart: 0, uWidth: 1, accent: 'orange' }
  ]
  for (let g = 0; g < 3; g++) {
    for (let k = 0; k < 4; k++) {
      const fn = g * 4 + k + 1
      keys.push({ id: `f${fn}`, label: `F${fn}`, row: 0, rowY: 0, uStart: 2 + g * 4.5 + k, uWidth: 1, accent: g === 1 ? 'mod' : undefined })
    }
  }
  const base65 = buildKeys65().filter((k) => !['pgup', 'pgdn', 'del', 'end', 'up', 'left', 'down', 'right'].includes(k.id))
  for (const k of base65) {
    keys.push({ ...k, row: k.row + 1, rowY: k.row + 1.25, uWidth: k.id === 'rshift' ? 2.75 : k.uWidth })
  }
  // Nav cluster + arrows + numpad
  const nav: Array<[string, string, number, number]> = [
    ['ins', 'Ins', 1.25, 15.5], ['home', 'Hm', 1.25, 16.5], ['pgup', 'PU', 1.25, 17.5],
    ['del', 'Del', 2.25, 15.5], ['end', 'End', 2.25, 16.5], ['pgdn', 'PD', 2.25, 17.5],
    ['up', '↑', 4.25, 16.5],
    ['left', '←', 5.25, 15.5], ['down', '↓', 5.25, 16.5], ['right', '→', 5.25, 17.5]
  ]
  for (const [id, label, rowY, uStart] of nav) {
    keys.push({ id, label, row: Math.floor(rowY), rowY, uStart, uWidth: 1, accent: 'mod' })
  }
  const np: Array<[string, string, number, number, number, number]> = [
    ['numlk', 'Nm', 1.25, 19, 1, 1], ['np_div', '/', 1.25, 20, 1, 1], ['np_mul', '*', 1.25, 21, 1, 1], ['np_sub', '-', 1.25, 22, 1, 1],
    ['np_7', '7', 2.25, 19, 1, 1], ['np_8', '8', 2.25, 20, 1, 1], ['np_9', '9', 2.25, 21, 1, 1], ['np_add', '+', 2.25, 22, 1, 2],
    ['np_4', '4', 3.25, 19, 1, 1], ['np_5', '5', 3.25, 20, 1, 1], ['np_6', '6', 3.25, 21, 1, 1],
    ['np_1', '1', 4.25, 19, 1, 1], ['np_2', '2', 4.25, 20, 1, 1], ['np_3', '3', 4.25, 21, 1, 1], ['np_ent', '↵', 4.25, 22, 1, 2],
    ['np_0', '0', 5.25, 19, 2, 1], ['np_dot', '.', 5.25, 21, 1, 1]
  ]
  for (const [id, label, rowY, uStart, uWidth, rowSpan] of np) {
    keys.push({ id, label, row: Math.floor(rowY), rowY, rowSpan, uStart, uWidth, accent: id.startsWith('np_') && label.length > 1 ? 'mod' : undefined })
  }
  return keys
}

const LAYOUT_65_KEYS = buildKeys65()
const LAYOUT_108_KEYS = buildKeys108()
const LAYOUT_65: KuroCatKeyboardLayoutSpec = {
  id: '65',
  totalUnits: 16,
  totalRows: 5,
  keys: LAYOUT_65_KEYS,
  byId: new Map(LAYOUT_65_KEYS.map((k) => [k.id, k]))
}
const LAYOUT_108: KuroCatKeyboardLayoutSpec = {
  id: '108',
  totalUnits: 23,
  totalRows: 6.25,
  keys: LAYOUT_108_KEYS,
  byId: new Map(LAYOUT_108_KEYS.map((k) => [k.id, k]))
}

export function getKuroCatKeyboardLayout(id: KuroCatKeyboardLayout): KuroCatKeyboardLayoutSpec {
  return id === '108' ? LAYOUT_108 : LAYOUT_65
}

const BUBBLE_NOTES = ['✦', '♪', '◈', '✿', '•', '✧'] as const

/** Map privacy-safe coarse zone (col 0..5, row 0..2) + sequence to a deterministic keycap & non-text bubble glyph. */
export function resolveKuroCatKeyForStrike(input: {
  layoutId: KuroCatKeyboardLayout
  side: 'left' | 'right'
  col?: number
  row?: number
  sequence: number
  isSpace: boolean
}): { spec: KuroCatKeySpec; bubbleLabel: string } {
  const layout = getKuroCatKeyboardLayout(input.layoutId)
  if (input.isSpace) {
    return { spec: layout.byId.get('space') ?? layout.keys[0], bubbleLabel: '␣' }
  }
  const col = input.col ?? (input.side === 'left' ? (input.sequence * 2) % 3 : 3 + ((input.sequence * 2) % 3))
  const row = input.row ?? (input.sequence % 3)

  // Outer-right modifier/action zone triggers authentic Enter / Backspace / Esc / Shift!
  if (col === 5) {
    const edgeId = row === 0 ? (input.sequence % 4 === 0 ? 'esc' : 'bs') : row === 1 ? 'enter' : 'rshift'
    const spec = layout.byId.get(edgeId) ?? layout.keys[0]
    const glyph = edgeId === 'enter' ? '⏎' : edgeId === 'bs' ? '⌫' : edgeId === 'esc' ? '⎋' : '⇧'
    return { spec, bubbleLabel: glyph }
  }
  if (col === 0 && row === 2 && input.sequence % 3 === 0) {
    return { spec: layout.byId.get('lshift') ?? layout.keys[0], bubbleLabel: '⇧' }
  }

  const targetRow = layout.id === '108'
    ? (row === 0 ? 1.25 + (input.sequence % 2) : row === 1 ? 3.25 : 4.25)
    : (row === 0 ? (input.sequence % 2) : row === 1 ? 2 : 3)
  const mainUnits = 15
  const baseU = 0.8 + (Math.max(0, Math.min(5, col)) / 5) * (mainUnits - 2.2)
  const jitterU = ((input.sequence % 3) - 1) * 0.85
  const uTarget = Math.max(0.6, Math.min(mainUnits - 1.2, baseU + jitterU))

  let best = layout.keys[18] ?? layout.keys[0]
  let bestDist = Infinity
  for (const k of layout.keys) {
    if (k.id === 'space') continue
    const kr = k.rowY ?? k.row
    if (Math.abs(kr - targetRow) > 0.6) continue
    const center = k.uStart + k.uWidth * 0.5
    const dist = Math.abs(center - uTarget)
    if (dist < bestDist) {
      bestDist = dist
      best = k
    }
  }
  return { spec: best, bubbleLabel: BUBBLE_NOTES[input.sequence % BUBBLE_NOTES.length] }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function trapezoidPath(ctx: CanvasRenderingContext2D, topHalfW: number, botHalfW: number, topY: number, botY: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(-topHalfW + r, topY)
  ctx.lineTo(topHalfW - r, topY)
  ctx.quadraticCurveTo(topHalfW, topY, topHalfW + 1, topY + r)
  ctx.lineTo(botHalfW, botY - r)
  ctx.quadraticCurveTo(botHalfW, botY, botHalfW - r, botY)
  ctx.lineTo(-botHalfW + r, botY)
  ctx.quadraticCurveTo(-botHalfW, botY, -botHalfW, botY - r)
  ctx.lineTo(-topHalfW - 1, topY + r)
  ctx.quadraticCurveTo(-topHalfW, topY, -topHalfW + r, topY)
  ctx.closePath()
}

const kbStaticCache = new Map<string, HTMLCanvasElement>()

export function drawKuroCatKeyboard(
  ctx: CanvasRenderingContext2D,
  opts: {
    layoutId: KuroCatKeyboardLayout
    orientation: KuroCatKeyboardOrientation
    kbCenterX: number
    kbCenterY: number
    kbWidth: number
    kbHeight: number
    kbTiltRad: number
    kbBounce: number
    deskHopY: number
    catBreed: 'black' | 'ragdoll'
    customSkin: ResolvedKuroCatSkin | null
    keyAnims: ReadonlyMap<string, KuroCatKeyAnim>
    uniformScale: number
  }
): void {
  const layout = getKuroCatKeyboardLayout(opts.layoutId)
  const isCatFacing = opts.orientation === 'cat'
  const is108 = opts.layoutId === '108'
  const padX = 7
  const padY = 6
  const innerW = opts.kbWidth - padX * 2
  const innerH = opts.kbHeight - padY * 2
  const topHalfW = (opts.kbWidth * 0.955) * 0.5
  const botHalfW = (opts.kbWidth * 1.035) * 0.5
  const halfH = opts.kbHeight * 0.5
  const rowH = innerH / layout.totalRows
  const unitW = innerW / layout.totalUnits
  const gap = is108 ? 0.85 : 0.9

  const accentTop = opts.customSkin ? opts.customSkin.accentColor : opts.catBreed === 'ragdoll' ? '#7ac7ff' : '#d2f244'
  const accentSide = opts.customSkin ? opts.customSkin.accentSideColor : opts.catBreed === 'ragdoll' ? '#4690d8' : '#8cb014'

  const drawSingleKey = (target: CanvasRenderingContext2D, key: KuroCatKeySpec, press: number): void => {
    const rY = key.rowY ?? key.row
    const rSpan = key.rowSpan ?? 1
    const screenRowTop = isCatFacing ? layout.totalRows - (rY + rSpan) : rY
    const screenUStart = isCatFacing ? layout.totalUnits - (key.uStart + key.uWidth) : key.uStart
    const rowCenterFrac = (screenRowTop + rSpan * 0.5) / layout.totalRows
    const depthScale = 0.94 + rowCenterFrac * 0.09
    const rawX = -innerW * 0.5 + screenUStart * unitW + gap * 0.5
    const rawW = key.uWidth * unitW - gap
    const x = rawX * depthScale
    const w = rawW * depthScale
    const y = -innerH * 0.5 + screenRowTop * rowH + gap * 0.5 + press * 2.0
    const h = rSpan * rowH - gap - 0.8

    let topColor = '#f8f8f5'
    let sideColor = '#d0d2cc'
    if (press > 0.14) {
      topColor = accentTop
      sideColor = accentSide
    } else if (key.accent === 'orange') {
      topColor = '#f4a524'
      sideColor = '#c27a10'
    } else if (key.accent === 'mod') {
      topColor = '#efefeb'
      sideColor = '#c7c9c3'
    }

    if (press > 0.01) {
      target.fillStyle = '#d4d6d1'
      target.fillRect(x - 0.4, -innerH * 0.5 + screenRowTop * rowH + gap * 0.5 - 0.4, w + 0.8, h + 3.8)
    }

    target.fillStyle = sideColor
    roundRect(target, x, y + 1.4, w, h, 1.8)
    target.fill()

    target.fillStyle = topColor
    roundRect(target, x, y, w, h - 0.9, 1.8)
    target.fill()

    const legend = key.id === 'space' ? '' : key.id === 'esc' ? 'Esc' : key.label
    if (legend) {
      const isWideWord = legend.length >= 3
      const fontSize = is108 ? (isWideWord ? 5.0 : legend.length === 2 ? 5.8 : 7.2) : (isWideWord ? 5.6 : legend.length === 2 ? 6.4 : 7.8)
      target.save()
      target.translate(x + w * 0.5, y + (h - 0.9) * 0.5)
      if (isCatFacing) target.rotate(Math.PI)
      target.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`
      target.fillStyle = press > 0.14 ? '#111214' : key.accent === 'orange' ? '#ffffff' : '#2c2f36'
      target.textAlign = 'center'
      target.textBaseline = 'middle'
      target.fillText(legend, 0, 0)
      target.restore()
    }
  }

  ctx.save()
  ctx.translate(opts.kbCenterX, opts.kbCenterY + opts.kbBounce * 1.1 + opts.deskHopY)
  ctx.rotate(opts.kbTiltRad)

  const cacheScale = Math.min(2.5, Math.max(1.5, Math.ceil(opts.uniformScale * 2) / 2))
  const padMargin = 20
  const cacheLogW = Math.ceil(botHalfW * 2 + padMargin * 2)
  const cacheLogH = Math.ceil(opts.kbHeight + padMargin * 2)
  const cacheKey = `${opts.layoutId}|${opts.orientation}|${opts.kbWidth}|${opts.kbHeight}|${cacheScale}`

  let cached = typeof document !== 'undefined' ? kbStaticCache.get(cacheKey) ?? null : null
  if (!cached && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = Math.round(cacheLogW * cacheScale)
    c.height = Math.round(cacheLogH * cacheScale)
    const cg = c.getContext('2d')
    if (cg) {
      cg.save()
      cg.scale(cacheScale, cacheScale)
      cg.translate(cacheLogW * 0.5, cacheLogH * 0.5)
      cg.save()
      cg.shadowColor = 'rgba(0, 0, 0, 0.34)'
      cg.shadowBlur = 11
      cg.shadowOffsetY = 5
      cg.fillStyle = '#191a1e'
      trapezoidPath(cg, topHalfW, botHalfW, -halfH + 3.5, halfH + 5.5, 6.5)
      cg.fill()
      cg.restore()

      cg.fillStyle = '#24262c'
      cg.strokeStyle = '#363840'
      cg.lineWidth = 1.1
      trapezoidPath(cg, topHalfW, botHalfW, -halfH, halfH, 6.5)
      cg.fill()
      cg.stroke()

      cg.fillStyle = '#d4d6d1'
      trapezoidPath(cg, topHalfW - 5, botHalfW - 5, -halfH + 4, halfH - 4, 3.5)
      cg.fill()

      for (const key of layout.keys) drawSingleKey(cg, key, 0)
      cg.restore()
      if (kbStaticCache.size >= 6) {
        const oldest = kbStaticCache.keys().next().value
        if (oldest) kbStaticCache.delete(oldest)
      }
      kbStaticCache.set(cacheKey, c)
      cached = c
    }
  }

  if (cached) {
    ctx.drawImage(cached, -cacheLogW * 0.5, -cacheLogH * 0.5, cacheLogW, cacheLogH)
  } else {
    ctx.fillStyle = '#191a1e'
    trapezoidPath(ctx, topHalfW, botHalfW, -halfH + 3.5, halfH + 5.5, 6.5)
    ctx.fill()
    ctx.fillStyle = '#24262c'
    ctx.strokeStyle = '#363840'
    ctx.lineWidth = 1.1
    trapezoidPath(ctx, topHalfW, botHalfW, -halfH, halfH, 6.5)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#d4d6d1'
    trapezoidPath(ctx, topHalfW - 5, botHalfW - 5, -halfH + 4, halfH - 4, 3.5)
    ctx.fill()
    for (const key of layout.keys) drawSingleKey(ctx, key, 0)
  }

  for (const key of layout.keys) {
    const anim = opts.keyAnims.get(key.id)
    const press = anim ? anim.pressAmount : 0
    if (press > 0.01) drawSingleKey(ctx, key, press)
  }
  ctx.restore()
}

export function drawKuroCatMiniMouse(
  ctx: CanvasRenderingContext2D,
  opts: {
    mx: number
    my: number
    leftPress: number
    rightPress: number
    middlePress: number
    scrollFlash: number
    leftColor: string
    rightColor: string
    middleColor: string
  }
): void {
  const rx = 18.5
  const ry = 23.0
  const lPress = opts.leftPress
  const rPress = opts.rightPress
  const mPress = Math.max(opts.middlePress, opts.scrollFlash)

  ctx.save()
  ctx.translate(opts.mx, opts.my)
  ctx.rotate(-0.06)

  ctx.fillStyle = '#c8cac4'
  ctx.beginPath()
  ctx.ellipse(0, 1.8, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()

  const palmGrad = ctx.createLinearGradient(0, -ry, 0, 2)
  palmGrad.addColorStop(0, '#ecece7')
  palmGrad.addColorStop(1, '#f4f4f0')
  ctx.fillStyle = palmGrad
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, rx - 0.5, ry - 0.5, 0, 0, Math.PI * 2)
  ctx.clip()

  ctx.beginPath()
  ctx.moveTo(0, 0.5)
  ctx.quadraticCurveTo(rx * 0.52, 0.4, rx + 2, -0.8)
  ctx.lineTo(rx + 2, ry + 2)
  ctx.lineTo(0, ry + 2)
  ctx.closePath()
  ctx.fillStyle = lPress > 0.08 ? opts.leftColor : '#fafaf7'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(-rx - 2, -0.8)
  ctx.quadraticCurveTo(-rx * 0.52, 0.4, 0, 0.5)
  ctx.lineTo(0, ry + 2)
  ctx.lineTo(-rx - 2, ry + 2)
  ctx.closePath()
  ctx.fillStyle = rPress > 0.08 ? opts.rightColor : '#fafaf7'
  ctx.fill()

  ctx.strokeStyle = 'rgba(42, 45, 52, 0.56)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(-rx - 2, -0.8)
  ctx.quadraticCurveTo(0, 1.8, rx + 2, -0.8)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(42, 45, 52, 0.66)'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(0, 0.6)
  ctx.lineTo(0, ry + 1)
  ctx.stroke()

  ctx.fillStyle = '#2d2f36'
  roundRect(ctx, -2.5, 4.2, 5.0, 9.4, 2.5)
  ctx.fill()

  ctx.fillStyle = mPress > 0.12 ? opts.middleColor : '#6b6f78'
  roundRect(ctx, -1.7, 5.0 + opts.middlePress * 0.8, 3.4, 7.6, 1.7)
  ctx.fill()

  ctx.font = '800 7.6px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = lPress > 0.12 ? '#14161a' : 'rgba(72, 76, 86, 0.56)'
  ctx.fillText('L', 7.4, 14.0 + lPress * 0.9)
  ctx.fillStyle = rPress > 0.12 ? '#ffffff' : 'rgba(72, 76, 86, 0.56)'
  ctx.fillText('R', -7.4, 14.0 + rPress * 0.9)
  ctx.restore()

  ctx.strokeStyle = '#2b2d34'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawKuroCatKeyBubbles(ctx: CanvasRenderingContext2D, bubbles: readonly KuroCatKeyBubble[], now: number): void {
  for (const b of bubbles) {
    const t = Math.max(0, Math.min(1, (now - b.createdAt) / b.lifetime))
    let scale = 1
    if (t < 0.11) scale = 0.62 + Math.sin((t / 0.11) * Math.PI * 0.65) * 0.44
    else if (t > 0.76) scale = 1 - ((t - 0.76) / 0.24) * 0.1
    const alpha = t < 0.72 ? 1 : Math.max(0, 1 - (t - 0.72) / 0.28)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(b.x, b.y)
    ctx.rotate(b.rot)
    ctx.scale(scale, scale)

    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif'
    const boxW = b.isSpace ? 40 : 26
    const boxH = 24
    const bx = -boxW * 0.5
    const by = -boxH * 0.5

    ctx.fillStyle = '#c8cac6'
    roundRect(ctx, bx, by + 2.2, boxW, boxH, 5.5)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(38, 40, 46, 0.42)'
    ctx.lineWidth = 1.05
    roundRect(ctx, bx, by, boxW, boxH - 1.3, 5.5)
    ctx.fill()
    ctx.stroke()

    if (b.isSpace) {
      ctx.strokeStyle = '#222429'
      ctx.lineWidth = 1.55
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(-9, -1)
      ctx.lineTo(-9, 2)
      ctx.lineTo(9, 2)
      ctx.lineTo(9, -1)
      ctx.stroke()
    } else {
      ctx.fillStyle = '#1e2025'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(b.label, 0, -0.5)
    }
    ctx.restore()
  }
}

export function drawKuroCatMouseBadges(ctx: CanvasRenderingContext2D, badges: readonly KuroCatMouseBadge[], now: number): void {
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i]
    const t = Math.max(0, Math.min(1, (now - b.createdAt) / b.lifetime))
    const scale = t < 0.14 ? 0.65 + Math.sin((t / 0.14) * Math.PI * 0.65) * 0.42 : t > 0.72 ? 1 - ((t - 0.72) / 0.28) * 0.12 : 1
    const alpha = t < 0.68 ? 1 : Math.max(0, 1 - (t - 0.68) / 0.32)
    const liftY = t * 14 + (badges.length - 1 - i) * 18

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(b.x, b.y - liftY)
    ctx.scale(scale, scale)

    ctx.fillStyle = '#22242a'
    roundRect(ctx, -17, -7.9, 34, 19, 5)
    ctx.fill()

    ctx.fillStyle = b.color
    ctx.strokeStyle = 'rgba(20, 22, 28, 0.45)'
    ctx.lineWidth = 1
    roundRect(ctx, -17, -9.5, 34, 18, 5)
    ctx.fill()
    ctx.stroke()

    ctx.font = '800 9.5px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = b.label === 'RMB' ? '#ffffff' : '#14161a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(b.label, 0, -0.3)
    ctx.restore()
  }
}
