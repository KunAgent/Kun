export type KeyboardKey = { x: number; y: number; down: number; glow: number; depth?: number }
export type PetKeyboardSurface = {
  x: number; y: number; width: number; height: number; opacity: number; accent: string
  left: KeyboardKey; right: KeyboardKey
}

export function drawPetKeyboard(ctx: CanvasRenderingContext2D, keyboard: PetKeyboardSurface): void {
  const { x, y, width: w, height: h, accent } = keyboard
  ctx.save(); ctx.globalAlpha *= keyboard.opacity
  // A low desk edge hides the feet and gives the paws a surface to actually press.
  ctx.fillStyle = '#ede8dd'; ctx.strokeStyle = '#9c9486'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(x - 5, y - 2); ctx.lineTo(x + w + 5, y - 2)
  ctx.lineTo(x + w + 9, y + h + 10); ctx.quadraticCurveTo(x + w + 9, y + h + 14, x + w + 4, y + h + 14)
  ctx.lineTo(x - 4, y + h + 14); ctx.quadraticCurveTo(x - 9, y + h + 14, x - 9, y + h + 9); ctx.closePath(); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#bdb6a9'; ctx.beginPath(); ctx.roundRect(x, y + 3, w, h + 3, 5); ctx.fill()
  ctx.fillStyle = '#faf8f1'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke()
  const gap = 1.7, columns = 12, keyWidth = (w - 12 - gap * (columns - 1)) / columns
  const keyHeight = (h - 10 - gap * 3) / 4
  for (let row = 0; row < 3; row++) for (let column = 0; column < columns; column++) {
    const px = x + 6 + column * (keyWidth + gap), py = y + 4 + row * (keyHeight + gap)
    ctx.fillStyle = row === 0 && (column === 0 || column === columns - 1) ? '#e3e1d6' : '#edece4'
    ctx.strokeStyle = '#c4c0b5'; ctx.lineWidth = .55
    ctx.beginPath(); ctx.roundRect(px, py, keyWidth, keyHeight, 1.1); ctx.fill(); ctx.stroke()
  }
  ctx.fillStyle = '#e4e2d7'; ctx.strokeStyle = '#bcb8ad'
  ctx.beginPath(); ctx.roundRect(x + w * .27, y + h - keyHeight - 4, w * .46, keyHeight, 1.4); ctx.fill(); ctx.stroke()
  // The accent is decorative; no key letter or typed character is displayed.
  ctx.fillStyle = accent; ctx.globalAlpha *= .65
  ctx.beginPath(); ctx.roundRect(x + w - 19, y + h - 7, 10, 2, 1); ctx.fill()
  ctx.restore()
  for (const key of [keyboard.left, keyboard.right]) {
    ctx.save(); ctx.globalAlpha *= keyboard.opacity
    const capW = Math.max(9, w * .075), capH = Math.max(6, h * .20), offset = key.down * (key.depth ?? 1.8)
    ctx.fillStyle = '#aaa596'; ctx.strokeStyle = '#aaa493'; ctx.lineWidth = .8
    ctx.beginPath(); ctx.roundRect(key.x - capW / 2, key.y - capH / 2 + 2, capW, capH, 1.8); ctx.fill()
    ctx.fillStyle = '#f6f4e9'; ctx.beginPath(); ctx.roundRect(key.x - capW / 2, key.y - capH / 2 + offset, capW, capH, 1.8); ctx.fill(); ctx.stroke()
    if (key.glow > 0) {
      ctx.globalAlpha *= key.glow * .65; ctx.fillStyle = accent
      ctx.beginPath(); ctx.roundRect(key.x - capW / 2, key.y - capH / 2 + offset, capW, capH, 1.8); ctx.fill()
    }
    ctx.restore()
  }
}
