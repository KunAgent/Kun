'use strict'

const { crc32, deflateSync } = require('node:zlib')

/** A solid-color RGBA PNG; `paint(x, y)` may return [r, g, b, a] per pixel. */
function pngImage(width, height, paint) {
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4
      const [r, g, b, a] = paint(x, y)
      rows[offset] = r; rows[offset + 1] = g; rows[offset + 2] = b; rows[offset + 3] = a
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

/** Binary glTF for one textured mesh with a `kun_spin` clip: positions, normals and uvs as flat arrays. */
function meshGlb({ positions, normals, uvs, indices, texture, name }) {
  const times = [0, 1, 2], rotations = [0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 1, 0, 0]
  const parts = [new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint16Array(indices),
    texture, new Float32Array(times), new Float32Array(rotations)].map((part) => Buffer.from(part.buffer, part.byteOffset, part.byteLength))
  const views = [], chunks = []
  let offset = 0
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.length })
    const padded = Buffer.concat([part, Buffer.alloc((4 - part.length % 4) % 4)])
    chunks.push(padded)
    offset += padded.length
  }
  const axis = (index) => positions.filter((_, position) => position % 3 === index)
  const [xs, ys, zs] = [axis(0), axis(1), axis(2)]
  const count = positions.length / 3
  const json = {
    asset: { version: '2.0', generator: 'kun-3d-smoke' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: `${name}_main`, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: indices.length, type: 'SCALAR' },
      { bufferView: 5, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 6, componentType: 5126, count: 3, type: 'VEC4' }
    ],
    bufferViews: views,
    animations: [{ name: 'kun_spin', channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }], samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }] }],
    buffers: [{ byteLength: offset }]
  }
  const jsonBuffer = Buffer.from(JSON.stringify(json))
  const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc((4 - jsonBuffer.length % 4) % 4, 0x20)])
  const binChunk = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const chunkHeader = (length, type) => { const value = Buffer.alloc(8); value.writeUInt32LE(length, 0); value.writeUInt32LE(type, 4); return value }
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk])
}

const stripes = () => pngImage(16, 16, (x, y) => y < 12 ? (x % 4 < 2 ? [74, 124, 198, 255] : [92, 144, 214, 255]) : [232, 176, 74, 255])

/** A cap: smooth hemisphere crown on a flat brim, centered on the origin's vertical axis. Sizes in meters. */
function capGlb({ crown = 0.11, brim = 0.15, thickness = 0.012, lift = 0.68, segments = 32, rings = 12 } = {}) {
  const positions = [], normals = [], uvs = [], indices = []
  const ring = (radius, y, normalY, v) => {
    const start = positions.length / 3
    for (let step = 0; step <= segments; step += 1) {
      const angle = step / segments * Math.PI * 2
      positions.push(Math.cos(angle) * radius, y + lift, Math.sin(angle) * radius)
      normals.push(0, normalY, 0)
      uvs.push(step / segments, v)
    }
    return start
  }
  const join = (a, b) => { for (let step = 0; step < segments; step += 1) indices.push(a + step, b + step, a + step + 1, a + step + 1, b + step, b + step + 1) }
  // Crown: latitude rings from the brim up to the top, with smooth sphere normals.
  const crownStart = positions.length / 3
  for (let level = 0; level <= rings; level += 1) {
    const phi = level / rings * Math.PI / 2
    for (let step = 0; step <= segments; step += 1) {
      const angle = step / segments * Math.PI * 2
      const nx = Math.cos(angle) * Math.cos(phi), ny = Math.sin(phi), nz = Math.sin(angle) * Math.cos(phi)
      positions.push(nx * crown, thickness + ny * crown + lift, nz * crown)
      normals.push(nx, ny, nz)
      uvs.push(step / segments, 0.75 * (1 - level / rings))
    }
  }
  // Counter-clockwise seen from outside, so front faces match the outward normals.
  for (let level = 0; level < rings; level += 1) join(crownStart + level * (segments + 1), crownStart + (level + 1) * (segments + 1))
  // Brim: a flat ring on top and underneath.
  const topInner = ring(crown, thickness, 1, 0.9), topOuter = ring(brim, thickness, 1, 1)
  join(topOuter, topInner)
  const bottomInner = ring(crown, 0, -1, 0.9), bottomOuter = ring(brim, 0, -1, 1)
  join(bottomInner, bottomOuter)
  return meshGlb({ positions, normals, uvs, indices, texture: stripes(), name: 'pilot_cap' })
}

/** The cap's front view on the three-view template: its widest side spans 80% of the square. */
function capFrontDrawing({ size = 64, crown = 0.11, brim = 0.15, thickness = 0.012 } = {}) {
  const width = brim * 2, height = crown + thickness
  const scale = 0.8 * size / Math.max(width, height)
  const cx = size / 2, top = size / 2 - height * scale / 2, brimY = top + crown * scale
  return pngImage(size, size, (x, y) => {
    const px = x + 0.5, py = y + 0.5
    const inBrim = py >= brimY && py <= brimY + thickness * scale && Math.abs(px - cx) <= brim * scale
    const inCrown = py <= brimY && (px - cx) ** 2 + (py - brimY) ** 2 <= (crown * scale) ** 2
    return inBrim || inCrown ? [74, 124, 198, 255] : [255, 255, 255, 0]
  })
}

/** A plain box, for a second asset that appears while the showcase is open. */
function boxGlb({ width = 0.08, height = 0.3, depth = 0.08 } = {}) {
  const [hx, hz] = [width / 2, depth / 2]
  const faces = [[[0, 0, 1], [[-hx, 0, hz], [hx, 0, hz], [hx, height, hz], [-hx, height, hz]]], [[0, 0, -1], [[hx, 0, -hz], [-hx, 0, -hz], [-hx, height, -hz], [hx, height, -hz]]],
    [[1, 0, 0], [[hx, 0, hz], [hx, 0, -hz], [hx, height, -hz], [hx, height, hz]]], [[-1, 0, 0], [[-hx, 0, -hz], [-hx, 0, hz], [-hx, height, hz], [-hx, height, -hz]]],
    [[0, 1, 0], [[-hx, height, hz], [hx, height, hz], [hx, height, -hz], [-hx, height, -hz]]], [[0, -1, 0], [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]]]]
  const positions = [], normals = [], uvs = [], indices = []
  faces.forEach(([normal, corners], face) => {
    corners.forEach((corner) => { positions.push(...corner); normals.push(...normal) })
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0)
    indices.push(face * 4, face * 4 + 1, face * 4 + 2, face * 4, face * 4 + 2, face * 4 + 3)
  })
  return meshGlb({ positions, normals, uvs, indices, texture: stripes(), name: 'magnifier' })
}

module.exports = { boxGlb, capFrontDrawing, capGlb, pngImage }
