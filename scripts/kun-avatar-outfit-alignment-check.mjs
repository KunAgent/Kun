import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { assetPath, visibleAlphaBounds } from './kun-avatar-art-validation.mjs'

const assetRoot = fileURLToPath(new URL('../src/asset/img/kun-avatar/', import.meta.url))
const transparentCanvas = (size) => sharp({ create: {
  width: size, height: size, channels: 4, background: '#00000000'
} })

/** Reconstruct registration independently from the exporter, including off-canvas clipping.
 * Only width is authored: height must follow the generated source's painted aspect ratio. */
export async function reconstructOutfitRegistration(source, registration, canvas = 1024) {
  if (!registration || !['left', 'top', 'width'].every((key) => Number.isInteger(registration[key])) ||
    registration.width <= 0 || registration.width > canvas * 2 ||
    Object.keys(registration).some((key) => !['left', 'top', 'width'].includes(key))) {
    throw new Error('Outfit registration requires integer left/top/width and no independent height')
  }
  const sourceBounds = await visibleAlphaBounds(source, 16)
  const [x0, y0, x1, y1] = sourceBounds
  const width = registration.width
  const sprite = await sharp(source).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize({ width }).png().toBuffer()
  // Supplying the rounded height too selects cover's larger scale for some odd
  // aspect ratios, cropping a fraction of a column. Width alone preserves scale.
  const { height } = await sharp(sprite).metadata()
  const { left, top } = registration
  const visibleLeft = Math.max(left, 0), visibleTop = Math.max(top, 0)
  const visibleRight = Math.min(left + width, canvas), visibleBottom = Math.min(top + height, canvas)
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) throw new Error('Outfit lies outside the avatar canvas')
  const clipped = await sharp(sprite).extract({ left: visibleLeft - left, top: visibleTop - top,
    width: visibleRight - visibleLeft, height: visibleBottom - visibleTop }).png().toBuffer()
  const image = await transparentCanvas(canvas).composite([{ input: clipped, left: visibleLeft, top: visibleTop }])
    .png().toBuffer()
  return { image, sourceBounds, scaledSize: [width, height],
    clippedSize: [visibleRight - visibleLeft, visibleBottom - visibleTop] }
}

/** Compare visible color as well as alpha: a solid silhouette can hide squeezed collar details. */
export async function outfitRasterDifference(expected, actual, { color = true } = {}) {
  const [reference, candidate] = await Promise.all([expected, actual].map((input) =>
    sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
  if (reference.info.width !== candidate.info.width || reference.info.height !== candidate.info.height) {
    throw new Error('Outfit raster dimensions do not match registered canvas')
  }
  let maxAlpha = 0, alphaTotal = 0, colorTotal = 0, visiblePixels = 0
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const expectedAlpha = reference.data[offset + 3], actualAlpha = candidate.data[offset + 3]
    const difference = Math.abs(expectedAlpha - actualAlpha)
    maxAlpha = Math.max(maxAlpha, difference)
    alphaTotal += difference
    if (Math.max(expectedAlpha, actualAlpha) < 16) continue
    visiblePixels++
    if (color) for (let channel = 0; channel < 3; channel++) {
      colorTotal += Math.abs(reference.data[offset + channel] * expectedAlpha / 255 -
        candidate.data[offset + channel] * actualAlpha / 255)
    }
  }
  return { maxAlpha, meanAlpha: alphaTotal / (reference.info.width * reference.info.height),
    meanColor: colorTotal / Math.max(1, visiblePixels * 3) }
}

export async function validateOutfitRaster(expected, actual, options) {
  const difference = await outfitRasterDifference(expected, actual, options)
  if (difference.maxAlpha > 2 || difference.meanAlpha > 0.02 || difference.meanColor > 0.25) {
    throw new Error(`Outfit raster differs from aspect-preserving registration: ${JSON.stringify(difference)}`)
  }
  return difference
}

async function sourceCell(source, root) {
  const input = await readFile(assetPath(resolve(root, 'sources'), source?.file))
  const { width, height } = await sharp(input).metadata()
  const [columns, rows] = source.grid ?? [1, 1], index = source.cell ?? 0
  const left = Math.floor(index % columns * width / columns)
  const top = Math.floor(Math.floor(index / columns) * height / rows)
  const right = Math.floor((index % columns + 1) * width / columns)
  const bottom = Math.floor((Math.floor(index / columns) + 1) * height / rows)
  return sharp(input).extract(source.crop ?? { left, top, width: right - left, height: bottom - top }).png().toBuffer()
}

/** The mouth remains readable even when a high collar reaches the lower cheek edges. */
export async function validateOutfitBeakClearance(input, beak = [512, 666]) {
  const [x, y] = beak
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const protectedBox = [x - 72, y - 44, x + 72, y + 76]
  let overlapPixels = 0
  for (let row = Math.max(0, protectedBox[1]); row < Math.min(info.height, protectedBox[3]); row++) {
    for (let column = Math.max(0, protectedBox[0]); column < Math.min(info.width, protectedBox[2]); column++) {
      if (data[(row * info.width + column) * 4 + 3] >= 16) overlapPixels++
    }
  }
  if (overlapPixels) throw new Error(`Outfit covers ${overlapPixels} pixels in the protected beak region`)
  return { protectedBox, overlapPixels }
}

export async function validateAvatarOutfitAlignment(manifest, outfits, root = assetRoot) {
  const result = []
  const layers = outfits.flatMap(({ id }) => {
    const key = `outfit/${id}`, back = `${key}.back`
    return [{ key, rear: false }, ...(manifest.assets[back]?.source?.registration ? [{ key: back, rear: true }] : [])]
  })
  for (const { key, rear } of layers) {
    const entry = manifest.assets[key]
    try {
      if (!entry?.source?.registration) throw new Error('Missing aspect-preserving outfit registration')
      const expected = await reconstructOutfitRegistration(await sourceCell(entry.source, root),
        entry.source.registration, manifest.canvas)
      const png = await validateOutfitRaster(expected.image, assetPath(root, entry.png))
      // Rear capes sit behind the opaque body and face; raw rear alpha may cross the mouth.
      const beak = rear ? null : await validateOutfitBeakClearance(assetPath(root, entry.png), manifest.anchors.beak)
      const tiers = []
      for (const size of [128, 256, 512]) {
        const scaled = await sharp(expected.image).resize(size, size).png().toBuffer()
        tiers.push({ size, ...await validateOutfitRaster(scaled, assetPath(root, entry.webp?.[size]), { color: false }) })
      }
      const { image: _image, ...geometry } = expected
      result.push({ key, rear, registration: entry.source.registration, ...geometry, beak, png, tiers })
    } catch (error) {
      throw new Error(`${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { garments: outfits.length, layers: result.length, backLayers: result.filter(({ rear }) => rear).length,
    registrations: result }
}

async function main() {
  const { loadAvatarCatalog, loadAvatarManifest } = await import('./kun-avatar-compose-check.mjs')
  const manifest = await loadAvatarManifest(), shared = await loadAvatarCatalog()
  const result = await validateAvatarOutfitAlignment(manifest, shared.KUN_AVATAR_CATALOG.outfit)
  console.log(`Outfit registration: ${result.garments} garments / ${result.layers} layers preserve source aspect ` +
    'at all export sizes; front layers leave the beak clear.')
}

// Finish module evaluation before importing the CLI that also imports this checker.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
