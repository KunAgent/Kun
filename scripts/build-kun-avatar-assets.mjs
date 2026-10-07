import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { avatarRecipes } from './kun-avatar-asset-recipes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(root, 'src/asset/img/kun-avatar')
const manifest = { schemaVersion: 1, version: '1', canvas: 1024,
  anchors: { faceBox: [232, 300, 792, 860], eyeLineY: 584, beak: [512, 666] }, assets: {} }

/** Crop a generated sheet cell to its visible ink, then register it to the common canvas.
 * This is spatial registration only: no synthetic drawing or difference matting. */
async function extractSprite(source, columns, rows, index, sourceCrop) {
  const input = await readFile(resolve(directory, 'sources', source))
  const metadata = await sharp(input).metadata()
  const left = Math.floor(index % columns * metadata.width / columns)
  const top = Math.floor(Math.floor(index / columns) * metadata.height / rows)
  const right = Math.floor((index % columns + 1) * metadata.width / columns)
  const bottom = Math.floor((Math.floor(index / columns) + 1) * metadata.height / rows)
  const cell = await sharp(input).extract(sourceCrop ?? { left, top, width: right - left, height: bottom - top })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = cell.info.width, y0 = cell.info.height, x1 = -1, y1 = -1
  for (let y = 0; y < cell.info.height; y++) for (let x = 0; x < cell.info.width; x++) {
    if (cell.data[(y * cell.info.width + x) * 4 + 3] < 16) continue
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  if (x1 < x0) throw new Error(`Empty generated cell: ${source} #${index}`)
  return sharp(cell.data, { raw: cell.info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer()
}

for (const recipe of avatarRecipes) {
  const { key, source, grid = [1, 1], cell = 0, box, sourceCrop } = recipe
  try { await readFile(resolve(directory, 'sources', source)) } catch (error) {
    if (process.argv.includes('--partial') && error.code === 'ENOENT') continue
    throw error
  }
  const sprite = await extractSprite(source, ...grid, cell, sourceCrop)
  const [left, top, width, height] = box
  const resized = await sharp(sprite).resize(width, height, { fit: 'fill' }).png().toBuffer()
  const png = `${key}.png`, webp = {}
  const composed = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
    .composite([{ input: resized, left, top }]).png().toBuffer()
  await mkdir(dirname(resolve(directory, png)), { recursive: true })
  await writeFile(resolve(directory, png), composed)
  for (const size of [128, 256, 512]) {
    const path = `${size}/${key}.webp`
    await mkdir(dirname(resolve(directory, path)), { recursive: true })
    await sharp(composed).resize(size, size).webp({ quality: 90, alphaQuality: 100 }).toFile(resolve(directory, path))
    webp[size] = path
  }
  manifest.assets[key] = { png, webp }
}
await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built ${Object.keys(manifest.assets).length} registered avatar layers.`)
