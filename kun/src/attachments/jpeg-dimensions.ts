/** Read SOF dimensions without decoding pixels or allocating an image-sized buffer. */
export function jpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined
  let offset = 2
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset < data.length) {
    if (data[offset++] !== 0xff) return undefined
    while (offset < data.length && data[offset] === 0xff) offset++
    if (offset >= data.length) return undefined
    const marker = data[offset++]!
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return undefined
    if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > data.length) return undefined
    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.length) return undefined
    if (frames.has(marker)) {
      if (length < 7) return undefined
      const height = data.readUInt16BE(offset + 3), width = data.readUInt16BE(offset + 5)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    offset += length
  }
  return undefined
}
