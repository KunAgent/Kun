import { nativeImage } from 'electron'

/** A stable launcher tile, including for two apps with identical display names. */
export function widgetAppIcon(id: string) {
  const hash = Buffer.from(id.slice(-32), 'hex')
  const size = 256
  const pixels = Buffer.alloc(size * size * 4)
  const color = [hash[0]! % 100 + 70, hash[1]! % 100 + 55, hash[2]! % 110 + 60]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      const dx = Math.max(0, 48 - x, x - (size - 49))
      const dy = Math.max(0, 48 - y, y - (size - 49))
      if (dx * dx + dy * dy > 48 * 48) continue
      const row = Math.floor((y - 55) / 29)
      const col = Math.floor((x - 55) / 29)
      const dot = row >= 0 && row < 5 && col >= 0 && col < 5 &&
        ((hash[3 + row]! >> Math.min(col, 4 - col)) & 1) !== 0
      for (let c = 0; c < 3; c++) pixels[offset + c] = dot ? 248 : color[c]!
      pixels[offset + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size })
}

export function launcherIconBytes(png: Buffer, platform: NodeJS.Platform): Buffer {
  if (platform === 'darwin') {
    const header = Buffer.alloc(16)
    header.write('icns', 0)
    header.writeUInt32BE(png.length + 16, 4)
    header.write('ic08', 8)
    header.writeUInt32BE(png.length + 8, 12)
    return Buffer.concat([header, png])
  }
  if (platform === 'win32') {
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header.writeUInt16LE(1, 10)
    header.writeUInt16LE(32, 12)
    header.writeUInt32LE(png.length, 14)
    header.writeUInt32LE(header.length, 18)
    return Buffer.concat([header, png])
  }
  return png
}
