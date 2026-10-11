import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { avatarRecipes } from './kun-avatar-asset-recipes.mjs'
import { polishRecipes } from './kun-avatar-polish-recipes.mjs'
import { accessoryIconRecipes } from './kun-avatar-accessory-icon-recipes.mjs'
import { wornRecipes } from './kun-avatar-worn-recipes.mjs'
import { v2Recipes } from './kun-avatar-v2-recipes.mjs'
import { v2PerspectiveRecipes } from './kun-avatar-v2-perspective-recipes.mjs'
import { v2OutlineRecipes } from './kun-avatar-v2-outline-recipes.mjs'
import { v2MaterialRecipes } from './kun-avatar-v2-material-recipes.mjs'
import { v2ClothingRecipes } from './kun-avatar-v2-clothing-recipes.mjs'
import { alignedHoodieRecipes, registerOutfits } from './kun-avatar-outfit-registration.mjs'
import { outfitBustRecipes } from './kun-avatar-outfit-bust-recipes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = resolve(root, 'src/asset/img/kun-avatar')
const manifest = { schemaVersion: 1, version: '5', canvas: 1024,
  anchors: { faceBox: [232, 300, 792, 860], compactFaceBox: [200, 236, 824, 860],
    eyeLineY: 584, beak: [512, 666] }, assetManifests: [] }
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

const recipes = new Map([...avatarRecipes, ...polishRecipes, ...accessoryIconRecipes, ...wornRecipes,
  ...v2Recipes, ...v2PerspectiveRecipes, ...v2OutlineRecipes, ...v2MaterialRecipes, ...v2ClothingRecipes]
  .map((recipe) => [recipe.key, recipe]))
registerOutfits(recipes, [...alignedHoodieRecipes, ...outfitBustRecipes])
// Inventory optical sizes are category-specific, independent of generated source resolution.
for (const recipe of recipes.values()) if (recipe.key.startsWith('icon/')) {
  const category = recipe.key.split('/')[1]
  const maximum = Math.round(512 * (category === 'glasses' ? 0.76 : category === 'prop' ? 0.80 : 0.84))
  const [, , width, height] = recipe.box, scale = maximum / Math.max(width, height)
  const w = Math.round(width * scale), h = Math.round(height * scale)
  recipe.box = [Math.round((512 - w) / 2), Math.round((512 - h) / 2), w, h]
}

async function registeredFragment(recipe) {
  const { source, grid = [1, 1], cell = 0, sourceCrop } = recipe
  let sprite = await extractSprite(source, ...grid, cell, sourceCrop, recipe.trim)
  if (recipe.simplify) sprite = await sharp(sprite).resize(recipe.simplify, recipe.simplify).png().toBuffer()
  if (recipe.registration) {
    const { left, top, width } = recipe.registration
    const canvas = recipe.canvas ?? 1024
    // One scale for both axes. Crop overflowing cloth; never fit the whole garment
    // into the short visible chest window or its seams and hardware get flattened.
    const resized = await sharp(sprite).resize({ width }).png().toBuffer()
    const metadata = await sharp(resized).metadata()
    const x = Math.max(0, -left), y = Math.max(0, -top)
    const visibleWidth = Math.min(metadata.width, canvas - left) - x
    const visibleHeight = Math.min(metadata.height, canvas - top) - y
    if (visibleWidth <= 0 || visibleHeight <= 0) throw new Error(`Outfit misses canvas: ${recipe.key}`)
    const input = await sharp(resized).extract({ left: x, top: y, width: visibleWidth, height: visibleHeight }).png().toBuffer()
    return { input, left: Math.max(0, left), top: Math.max(0, top) }
  }
  const [left, top, width, height] = recipe.box
  let input = await sharp(sprite).resize(width, height,
    { fit: recipe.fit ?? 'fill', background: '#00000000' }).png().toBuffer()
  if (recipe.opacity != null) {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let index = 3; index < data.length; index += 4) data[index] = Math.round(data[index] * recipe.opacity)
    input = await sharp(data, { raw: info }).png().toBuffer()
  }
  return { input, left, top }
}
for (const recipe of recipes.values()) {
  const { key, source, grid = [1, 1], cell = 0, sourceCrop } = recipe
  try { await readFile(resolve(directory, 'sources', source)) } catch (error) {
    if (process.argv.includes('--partial') && error.code === 'ENOENT') continue
    throw error
  }
  const fragments = await Promise.all((recipe.fragments ?? [recipe])
    .map((fragment) => registeredFragment({ ...recipe, ...fragment })))
  const png = `${key}.png`, webp = {}
  const canvas = recipe.canvas ?? 1024
  const composed = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
    .composite(fragments).png().toBuffer()
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
    source: { file: source, ...(recipe.registration && sourceCrop ? { crop: sourceCrop }
      : { grid, cell, ...(sourceCrop ? { crop: sourceCrop } : {}) }),
      ...(recipe.registration ? { registration: recipe.registration } : {}),
      ...(recipe.fragments ? { fragments: recipe.fragments } : {}),
      ...(recipe.opacity != null ? { opacity: recipe.opacity } : {}) } }
}
await mkdir(resolve(directory, 'manifests'), { recursive: true })
for (const [family, assets] of families) {
  const path = `manifests/${family}.json`
  await writeFile(resolve(directory, path), `${JSON.stringify(assets, null, 2)}\n`)
  manifest.assetManifests.push(path)
}
await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built ${recipes.size} registered avatar assets in ${families.size} families.`)
