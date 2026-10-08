import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import sharp from 'sharp'

export const AVATAR_WEBP_BASELINE_BYTES = 2065734
export const AVATAR_WEBP_ADDED_BUDGET_BYTES = 2.5 * 1048576
export const AVATAR_SCENES = ['sunset-bay', 'night-study', 'star-deck', 'cafe', 'laboratory', 'forest-cabin']
export const AVATAR_SMALL_HEADWEAR = ['wizard-hat', 'beanie', 'headphones', 'hard-hat']

export function assetPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid avatar asset path: ${String(path)}`)
  }
  const target = resolve(root, path)
  if (relative(root, target).startsWith(`..${sep}`)) throw new Error(`Avatar asset escapes its directory: ${path}`)
  return target
}

export function avatarAssetSpec(key) {
  if (key.startsWith('icon/')) return { canvas: 512, tiers: [128, 256], transparent: true }
  if (key.startsWith('container/')) return { canvas: 512, tiers: [96, 256, 512], transparent: true }
  if (key.startsWith('card/')) return { canvas: 512, tiers: [128, 256, 512], transparent: false }
  return { canvas: 1024, tiers: [128, 256, 512], transparent: !key.startsWith('scene/') }
}

export function requiredAvatarAssets(catalog) {
  const keys = []
  for (const { id } of catalog.color) keys.push(`base/${id}`, `crest/${id}`, `crest/tucked-${id}`, `wing/${id}`)
  for (const { id } of catalog.face) keys.push(`face/${id}`)
  for (const category of ['headwear', 'glasses', 'outfit', 'prop']) {
    for (const part of catalog[category]) {
      keys.push(`${category}/${part.id}`, `icon/${category}/${part.id}`)
      if (part.hasBack) keys.push(`${category}/${part.id}.back`)
      if (category === 'glasses' || category === 'headwear' && AVATAR_SMALL_HEADWEAR.includes(part.id)) {
        keys.push(`${category}/${part.id}.small`)
      }
    }
  }
  for (const id of AVATAR_SCENES) keys.push(`scene/${id}`, `scene/${id}.small`)
  keys.push('fx/epic', 'fx/legendary', 'card/back')
  for (const state of ['sealed', 'glowing', 'open', 'glow']) keys.push(`container/bottle-${state}`)
  return keys
}

export async function visibleAlphaBounds(file, threshold = 16) {
  const { data, info } = await sharp(file).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] < threshold) continue
    left = Math.min(left, x); top = Math.min(top, y)
    right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error(`No visible pixels at alpha >= ${threshold}: ${file}`)
  return [left, top, right + 1, bottom + 1]
}

/** A pale semitransparent fringe must touch empty background, not an interior glass highlight. */
export async function detectAvatarEdgeHalo(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let edgePixels = 0, palePixels = 0
  const alpha = (x, y) => x < 0 || y < 0 || x >= info.width || y >= info.height
    ? 0 : data[(y * info.width + x) * 4 + 3]
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 4, a = data[offset + 3]
    if (a < 16 || a >= 240) continue
    if (![[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]]
      .some(([dx, dy]) => alpha(x + dx, y + dy) < 16)) continue
    edgePixels++
    const [red, green, blue] = data.subarray(offset, offset + 3)
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
    if (luminance > 0.85 && Math.max(red, green, blue) - Math.min(red, green, blue) < 40) palePixels++
  }
  // Small highlights are legitimate. A continuous pale contour is not.
  const thresholdPixels = Math.max(24, Math.round((info.width + info.height) / 4))
  const ratio = edgePixels ? palePixels / edgePixels : 0
  return { palePixels, edgePixels, ratio, thresholdPixels, failed: palePixels > thresholdPixels && ratio > 0.15 }
}

export async function validateAvatarIconMargins(file) {
  const metadata = await sharp(file).metadata()
  const bounds = await visibleAlphaBounds(file)
  const margins = [bounds[0] / metadata.width, bounds[1] / metadata.height,
    (metadata.width - bounds[2]) / metadata.width, (metadata.height - bounds[3]) / metadata.height]
  const horizontalCenter = (bounds[0] + bounds[2]) / (2 * metadata.width)
  const verticalCenter = (bounds[1] + bounds[3]) / (2 * metadata.height)
  // Eight percent is the target on the limiting axis; slender objects retain their natural aspect.
  if (Math.min(...margins) < 0.045 || Math.min(...margins) > 0.16 ||
    Math.abs(horizontalCenter - 0.5) > 0.06 || Math.abs(verticalCenter - 0.5) > 0.06) {
    throw new Error(`Icon must be centered with approximately 8% margin: ${JSON.stringify(margins)}`)
  }
  return { bounds, margins }
}

export function validateAvatarBudget(webpBytes) {
  const maximumBytes = AVATAR_WEBP_BASELINE_BYTES + AVATAR_WEBP_ADDED_BUDGET_BYTES
  if (webpBytes > maximumBytes) throw new Error(`Avatar WebP budget exceeded: ${webpBytes} > ${maximumBytes} bytes`)
  return { baselineBytes: AVATAR_WEBP_BASELINE_BYTES, addedBudgetBytes: AVATAR_WEBP_ADDED_BUDGET_BYTES,
    addedBytes: webpBytes - AVATAR_WEBP_BASELINE_BYTES, maximumBytes }
}

export async function validateAvatarProvenance(manifest, root) {
  const records = JSON.parse(await readFile(resolve(root, 'sources/generation-records.json'), 'utf8'))
  if (!Array.isArray(records.sources) || !records.sources.length) throw new Error('Generation source records are required')
  const sources = new Map()
  for (const source of records.sources) {
    assetPath(resolve(root, 'sources'), source?.file)
    if (sources.has(source.file)) throw new Error(`Duplicate generation source filename: ${source.file}`)
    sources.set(source.file, source)
  }
  const verified = new Set()
  for (const [key, entry] of Object.entries(manifest.assets)) {
    if (!entry.source?.file) throw new Error(`${key}: missing source provenance`)
    const source = sources.get(entry.source.file)
    if (!source) throw new Error(`${key}: source missing from generation records: ${entry.source.file}`)
    const file = assetPath(resolve(root, 'sources'), source.file)
    if (!verified.has(source.file)) {
      const [pixels, metadata] = await Promise.all([readFile(file), sharp(file).metadata()])
      if (createHash('sha256').update(pixels).digest('hex') !== source.sha256) {
        throw new Error(`${source.file}: generation source SHA256 mismatch`)
      }
      if (source.width !== metadata.width || source.height !== metadata.height) {
        throw new Error(`${source.file}: generation source dimensions mismatch`)
      }
      if (![source.promptSummary, source.prompt].some((value) => typeof value === 'string' && value.trim())) {
        throw new Error(`${source.file}: generation prompt or summary missing`)
      }
      verified.add(source.file)
    }
    if (entry.source.cell != null && (!Number.isInteger(entry.source.cell) || entry.source.cell < 0)) {
      throw new Error(`${key}: invalid source cell`)
    }
  }
  return { verifiedSources: [...verified] }
}
