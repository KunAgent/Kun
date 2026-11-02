import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { PET_SPRITESHEET_MAX_BYTES, type PetSpriteVersion, petSheetHeightForVersion, PET_SHEET_WIDTH } from '../../shared/pets'

export type DecodedPetImage = { format: 'png' | 'webp'; width: number; height: number }

export function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('rgba buffer does not match dimensions')
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4)
    raw[row] = 0
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4)
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

export function decodePetImage(bytes: Buffer): DecodedPetImage {
  if (bytes.length > PET_SPRITESHEET_MAX_BYTES) throw new Error('spritesheet exceeds 16 MiB')
  if (isPng(bytes)) return decodePng(bytes)
  if (isWebp(bytes)) return decodeWebp(bytes)
  throw new Error('spritesheet is not a decodable PNG or WebP')
}

export function assertSpritesheetDimensions(image: DecodedPetImage, version: PetSpriteVersion): void {
  const height = petSheetHeightForVersion(version)
  if (image.width !== PET_SHEET_WIDTH || image.height !== height) {
    throw new Error(`spritesheet must be ${PET_SHEET_WIDTH}x${height}, received ${image.width}x${image.height}`)
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function decodePng(bytes: Buffer): DecodedPetImage {
  if (bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) {
    throw new Error('invalid PNG signature')
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  let sawIend = false
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) throw new Error('truncated PNG chunk')
    const data = bytes.subarray(dataStart, dataEnd)
    const expected = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0
    if (bytes.readUInt32BE(dataEnd) !== expected) throw new Error('PNG checksum mismatch')
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('invalid PNG header')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('unsupported PNG encoding')
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      sawIend = true
      offset = dataEnd + 4
      break
    }
    offset = dataEnd + 4
  }
  if (!sawIend || width < 1 || height < 1) throw new Error('incomplete PNG')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error('unsupported PNG color type')
  const inflated = inflateSync(Buffer.concat(idat))
  const expected = height * (1 + width * channels)
  if (inflated.length !== expected) throw new Error('PNG pixel data does not match the header')
  return { format: 'png', width, height }
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

function decodeWebp(bytes: Buffer): DecodedPetImage {
  const declared = bytes.readUInt32LE(4)
  if (declared + 8 !== bytes.length) throw new Error('truncated WebP')
  let offset = 12
  let width = 0
  let height = 0
  let sawImage = false
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const padded = size + (size % 2)
    if (dataStart + size > bytes.length) throw new Error('truncated WebP chunk')
    const data = bytes.subarray(dataStart, dataStart + size)
    if (type === 'VP8 ') {
      if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
        throw new Error('undecodable VP8 WebP')
      }
      const raw = data.readUInt32LE(6)
      width = raw & 0x3fff
      height = (raw >> 16) & 0x3fff
      sawImage = width > 0 && height > 0
    } else if (type === 'VP8L') {
      if (data.length < 5 || data[0] !== 0x2f) throw new Error('undecodable VP8L WebP')
      const raw = data.readUInt32LE(1)
      width = (raw & 0x3fff) + 1
      height = ((raw >> 14) & 0x3fff) + 1
      sawImage = true
    } else if (type === 'VP8X') {
      if (data.length < 10) throw new Error('undecodable VP8X WebP')
      width = (data[4] | (data[5] << 8) | (data[6] << 16)) + 1
      height = (data[7] | (data[8] << 8) | (data[9] << 16)) + 1
    }
    offset = dataStart + padded
  }
  if (offset !== bytes.length || !sawImage) throw new Error('WebP image payload is incomplete')
  return { format: 'webp', width, height }
}
