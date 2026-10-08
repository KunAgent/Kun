import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { avatarRecipes } from './kun-avatar-asset-recipes.mjs'
import { polishRecipes } from './kun-avatar-polish-recipes.mjs'
import { accessoryIconRecipes } from './kun-avatar-accessory-icon-recipes.mjs'
import { wornRecipes } from './kun-avatar-worn-recipes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(root, 'src/asset/img/kun-avatar')
const manifest = { schemaVersion: 1, version: '2', canvas: 1024,
  anchors: { faceBox: [232, 300, 792, 860], eyeLineY: 584, beak: [512, 666] }, assetManifests: [] }
const families = new Map()

/** Crop a generated sheet cell to its visible ink, then register it to the common canvas.
 * This is spatial registration only: no synthetic drawing or difference matting. */
async function extractSprite(source, columns, rows, index, sourceCrop, trim = true) {
  const input = await readFile(resolve(directory, 'sources', source))
  const metadata = await sharp(input).metadata()
  const left = Math.floor(index % columns * metadata.width / columns)
  const top = Math.floor(Math.floor(index / columns) * metadata.height / rows)
  const right = Math.floor((index % columns + 1) * metadata.width / columns)
  const bottom = Math.floor((Math.floor(index / columns) + 1) * metadata.height / rows)
  const cell = await sharp(input).extract(sourceCrop ?? { left, top, width: right - left, height: bottom - top })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (!trim) return sharp(cell.data, { raw: cell.info }).png().toBuffer()
  let x0 = cell.info.width, y0 = cell.info.height, x1 = -1, y1 = -1
  for (let y = 0; y < cell.info.height; y++) for (let x = 0; x < cell.info.width; x++) {
    if (cell.data[(y * cell.info.width + x) * 4 + 3] < 16) continue
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  if (x1 < x0) throw new Error(`Empty generated cell: ${source} #${index}`)
  return sharp(cell.data, { raw: cell.info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer()
}

const recipes = new Map([...avatarRecipes, ...polishRecipes, ...accessoryIconRecipes, ...wornRecipes]
  .map((recipe) => [recipe.key, recipe]))
for (const recipe of recipes.values()) {
  const { key, source, grid = [1, 1], cell = 0, box, sourceCrop } = recipe
  try { await readFile(resolve(directory, 'sources', source)) } catch (error) {
    if (process.argv.includes('--partial') && error.code === 'ENOENT') continue
    throw error
  }
  let sprite = await extractSprite(source, ...grid, cell, sourceCrop, recipe.trim)
  // Low-resolution color fields are an export of the painted scene, not synthetic scenery.
  if (recipe.simplify) sprite = await sharp(sprite).resize(recipe.simplify, recipe.simplify).png().toBuffer()
  const [left, top, width, height] = box
  const resized = await sharp(sprite).resize(width, height,
    { fit: recipe.fit ?? 'fill', background: '#00000000' }).png().toBuffer()
  const png = `${key}.png`, webp = {}
  const canvas = recipe.canvas ?? 1024
  const composed = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
    .composite([{ input: resized, left, top }]).png().toBuffer()
  await mkdir(dirname(resolve(directory, png)), { recursive: true })
  await writeFile(resolve(directory, png), composed)
  for (const size of recipe.tiers ?? [128, 256, 512]) {
    const path = `${size}/${key}.webp`
    await mkdir(dirname(resolve(directory, path)), { recursive: true })
    await sharp(composed).resize(size, size).webp({ quality: recipe.quality ?? 90, alphaQuality: 100 }).toFile(resolve(directory, path))
    webp[size] = path
  }
  const family = key.startsWith('icon/') ? key.split('/').slice(0, 2).join('-') : key.split('/')[0]
  if (!families.has(family)) families.set(family, {})
  families.get(family)[key] = { png, webp, canvas,
    source: { file: source, grid, cell, ...(sourceCrop ? { crop: sourceCrop } : {}) } }
}
await mkdir(resolve(directory, 'manifests'), { recursive: true })
for (const [family, assets] of families) {
  const path = `manifests/${family}.json`
  await writeFile(resolve(directory, path), `${JSON.stringify(assets, null, 2)}\n`)
  manifest.assetManifests.push(path)
}
await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built ${recipes.size} registered avatar assets in ${families.size} families.`)
