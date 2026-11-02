import { mkdir, writeFile } from 'node:fs/promises'
import { crc32, deflateSync } from 'node:zlib'
import path from 'node:path'

const width = 1536
const height = 1872
const cellW = 192
const cellH = 208
const rgba = Buffer.alloc(width * height * 4)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const column = Math.floor(x / cellW)
    const row = Math.floor(y / cellH)
    const localX = x % cellW
    const localY = y % cellH
    const bob = row === 0 ? column * 2 : 0
    const centerX = 96
    const centerY = 112 + bob
    const dx = localX - centerX
    const dy = localY - centerY
    const inBody = dx * dx / 46 + dy * dy / 58 < 70
    const eye = Math.hypot(localX - (78 + (column % 3)), localY - 96) < 6 || Math.hypot(localX - 114, localY - 96) < 6
    const offset = (y * width + x) * 4
    if (eye) {
      rgba[offset + 3] = 255
    } else if (inBody) {
      rgba[offset] = 255
      rgba[offset + 1] = 176
      rgba[offset + 2] = 92
      rgba[offset + 3] = 255
    }
  }
}
const raw = Buffer.alloc(height * (1 + width * 4))
for (let y = 0; y < height; y += 1) {
  raw[y * (1 + width * 4)] = 0
  rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header(width, height)),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
const dir = path.resolve('resources/pets/kun-dot')
await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'spritesheet.png'), png)
await writeFile(path.join(dir, 'pet.json'), `${JSON.stringify({
  id: 'kun-dot',
  displayName: 'Kun Dot',
  description: 'A small original desktop companion that ships with Kun.',
  spritesheetPath: 'spritesheet.png',
  spriteVersionNumber: 1
}, null, 2)}\n`)

function header(imageWidth, imageHeight) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(imageWidth, 0)
  data.writeUInt32BE(imageHeight, 4)
  data[8] = 8
  data[9] = 6
  return data
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 0)
  return Buffer.concat([length, typeBytes, data, crc])
}
