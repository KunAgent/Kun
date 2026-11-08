import type { KeyboardKey, PetKeyboardSurface } from './keyboard-surface'

/** Small cream keycaps and a blue case keep the keyboard in Xiao Kun's palette. */
export function drawXiaoKunKeyboard(ctx: CanvasRenderingContext2D, keyboard: PetKeyboardSurface): void {
  const { x, y, width: w, height: h } = keyboard, unit = w / 110
  const depth = keyboard.caseDepth ?? 7, padding = 6 * unit, gap = 1.6 * unit
  const keyW = (w - padding * 2 - gap * 9) / 10, keyH = h * .14
  const capW = keyW + gap, capH = Math.max(4, h * .16)
  const columnAt = (key: KeyboardKey): number => Math.max(0, Math.min(9, Math.round((key.x - x - padding - keyW / 2) / (keyW + gap))))
  const activeColumns = [columnAt(keyboard.left), columnAt(keyboard.right)]
  const middleY = (keyboard.left.y + keyboard.right.y) / 2
  ctx.save(); ctx.globalAlpha *= keyboard.opacity
  ctx.fillStyle = '#c4dce5'; ctx.strokeStyle = '#7496a7'; ctx.lineWidth = 1.05 * unit
  ctx.beginPath(); ctx.roundRect(x - 3 * unit, y - 2 * unit, w + 6 * unit, h + depth + 2 * unit, 6 * unit)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#f0f6f5'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4 * unit); ctx.fill()
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .8 * unit
  ctx.beginPath(); ctx.moveTo(x + 5 * unit, y + unit); ctx.lineTo(x + w - 5 * unit, y + unit); ctx.stroke()
  for (let row = 0; row < 3; row++) for (let column = 0; column < 10; column++) {
    const px = x + padding + column * (keyW + gap)
    const py = row === 0 ? Math.max(y + unit, middleY - capH / 2 - gap - keyH)
      : row === 1 ? middleY - capH / 2 : middleY + capH / 2 + gap
    if (row !== 1 || !activeColumns.includes(column)) keycap(ctx, px, py, keyW, row === 1 ? capH : keyH, unit, row === 0 && column === 0 ? '#cce5ed' : '#fffcf3')
  }
  keycap(ctx, x + w * .27, y + h - keyH - 3 * unit, w * .46, keyH, unit, '#e1eff0')
  // A tiny gold curl echoes the crest, without competing with the original face.
  ctx.strokeStyle = '#d8bd79'; ctx.lineWidth = 1.1 * unit; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(x + w - 10 * unit, y + h - 5 * unit, 2.3 * unit, -.2, Math.PI * 1.7); ctx.stroke()
  for (const key of [keyboard.left, keyboard.right]) {
    const down = key.down * (key.depth ?? 1.3), top = key.y - capH / 2 + down
    const center = x + padding + columnAt(key) * (keyW + gap) + keyW / 2
    keycap(ctx, center - capW / 2, top, capW, capH, unit, '#fffcf3')
    ctx.save(); ctx.globalAlpha *= key.glow * .6; ctx.fillStyle = '#83c6e2'
    ctx.beginPath(); ctx.roundRect(center - capW / 2, top, capW, capH, 1.3 * unit); ctx.fill(); ctx.restore()
    impact(ctx, key, capW, unit)
  }
  ctx.restore()
}

function keycap(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, unit: number, fill: string): void {
  ctx.fillStyle = '#bdd1d8'; ctx.beginPath(); ctx.roundRect(x, y + unit, width, height, 1.3 * unit); ctx.fill()
  ctx.fillStyle = fill; ctx.strokeStyle = '#b4c9d0'; ctx.lineWidth = .55 * unit
  ctx.beginPath(); ctx.roundRect(x, y, width, height, 1.3 * unit); ctx.fill(); ctx.stroke()
}

function impact(ctx: CanvasRenderingContext2D, key: KeyboardKey, width: number, unit: number): void {
  if (!key.impact) return
  const travel = (1 - key.glow) * 4 * unit
  ctx.save(); ctx.globalAlpha *= key.impact * .8
  ctx.strokeStyle = '#79b8d3'; ctx.lineWidth = unit; ctx.lineCap = 'round'
  for (const direction of [-1, 1]) {
    const x = key.x + direction * (width * .7 + travel), y = key.y - 3 * unit - travel
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + direction * 1.8 * unit, y - 2.2 * unit); ctx.stroke()
  }
  ctx.restore()
}
