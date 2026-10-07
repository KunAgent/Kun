#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultAssetRoot = resolve(projectRoot, 'src/asset/img/kun-avatar')
const tiers = [128, 256, 512]

/** Load the same pure-data catalog as the application without requiring a Kun build. */
export async function loadAvatarCatalog(root = projectRoot) {
  const contracts = resolve(root, 'kun/src/contracts')
  const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText).toString('base64')
  const catalogUrl = moduleUrl(await readFile(resolve(contracts, 'kun-avatar-catalog.ts'), 'utf8'))
  const presetSource = (await readFile(resolve(contracts, 'kun-avatar-presets.ts'), 'utf8'))
    .replace("'./kun-avatar-catalog.js'", JSON.stringify(catalogUrl))
  return { ...await import(catalogUrl), ...await import(moduleUrl(presetSource)) }
}

export function requiredAvatarAssets(catalog) {
  const keys = []
  for (const { id } of catalog.color) keys.push(`base/${id}`, `crest/${id}`, `crest/tucked-${id}`, `wing/${id}`)
  for (const { id } of catalog.face) keys.push(`face/${id}`)
  for (const category of ['headwear', 'glasses', 'outfit', 'prop']) {
    for (const part of catalog[category]) {
      keys.push(`${category}/${part.id}`)
      if (part.hasBack) keys.push(`${category}/${part.id}.back`)
    }
  }
  return keys
}

function assetPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid avatar asset path: ${String(path)}`)
  }
  const target = resolve(root, path)
  if (relative(root, target).startsWith(`..${sep}`)) throw new Error(`Avatar asset escapes its directory: ${path}`)
  return target
}

async function visibleAlphaBounds(file, threshold) {
  const { data, info } = await sharp(file).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] < threshold) continue
    left = Math.min(left, x); top = Math.min(top, y)
    right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error(`No visible pixels at alpha >= ${threshold}: ${file}`)
  return [left, top, right + 1, bottom + 1]
}

/** Compare exported registration bounds, not internal contours or anatomical landmarks. */
export async function validateAvatarColorAlignment(manifest, colors, root = defaultAssetRoot) {
  const alphaThreshold = 16, tolerancePixels = 2
  const groups = []
  let maxDisplacementPixels = 0
  for (const prefix of ['base/', 'crest/', 'crest/tucked-', 'wing/']) {
    const referenceKey = `${prefix}sky`
    const referenceBounds = await visibleAlphaBounds(assetPath(root, manifest.assets[referenceKey]?.png), alphaThreshold)
    const variants = []
    for (const { id } of colors) {
      const key = `${prefix}${id}`
      const bounds = id === 'sky' ? referenceBounds
        : await visibleAlphaBounds(assetPath(root, manifest.assets[key]?.png), alphaThreshold)
      const displacementPixels = Math.max(...bounds.map((coordinate, index) => Math.abs(coordinate - referenceBounds[index])))
      maxDisplacementPixels = Math.max(maxDisplacementPixels, displacementPixels)
      if (displacementPixels > tolerancePixels) {
        throw new Error(`${key}: alpha bounds ${JSON.stringify(bounds)} differ from ${referenceKey} ` +
          `${JSON.stringify(referenceBounds)} by ${displacementPixels}px (maximum ${tolerancePixels}px)`)
      }
      variants.push({ key, bounds, displacementPixels })
    }
    groups.push({ referenceKey, referenceBounds, variants })
  }
  return { alphaThreshold, tolerancePixels, maxDisplacementPixels, groups }
}

export async function validateAvatarManifest(manifest, shared, root = defaultAssetRoot) {
  const errors = []
  const assert = (condition, message) => { if (!condition) errors.push(message) }
  assert(manifest.schemaVersion === 1, 'manifest.schemaVersion must be 1')
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'manifest.version must be nonempty')
  assert(manifest.canvas === 1024, 'manifest.canvas must be 1024')
  const box = manifest.anchors?.faceBox
  assert(Array.isArray(box) && box.length === 4 && box.every(Number.isInteger) &&
    box[0] >= 0 && box[1] >= 0 && box[2] <= 1024 && box[3] <= 1024 && box[2] > box[0] && box[3] > box[1],
  'manifest.anchors.faceBox must be a nonempty pixel box inside the 1024 canvas')
  assert(Number.isFinite(manifest.anchors?.eyeLineY), 'manifest.anchors.eyeLineY is required')
  assert(Array.isArray(manifest.anchors?.beak) && manifest.anchors.beak.length === 2 &&
    manifest.anchors.beak.every(Number.isFinite), 'manifest.anchors.beak is required')
  const required = requiredAvatarAssets(shared.KUN_AVATAR_CATALOG)
  const assets = manifest.assets ?? {}
  for (const key of required) assert(Object.hasOwn(assets, key), `Missing catalog asset: ${key}`)
  for (const key of Object.keys(assets)) assert(required.includes(key), `Unknown catalog asset: ${key}`)
  if (manifest.parts) {
    for (const category of shared.KUN_AVATAR_ACCESSORY_CATEGORIES) {
      for (const part of shared.KUN_AVATAR_CATALOG[category]) {
        const entry = manifest.parts.find((item) => item.id === part.id && (item.category ?? item.layer) === category)
        assert(Boolean(entry), `Missing manifest metadata: ${category}/${part.id}`)
        if (!entry) continue
        for (const field of ['hasBack', 'hidesCrest', 'crest']) {
          assert(entry[field] === part[field], `Manifest/catalog mismatch: ${category}/${part.id}.${field}`)
        }
        assert(JSON.stringify(entry.excludes) === JSON.stringify(part.excludes),
          `Manifest/catalog mismatch: ${category}/${part.id}.excludes`)
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  let pngBytes = 0, webpBytes = 0
  const files = []
  const seen = new Set()
  for (const key of required) {
    const entry = assets[key]
    for (const size of [1024, ...tiers]) {
      const path = size === 1024 ? entry.png : entry.webp?.[size]
      try {
        const file = assetPath(root, path)
        assert(!seen.has(path), `Layers share a file unexpectedly: ${path}`)
        seen.add(path)
        const [metadata, statistics, info] = await Promise.all([sharp(file).metadata(), sharp(file).stats(), stat(file)])
        assert(metadata.width === size && metadata.height === size, `${path}: expected ${size}x${size}`)
        assert(metadata.format === (size === 1024 ? 'png' : 'webp'), `${path}: incorrect encoded format`)
        assert(metadata.hasAlpha && metadata.channels === 4, `${path}: expected RGBA`)
        const alpha = metadata.hasAlpha ? statistics.channels.at(-1) : undefined
        assert(alpha && alpha.min === 0 && alpha.max > 0, `${path}: requires both transparent and visible pixels`)
        if (size === 1024) pngBytes += info.size
        else webpBytes += info.size
        files.push({ key, path, size, bytes: info.size })
      } catch (error) {
        errors.push(`${key} (${size}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  let legalPairs = 0, excludedPairs = 0
  for (const [index, category] of shared.KUN_AVATAR_ACCESSORY_CATEGORIES.entries()) {
    for (const other of shared.KUN_AVATAR_ACCESSORY_CATEGORIES.slice(index + 1)) {
      for (const part of shared.KUN_AVATAR_CATALOG[category]) {
        for (const otherPart of shared.KUN_AVATAR_CATALOG[other]) {
          const parts = shared.normalizeKunAvatarParts({ [category]: part.id, [other]: otherPart.id })
          if (shared.getKunAvatarConflicts(parts).length) { excludedPairs++; continue }
          legalPairs++
          for (const { id: color } of shared.KUN_AVATAR_CATALOG.color) {
            for (const key of shared.kunAvatarLayerKeys({ ...parts, color })) {
              assert(Object.hasOwn(assets, key), `Legal pair references missing layer: ${key}`)
            }
          }
        }
      }
    }
  }
  assert(JSON.stringify(shared.KUN_AVATAR_PRESETS.map((preset) => preset.id)) ===
    JSON.stringify(shared.ROOM_BUILTIN_AVATAR_IDS), 'Preset IDs/order differ from builtin IDs')
  for (const preset of shared.KUN_AVATAR_PRESETS) {
    assert(shared.getKunAvatarConflicts(preset.parts).length === 0, `Invalid preset combination: ${preset.id}`)
    for (const key of shared.kunAvatarLayerKeys(preset.parts)) assert(Object.hasOwn(assets, key), `Preset layer missing: ${key}`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  const alignment = await validateAvatarColorAlignment(manifest, shared.KUN_AVATAR_CATALOG.color, root)
  return { layers: required.length, fileCount: files.length, pngBytes, webpBytes, legalPairs, excludedPairs, alignment, files }
}

const escapeXml = (value) => String(value).replace(/[<>&"']/g,
  (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
function labelSvg(text, width, height = 28) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text x="${width / 2}" y="19" text-anchor="middle" font-family="Arial,sans-serif" ` +
    `font-size="12" fill="#1b2541">${escapeXml(text)}</text></svg>`)
}
function backgroundSvg(width, height, color) {
  const fill = color === 'transparent' ? 'url(#check)' : color
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    '<defs><pattern id="check" width="16" height="16" patternUnits="userSpaceOnUse">' +
    '<rect width="16" height="16" fill="#fff"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#d7dce3"/>' +
    `</pattern></defs><rect width="100%" height="100%" fill="${fill}"/></svg>`)
}

async function compose(manifest, shared, root, parts) {
  const layers = shared.kunAvatarLayerKeys(parts).map((key) => ({
    input: assetPath(root, manifest.assets[key].webp[512]), left: 0, top: 0
  }))
  return sharp({ create: { width: 512, height: 512, channels: 4,
    background: parts.bg === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : parts.bg } })
    .composite(layers).png().toBuffer()
}

async function portrait(image, size, manifest, compact = false) {
  let source = sharp(image)
  if (compact) {
    const [left, top, right, bottom] = manifest.anchors.faceBox.map((number) => Math.round(number / 2))
    source = source.extract({ left, top, width: right - left, height: bottom - top })
  }
  return source.resize(size, size).png().toBuffer()
}

async function writeGrid(path, cells, columns, width, height) {
  const overlays = []
  for (const [index, cell] of cells.entries()) {
    const left = index % columns * width, top = Math.floor(index / columns) * height
    const image = await sharp(cell.image).metadata()
    overlays.push({ input: cell.image, left: left + Math.floor((width - image.width) / 2), top: top + 6 })
    overlays.push({ input: labelSvg(cell.label, width), left, top: top + height - 28 })
  }
  await sharp({ create: { width: columns * width, height: Math.ceil(cells.length / columns) * height,
    channels: 4, background: '#eef0f5' } }).composite(overlays).png().toFile(path)
}

export async function generateAvatarQa(manifest, shared, root, output, repo = projectRoot) {
  await mkdir(output, { recursive: true })
  const atlasRoot = resolve(repo, 'src/asset/img/room-avatars')
  const atlasInfo = JSON.parse(await readFile(resolve(atlasRoot, 'avatars.json'), 'utf8'))
  const comparison = []
  const presetImages = new Map()
  for (const preset of shared.KUN_AVATAR_PRESETS) {
    const old = atlasInfo.avatars.find((avatar) => avatar.id === preset.id)
    if (!old) throw new Error(`Legacy atlas lacks preset: ${preset.id}`)
    const oldPortrait = await sharp(resolve(atlasRoot, atlasInfo.image)).extract({
      left: old.column * atlasInfo.cellSize + atlasInfo.displayInset,
      top: old.row * atlasInfo.cellSize + atlasInfo.displayInset,
      width: atlasInfo.displaySize, height: atlasInfo.displaySize
    }).resize(144, 144).png().toBuffer()
    const composed = await compose(manifest, shared, root, { ...preset.parts, bg: 'transparent' })
    presetImages.set(preset.id, composed)
    const nextPortrait = await portrait(composed, 144, manifest)
    const pair = await sharp({ create: { width: 288, height: 144, channels: 4, background: '#f7f5ef' } })
      .composite([{ input: oldPortrait, left: 0, top: 0 }, { input: nextPortrait, left: 144, top: 0 }]).png().toBuffer()
    comparison.push({ image: pair, label: `${preset.id}: original / composed` })
  }
  await writeGrid(resolve(output, 'presets-original-composed.png'), comparison, 5, 304, 180)
  for (const category of shared.KUN_AVATAR_ACCESSORY_CATEGORIES) {
    const cells = []
    for (const part of shared.KUN_AVATAR_CATALOG[category]) {
      for (const color of shared.KUN_AVATAR_CATALOG.color) {
        const parts = shared.normalizeKunAvatarParts({ [category]: part.id, color: color.id })
        const image = await portrait(await compose(manifest, shared, root, parts), 160, manifest)
        cells.push({ image, label: `${part.id} / ${color.id}` })
      }
    }
    await writeGrid(resolve(output, `${category}-all-colors.png`), cells, 4, 192, 200)
  }
  const expressions = []
  for (const face of shared.KUN_AVATAR_CATALOG.face) for (const color of shared.KUN_AVATAR_CATALOG.color) {
    const parts = shared.normalizeKunAvatarParts({ color: color.id, face: face.id })
    expressions.push({ image: await portrait(await compose(manifest, shared, root, parts), 160, manifest),
      label: `${face.id} / ${color.id}` })
  }
  await writeGrid(resolve(output, 'body-expression-all-colors.png'), expressions, 4, 192, 200)
  for (const [background, color] of [['light', '#f7f5ef'], ['dark', '#142037'], ['transparent', 'transparent']]) {
    const cells = []
    for (const preset of shared.KUN_AVATAR_PRESETS) for (const size of [24, 34, 48, 96]) {
      const image = await portrait(presetImages.get(preset.id), size, manifest, size <= 48)
      const tile = await sharp(backgroundSvg(112, 104, color)).composite([
        { input: image, left: Math.floor((112 - size) / 2), top: Math.floor((104 - size) / 2) }
      ]).png().toBuffer()
      cells.push({ image: tile, label: `${preset.id} / ${size}px` })
    }
    await writeGrid(resolve(output, `sizes-${background}.png`), cells, 4, 192, 140)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--check-only', '--out'])
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`)
    if (args[index] === '--out') {
      if (!args[index + 1]) throw new Error('--out requires a directory')
      index++
    }
  }
  const outIndex = args.indexOf('--out')
  const output = outIndex < 0 ? resolve(projectRoot, '.cache/kun-avatar-qa') : resolve(args[outIndex + 1])
  const manifest = JSON.parse(await readFile(resolve(defaultAssetRoot, 'manifest.json'), 'utf8'))
  const shared = await loadAvatarCatalog()
  const result = await validateAvatarManifest(manifest, shared)
  if (!args.includes('--check-only')) {
    await generateAvatarQa(manifest, shared, defaultAssetRoot, output)
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...result, manifestVersion: manifest.version }, null, 2) + '\n')
  }
  console.log(`Kun avatars: ${result.layers} layers / ${result.fileCount} files; ` +
    `${result.legalPairs} legal and ${result.excludedPairs} excluded accessory pairs.`)
  console.log(`Sources ${(result.pngBytes / 1048576).toFixed(2)} MiB; ` +
    `application WebP ${(result.webpBytes / 1048576).toFixed(2)} MiB.`)
  console.log(`Color registration alpha bounds: maximum ${result.alignment.maxDisplacementPixels}px displacement ` +
    `(alpha >= ${result.alignment.alphaThreshold}; allowed ${result.alignment.tolerancePixels}px).`)
  if (!args.includes('--check-only')) console.log(`Visual QA: ${output}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
