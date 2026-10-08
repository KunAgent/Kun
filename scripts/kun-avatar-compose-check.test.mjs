import { after, before, test } from 'node:test'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { loadAvatarCatalog, loadAvatarManifest, requiredAvatarAssets, validateAvatarColorAlignment,
  validateAvatarManifest } from './kun-avatar-compose-check.mjs'
import { AVATAR_WEBP_ADDED_BUDGET_BYTES, AVATAR_WEBP_BASELINE_BYTES, avatarAssetSpec,
  detectAvatarEdgeHalo, validateAvatarBudget, validateAvatarIconMargins,
  validateAvatarProvenance } from './kun-avatar-art-validation.mjs'

const catalog = await loadAvatarCatalog()
let root, shared, manifest
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-avatar-assets-test-'))
  shared = { ...catalog,
    KUN_AVATAR_CATALOG: { color: catalog.KUN_AVATAR_CATALOG.color.slice(0, 1),
      face: catalog.KUN_AVATAR_CATALOG.face.slice(0, 1), headwear: [], glasses: [], outfit: [], prop: [] },
    ROOM_BUILTIN_AVATAR_IDS: ['coordinator'],
    KUN_AVATAR_PRESETS: [{ id: 'coordinator', parts: catalog.normalizeKunAvatarParts() }]
  }
  manifest = { schemaVersion: 1, version: 'test', canvas: 1024,
    anchors: { faceBox: [232, 300, 792, 860], eyeLineY: 584, beak: [512, 666] }, assets: {} }
  const pixels = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 200, height: 200,
      channels: 4, background: '#95cbf6' } }).png().toBuffer(), left: 400, top: 400 }]).png().toBuffer()
  await mkdir(join(root, 'sources'))
  await writeFile(join(root, 'sources/test.png'), pixels)
  await writeFile(join(root, 'sources/generation-records.json'), JSON.stringify({ sources: [{ file: 'test.png',
    width: 1024, height: 1024, sha256: createHash('sha256').update(pixels).digest('hex'),
    promptSummary: 'Synthetic fixture used to validate asset publication contracts' }] }))
  for (const key of requiredAvatarAssets(shared.KUN_AVATAR_CATALOG)) {
    const spec = avatarAssetSpec(key)
    const entry = { png: `${key}.png`, webp: {}, canvas: spec.canvas, source: { file: 'test.png' } }
    const source = spec.transparent ? pixels : await sharp({ create: { width: 1024, height: 1024,
      channels: 4, background: '#95cbf6' } }).png().toBuffer()
    await mkdir(dirname(join(root, entry.png)), { recursive: true })
    await sharp(source).resize(spec.canvas, spec.canvas).png().toFile(join(root, entry.png))
    for (const size of spec.tiers) {
      const path = `${size}/${key}.webp`
      await mkdir(dirname(join(root, path)), { recursive: true })
      await sharp(source).resize(size, size).webp().toFile(join(root, path))
      entry.webp[size] = path
    }
    manifest.assets[key] = entry
  }
})
after(async () => { if (root) await rm(root, { recursive: true, force: true }) })

test('catalog requires all wearing layers, independent icons and polish families', () => {
  const keys = requiredAvatarAssets(catalog.KUN_AVATAR_CATALOG)
  assert.equal(keys.length, 168)
  assert.equal(new Set(keys).size, 168)
  for (const key of ['headwear/hood.back', 'headwear/astronaut-helmet.back',
    'outfit/storyteller-cape.back', 'outfit/wizard-cape.back', 'crest/tucked-mint', 'wing/periwinkle',
    'icon/headwear/headset', 'icon/outfit/black-hoodie', 'icon/prop/camera', 'glasses/square.small',
    'headwear/wizard-hat.small', 'face/surprised', 'face/sleepy', 'face/wink', 'face/focused',
    'scene/sunset-bay.small', 'container/bottle-glow', 'fx/legendary', 'card/back']) {
    assert.ok(keys.includes(key), key)
  }
})

test('validates actual encoded dimensions, transparency and publication sizes', async () => {
  const result = await validateAvatarManifest(manifest, shared, root)
  assert.equal(result.layers, 24)
  assert.equal(result.fileCount, 96)
  assert.ok(result.pngBytes > 0)
  assert.ok(result.webpBytes > 0)
  assert.equal(result.alignment.maxDisplacementPixels, 0)
})

test('rejects missing catalog entries, out-of-bounds anchors and unsafe filenames', async () => {
  const missing = structuredClone(manifest)
  delete missing.assets['base/sky']
  await assert.rejects(validateAvatarManifest(missing, shared, root), /Missing catalog asset: base\/sky/)
  const anchor = structuredClone(manifest)
  anchor.anchors.faceBox[2] = 1025
  await assert.rejects(validateAvatarManifest(anchor, shared, root), /faceBox/)
  const unsafe = structuredClone(manifest)
  unsafe.assets['base/sky'].png = '../outside.png'
  await assert.rejects(validateAvatarManifest(unsafe, shared, root), /Invalid avatar asset path/)
})

test('rejects an opaque substitute and a file encoded at the wrong publication size', async () => {
  const invalid = structuredClone(manifest)
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#95cbf6' } })
    .png().toFile(join(root, 'opaque.png'))
  invalid.assets['base/sky'].png = 'opaque.png'
  await assert.rejects(validateAvatarManifest(invalid, shared, root), /requires both transparent and visible pixels/)
  const wrongSize = structuredClone(manifest)
  await sharp(join(root, manifest.assets['base/sky'].webp[256])).toFile(join(root, 'wrong-size.webp'))
  wrongSize.assets['base/sky'].webp[128] = 'wrong-size.webp'
  await assert.rejects(validateAvatarManifest(wrongSize, shared, root), /expected 128x128/)
})

test('measures alpha-bound registration and rejects a color shifted beyond two pixels', async () => {
  const aligned = structuredClone(manifest)
  const colors = catalog.KUN_AVATAR_CATALOG.color
  for (const prefix of ['base/', 'crest/', 'crest/tucked-', 'wing/']) {
    for (const { id } of colors) {
      aligned.assets[`${prefix}${id}`] = aligned.assets[`${prefix}sky`]
    }
  }
  const block = await sharp({ create: { width: 200, height: 200,
    channels: 4, background: '#95cbf6' } }).png().toBuffer()
  for (const displacement of [1, 2, 3]) {
    const path = `shifted-${displacement}.png`
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
      .composite([{ input: block, left: 400 + displacement, top: 400 }]).png().toFile(join(root, path))
    aligned.assets['base/teal'] = { png: path }
    if (displacement <= 2) {
      const result = await validateAvatarColorAlignment(aligned, colors, root)
      assert.equal(result.maxDisplacementPixels, displacement)
      assert.deepEqual(result.groups[0].variants.find((variant) => variant.key === 'base/teal')?.bounds,
        [400 + displacement, 400, 600 + displacement, 600])
    } else {
      await assert.rejects(validateAvatarColorAlignment(aligned, colors, root), /base\/teal: alpha bounds.*by 3px/)
    }
  }
})

test('requires every icon and distinguishes a 512px master from a 512px WebP', async () => {
  const invalid = structuredClone(manifest)
  invalid.assets['container/bottle-sealed'].webp[512] = invalid.assets['container/bottle-sealed'].png
  await assert.rejects(validateAvatarManifest(invalid, shared, root), /incorrect encoded format/)
  assert.deepEqual(avatarAssetSpec('icon/outfit/robe'), { canvas: 512, tiers: [128, 256], transparent: true })
  const icons = requiredAvatarAssets(catalog.KUN_AVATAR_CATALOG).filter((key) => key.startsWith('icon/'))
  assert.equal(icons.length, 57)
  for (const category of catalog.KUN_AVATAR_ACCESSORY_CATEGORIES) {
    for (const { id } of catalog.KUN_AVATAR_CATALOG[category]) assert.ok(icons.includes(`icon/${category}/${id}`))
  }
})

test('checks source provenance and rejects records that do not match the original pixels', async () => {
  const invalid = structuredClone(manifest)
  delete invalid.assets['fx/epic'].source
  await assert.rejects(validateAvatarProvenance(invalid, root), /fx\/epic: missing source provenance/)
  invalid.assets['fx/epic'].source = { file: '../test.png' }
  await assert.rejects(validateAvatarProvenance(invalid, root), /source missing from generation records/)
  const recordsRoot = join(root, 'bad-provenance')
  await mkdir(join(recordsRoot, 'sources'), { recursive: true })
  await sharp(join(root, 'sources/test.png')).png().toFile(join(recordsRoot, 'sources/test.png'))
  await writeFile(join(recordsRoot, 'sources/generation-records.json'), JSON.stringify({ sources: [
    { file: 'test.png', width: 1024, height: 1024, sha256: '0'.repeat(64), promptSummary: 'Wrong digest fixture' }
  ] }))
  await assert.rejects(validateAvatarProvenance(manifest, recordsRoot), /SHA256 mismatch/)
})

test('requires provenance on original layer keys too and rejects duplicate source filenames', async () => {
  const missing = structuredClone(manifest)
  delete missing.assets['base/sky'].source
  await assert.rejects(validateAvatarProvenance(missing, root), /base\/sky: missing source provenance/)
  const duplicates = join(root, 'duplicate-provenance')
  await mkdir(join(duplicates, 'sources'), { recursive: true })
  await writeFile(join(duplicates, 'sources/generation-records.json'), JSON.stringify({ sources: [
    { file: 'test.png' }, { file: 'test.png' }
  ] }))
  await assert.rejects(validateAvatarProvenance(manifest, duplicates), /Duplicate generation source filename: test.png/)
})

test('enforces the measured baseline plus 2.5MiB publication budget', () => {
  const limit = AVATAR_WEBP_BASELINE_BYTES + AVATAR_WEBP_ADDED_BUDGET_BYTES
  assert.equal(validateAvatarBudget(limit).maximumBytes, limit)
  assert.throws(() => validateAvatarBudget(limit + 1), /budget exceeded/)
})

test('rejects uncentered icons while permitting a naturally slender centered object', async () => {
  const icon = async (name, left, top, width, height) => {
    const path = join(root, name)
    const object = await sharp({ create: { width, height, channels: 4, background: '#123456' } }).png().toBuffer()
    await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00000000' } })
      .composite([{ input: object, left, top }]).png().toFile(path)
    return path
  }
  const valid = await icon('icon-valid.png', 216, 41, 80, 430)
  assert.ok((await validateAvatarIconMargins(valid)).margins.every((margin) => margin >= 0.045))
  await assert.rejects(validateAvatarIconMargins(await icon('icon-clipped.png', 0, 41, 430, 430)), /8% margin/)
  await assert.rejects(validateAvatarIconMargins(await icon('icon-tiny.png', 216, 216, 80, 80)), /8% margin/)
})

test('detects an exterior pale halo without treating interior lens highlights as residual edges', async () => {
  const image = async (name, fringe, highlight) => {
    const data = Buffer.alloc(128 * 128 * 4)
    for (let y = 10; y < 118; y++) for (let x = 10; x < 118; x++) {
      const edge = x < 12 || y < 12 || x > 115 || y > 115
      const light = fringe && edge || highlight && x > 24 && x < 100 && y > 24 && y < 100
      const offset = (y * 128 + x) * 4
      data[offset] = light ? 255 : 14
      data[offset + 1] = light ? 255 : 47
      data[offset + 2] = light ? 255 : 102
      data[offset + 3] = light ? 128 : 255
    }
    const path = join(root, name)
    await sharp(data, { raw: { width: 128, height: 128, channels: 4 } }).png().toFile(path)
    return path
  }
  assert.equal((await detectAvatarEdgeHalo(await image('halo.png', true, false))).failed, true)
  assert.equal((await detectAvatarEdgeHalo(await image('lens.png', false, true))).failed, false)
})

test('merges declared family manifests and rejects traversal, duplicate files and misplaced entries', async () => {
  const directory = join(root, 'family-index')
  await mkdir(join(directory, 'manifests'), { recursive: true })
  const index = { schemaVersion: 1, version: '2', canvas: 1024,
    anchors: manifest.anchors, assetManifests: ['manifests/base.json', 'manifests/face.json'] }
  const save = (value) => writeFile(join(directory, 'manifest.json'), JSON.stringify(value))
  await writeFile(join(directory, 'manifests/base.json'), JSON.stringify({ 'base/sky': manifest.assets['base/sky'] }))
  await writeFile(join(directory, 'manifests/face.json'), JSON.stringify({ 'face/normal': manifest.assets['face/normal'] }))
  await save(index)
  assert.deepEqual(Object.keys((await loadAvatarManifest(directory)).assets), ['base/sky', 'face/normal'])
  await save({ ...index, assetManifests: ['../outside.json'] })
  await assert.rejects(loadAvatarManifest(directory), /Invalid avatar asset path/)
  await save({ ...index, assetManifests: ['manifests/base.json', 'manifests/base.json'] })
  await assert.rejects(loadAvatarManifest(directory), /Duplicate avatar family manifest/)
  await save({ ...index, assets: {} })
  await assert.rejects(loadAvatarManifest(directory), /without inline assets/)
  await save(index)
  await writeFile(join(directory, 'manifests/face.json'), JSON.stringify({ 'wing/sky': manifest.assets['wing/sky'] }))
  await assert.rejects(loadAvatarManifest(directory), /belongs in manifests\/wing.json/)
  await writeFile(join(directory, 'manifests/face.json'), JSON.stringify({ 'base/sky': manifest.assets['base/sky'] }))
  await assert.rejects(loadAvatarManifest(directory), /Duplicate avatar asset in family manifests/)
})
