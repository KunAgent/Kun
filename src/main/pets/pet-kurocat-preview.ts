import { PET_CELL_HEIGHT, PET_CELL_WIDTH, PET_ROWS, PET_SHEET_HEIGHT_V1, PET_SHEET_WIDTH, type PetAnimationState } from '../../shared/pets'
import { defaultPetInteractions, type PetInteractionPack } from '../../shared/pets-interactions'
import { resolveKuroCatSkin, type KuroCatSkinConfig, type ResolvedKuroCatSkin } from '../../shared/pets-kurocat'
import { encodeRgbaPng } from './pet-image'

type Rgba = readonly [number, number, number, number]

function parseColor(raw: string | null | undefined, fallback: Rgba = [20, 19, 20, 255]): Rgba {
  if (!raw) return fallback
  const s = raw.trim()
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgb) {
    const a = rgb[4] !== undefined ? Math.round(Math.max(0, Math.min(1, parseFloat(rgb[4]))) * 255) : 255
    return [Math.round(parseFloat(rgb[1])), Math.round(parseFloat(rgb[2])), Math.round(parseFloat(rgb[3])), a]
  }
  return fallback
}

function blendPixel(buf: Buffer, width: number, height: number, x: number, y: number, col: Rgba, cov: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height || cov <= 0.004) return
  const srcA = (col[3] / 255) * Math.min(1, cov)
  if (srcA <= 0.004) return
  const idx = (y * width + x) * 4
  const dstA = buf[idx + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0.001) return
  buf[idx] = Math.round((col[0] * srcA + buf[idx] * dstA * (1 - srcA)) / outA)
  buf[idx + 1] = Math.round((col[1] * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA)
  buf[idx + 2] = Math.round((col[2] * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA)
  buf[idx + 3] = Math.round(outA * 255)
}

function fillEllipse(
  buf: Buffer,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  col: Rgba,
  outline?: Rgba | null
): void {
  const pad = outline ? 2.6 : 1.4
  const x0 = Math.max(0, Math.floor(cx - rx - pad))
  const x1 = Math.min(w - 1, Math.ceil(cx + rx + pad))
  const y0 = Math.max(0, Math.floor(cy - ry - pad))
  const y1 = Math.min(h - 1, Math.ceil(cy + ry + pad))
  const scale = Math.min(rx, ry)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / Math.max(0.5, rx)
      const ny = (y + 0.5 - cy) / Math.max(0.5, ry)
      const dist = (Math.hypot(nx, ny) - 1) * scale
      if (outline && dist <= 1.7) {
        blendPixel(buf, w, h, x, y, outline, 1.7 - dist)
      }
      if (dist <= 0.65) {
        blendPixel(buf, w, h, x, y, col, 0.65 - dist)
      }
    }
  }
}

function fillSegment(buf: Buffer, w: number, h: number, ax: number, ay: number, bx: number, by: number, rad: number, col: Rgba): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad - 1.5))
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rad + 1.5))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad - 1.5))
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rad + 1.5))
  const vx = bx - ax, vy = by - ay
  const len2 = Math.max(0.001, vx * vx + vy * vy)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / len2))
      const d = Math.hypot(px - vx * t, py - vy * t) - rad
      if (d < 0.7) blendPixel(buf, w, h, x, y, col, 0.7 - d)
    }
  }
}

function drawCellCat(
  cell: Buffer,
  s: ResolvedKuroCatSkin,
  opts: { lidClose: number; happySquint: boolean; bobY: number; leanX: number; waveSide: number }
): void {
  const W = PET_CELL_WIDTH, H = PET_CELL_HEIGHT
  const fur = parseColor(s.furColor)
  const outline = s.outlineColor ? parseColor(s.outlineColor) : null
  const earCol = parseColor(s.earOuterColor)
  const innerEar = s.earInnerColor ? parseColor(s.earInnerColor) : null
  const tailCol = parseColor(s.tailColor)
  const tailTip = parseColor(s.tailTipColor)
  const pawCol = parseColor(s.pawColor)
  const cx = 94 + opts.leanX
  const baseY = 176 + opts.bobY
  const headY = 92 + opts.bobY

  // Ground shadow
  fillEllipse(cell, W, H, 96, 184, 42, 7.5, [15, 20, 28, 52])

  // S-hook tail behind right hip
  const tPts: Array<[number, number]> = [
    [cx + 32, baseY - 14],
    [cx + 52, baseY - 16],
    [cx + 58, baseY - 34],
    [cx + 68, baseY - 40]
  ]
  for (let i = 0; i < tPts.length - 1; i++) {
    const col = i === tPts.length - 2 ? tailTip : tailCol
    if (outline) fillSegment(cell, W, H, tPts[i][0], tPts[i][1], tPts[i + 1][0], tPts[i + 1][1], s.tailFluffy ? 9.2 : 7.4, outline)
    fillSegment(cell, W, H, tPts[i][0], tPts[i][1], tPts[i + 1][0], tPts[i + 1][1], s.tailFluffy ? 7.8 : 6.0, col)
  }

  // Ears
  const earScale = s.contour.earScale
  const earSpace = 24 * s.contour.earSpacing * s.contour.headWidth
  for (const side of [-1, 1] as const) {
    const ex = cx + side * earSpace
    const ey = headY - 26
    if (s.contour.earShape === 'floppy') {
      fillEllipse(cell, W, H, ex + side * 10, ey + 18, 8 * earScale, 16 * earScale, earCol, outline)
    } else if (s.contour.earShape === 'round' || s.contour.earShape === 'folded') {
      fillEllipse(cell, W, H, ex, ey + (s.contour.earShape === 'folded' ? 6 : 2), 11 * earScale, 9 * earScale, earCol, outline)
    } else {
      const tipY = ey - (s.contour.earShape === 'tall' ? 16 : s.contour.earShape === 'small' ? 7 : 11) * earScale
      if (outline) {
        fillSegment(cell, W, H, ex - side * 9, ey + 8, ex + side * 2, tipY, 6.8 * earScale, outline)
        fillSegment(cell, W, H, ex + side * 9, ey + 10, ex + side * 2, tipY, 6.8 * earScale, outline)
      }
      fillSegment(cell, W, H, ex - side * 8, ey + 8, ex + side * 2, tipY, 5.5 * earScale, earCol)
      fillSegment(cell, W, H, ex + side * 8, ey + 10, ex + side * 2, tipY, 5.5 * earScale, earCol)
      if (innerEar) fillSegment(cell, W, H, ex, ey + 6, ex + side * 1.5, tipY + 4, 2.8 * earScale, innerEar)
    }
  }

  // Plump seated pear torso + head
  const chubby = s.contour.bodyChubbiness
  fillEllipse(cell, W, H, cx, baseY - 28, 42 * chubby, 36, fur, outline)
  fillEllipse(cell, W, H, cx, headY + 2, 36 * s.contour.headWidth, 30, fur, outline)

  // Coat markings (bib / mask / calico / tabby)
  if (s.bellyBibColor) {
    fillEllipse(cell, W, H, cx, baseY - 22, 20, 24, parseColor(s.bellyBibColor))
  }
  if (s.pattern === 'siamese' && s.maskColor) {
    fillEllipse(cell, W, H, cx, headY + 4, 23, 15, parseColor(s.maskColor))
  } else if (s.pattern === 'calico') {
    fillEllipse(cell, W, H, cx - 19, headY - 8, 14, 11, parseColor(s.maskColor || '#ea9446'))
    fillEllipse(cell, W, H, cx + 20, headY - 7, 13, 11, parseColor(s.calicoPatchColor || '#3c3634'))
  } else if (s.pattern === 'bicolor' && s.maskColor) {
    fillEllipse(cell, W, H, cx - 18, headY - 8, 15, 12, parseColor(s.maskColor))
    fillEllipse(cell, W, H, cx + 18, headY - 8, 15, 12, parseColor(s.maskColor))
  } else if (s.pattern === 'tabby' && s.stripeColor) {
    const st = parseColor(s.stripeColor)
    for (const dx of [-6, 0, 6]) fillSegment(cell, W, H, cx + dx, headY - 19, cx + dx * 0.7, headY - 11, 1.5, st)
  }

  // Seated paws / waving paw
  fillEllipse(cell, W, H, cx - 18, baseY - 2, 9.5, 7, pawCol, outline)
  if (opts.waveSide !== 0) {
    fillSegment(cell, W, H, cx + 22, headY + 28, cx + 38, headY + 6, 6.5, parseColor(s.armColor))
    fillEllipse(cell, W, H, cx + 39, headY + 5, 7.5, 6.5, pawCol, outline)
  } else {
    fillEllipse(cell, W, H, cx + 18, baseY - 2, 9.5, 7, pawCol, outline)
  }

  // Eyes
  const eyeSpace = 14.5 * s.contour.eyeSpacing
  const eyeRx = 8.6 * s.contour.eyeScale
  const eyeRy = Math.max(1.3, 7.8 * s.contour.eyeScale * s.contour.eyeAspect * (1 - opts.lidClose))
  const pupilCol = parseColor(s.pupilColor)
  const squintCol = parseColor(s.squintColor)
  for (let idx = 0; idx < 2; idx++) {
    const ex = cx + (idx === 0 ? -eyeSpace : eyeSpace)
    const ey = headY + 1 + s.contour.eyeOffsetY * 5
    if (opts.happySquint || opts.lidClose > 0.78) {
      fillSegment(cell, W, H, ex - 7.5, ey + (opts.happySquint ? 1.5 : 0), ex, ey + (opts.happySquint ? -2.2 : 1.2), 1.6, squintCol)
      fillSegment(cell, W, H, ex, ey + (opts.happySquint ? -2.2 : 1.2), ex + 7.5, ey + (opts.happySquint ? 1.5 : 0), 1.6, squintCol)
    } else {
      const iris = parseColor(idx === 1 ? s.rightEyeColorTop : s.eyeColorTop)
      fillEllipse(cell, W, H, ex, ey, eyeRx, eyeRy, iris)
      if (eyeRy > 2.5) {
        const prx = s.contour.pupilShape === 'slit' ? 2.1 : 3.8
        fillEllipse(cell, W, H, ex, ey, Math.min(eyeRx - 1.5, prx), Math.min(eyeRy - 1, 5.2), pupilCol)
        if (s.eyeCatchlight) fillEllipse(cell, W, H, ex - 2.2, ey - 2.2, 1.5, 1.5, [255, 255, 255, 235])
      }
    }
  }

  // Nose & blush
  if (s.noseColor && s.contour.noseShape !== 'none') {
    fillEllipse(cell, W, H, cx, headY + 9, 2.6 * s.contour.noseScale, 1.9 * s.contour.noseScale, parseColor(s.noseColor))
  }
  if (s.blushColor && (s.contour.blushAlways || opts.happySquint)) {
    const blush = parseColor(s.blushColor)
    const softBlush: Rgba = [blush[0], blush[1], blush[2], 105]
    fillEllipse(cell, W, H, cx - eyeSpace - 4, headY + 9, 5, 2.8, softBlush)
    fillEllipse(cell, W, H, cx + eyeSpace + 4, headY + 9, 5, 2.8, softBlush)
  }
}

function blitCell(sheet: Buffer, col: number, row: number, cell: Buffer): void {
  const dstX = col * PET_CELL_WIDTH
  const dstY = row * PET_CELL_HEIGHT
  for (let y = 0; y < PET_CELL_HEIGHT; y++) {
    const srcOff = y * PET_CELL_WIDTH * 4
    const dstOff = ((dstY + y) * PET_SHEET_WIDTH + dstX) * 4
    cell.copy(sheet, dstOff, srcOff, srcOff + PET_CELL_WIDTH * 4)
  }
}

/** Deterministic pure-Node 1536x1872 preview spritesheet for KuroCat skins/plugins. */
export function renderKurocatPreviewSheetPng(skin: KuroCatSkinConfig): Buffer {
  const resolved = resolveKuroCatSkin(skin)
  const sheet = Buffer.alloc(PET_SHEET_WIDTH * PET_SHEET_HEIGHT_V1 * 4)

  const makeCell = (opts: Parameters<typeof drawCellCat>[2]): Buffer => {
    const buf = Buffer.alloc(PET_CELL_WIDTH * PET_CELL_HEIGHT * 4)
    drawCellCat(buf, resolved, opts)
    return buf
  }

  const baseIdle = makeCell({ lidClose: 0, happySquint: false, bobY: 0, leanX: 0, waveSide: 0 })
  const halfLid = makeCell({ lidClose: 0.52, happySquint: false, bobY: 0, leanX: 0, waveSide: 0 })
  const closedHappy = makeCell({ lidClose: 1, happySquint: true, bobY: 0, leanX: 0, waveSide: 0 })
  const closedSleep = makeCell({ lidClose: 1, happySquint: false, bobY: 1, leanX: 0, waveSide: 0 })
  const waveA = makeCell({ lidClose: 0, happySquint: true, bobY: -1, leanX: 1, waveSide: 1 })
  const hopUp = makeCell({ lidClose: 0, happySquint: true, bobY: -8, leanX: 0, waveSide: 0 })
  const runLeft = makeCell({ lidClose: 0, happySquint: false, bobY: -2, leanX: -5, waveSide: 0 })
  const runRight = makeCell({ lidClose: 0, happySquint: false, bobY: -2, leanX: 5, waveSide: 0 })

  // Row 0: idle + blink + col 3 happy squint
  const row0 = [baseIdle, halfLid, closedSleep, closedHappy, halfLid, baseIdle]
  for (let c = 0; c < row0.length; c++) blitCell(sheet, c, 0, row0[c])

  const stateCells: Record<Exclude<PetAnimationState, 'idle'>, Buffer[]> = {
    'running-right': [runRight, baseIdle, runRight, baseIdle, runRight, baseIdle, runRight, baseIdle],
    'running-left': [runLeft, baseIdle, runLeft, baseIdle, runLeft, baseIdle, runLeft, baseIdle],
    waving: [baseIdle, waveA, closedHappy, waveA],
    jumping: [baseIdle, hopUp, hopUp, closedHappy, baseIdle],
    failed: [halfLid, closedSleep, halfLid, closedSleep, halfLid, baseIdle, halfLid, baseIdle],
    waiting: [baseIdle, baseIdle, halfLid, baseIdle, baseIdle, baseIdle],
    running: [runLeft, runRight, runLeft, runRight, runLeft, runRight],
    review: [baseIdle, waveA, baseIdle, closedHappy, baseIdle, baseIdle]
  }
  for (const [state, cells] of Object.entries(stateCells) as Array<[Exclude<PetAnimationState, 'idle'>, Buffer[]]>) {
    const row = PET_ROWS[state].row
    for (let c = 0; c < cells.length; c++) blitCell(sheet, c, row, cells[c])
  }

  return encodeRgbaPng(PET_SHEET_WIDTH, PET_SHEET_HEIGHT_V1, sheet)
}

export function kurocatDefaultInteractions(): PetInteractionPack {
  const base = defaultPetInteractions()
  return {
    ...base,
    joint: {
      version: 1,
      row: 0,
      blink: [0, 1, 2, 3, 4, 5],
      ground: 0.90,
      head: [0.49, 0.48],
      arms: [
        { shoulder: [0.35, 0.67], hand: [0.33, 0.87], radius: 0.085 },
        { shoulder: [0.63, 0.67], hand: [0.65, 0.87], radius: 0.085 }
      ],
      feet: [[0.38, 0.90], [0.60, 0.90]]
    },
    visits: { scenes: ['dance', 'cheer', 'beatbox', 'bubbles'], arrival: 'peek' }
  }
}
