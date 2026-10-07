import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { loadAvatarCatalog, requiredAvatarAssets, validateAvatarColorAlignment,
  validateAvatarManifest } from './kun-avatar-compose-check.mjs'

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
  for (const key of requiredAvatarAssets(shared.KUN_AVATAR_CATALOG)) {
    const entry = { png: `${key}.png`, webp: {} }
    await mkdir(dirname(join(root, entry.png)), { recursive: true })
    await writeFile(join(root, entry.png), pixels)
    for (const size of [128, 256, 512]) {
      const path = `${size}/${key}.webp`
      await mkdir(dirname(join(root, path)), { recursive: true })
      await sharp(pixels).resize(size, size).webp().toFile(join(root, path))
      entry.webp[size] = path
    }
    manifest.assets[key] = entry
  }
})
after(async () => { if (root) await rm(root, { recursive: true, force: true }) })

test('catalog requires the complete 79-layer set including back, tinted-wing and tucked-crest assets', () => {
  const keys = requiredAvatarAssets(catalog.KUN_AVATAR_CATALOG)
  assert.equal(keys.length, 79)
  assert.equal(new Set(keys).size, 79)
  for (const key of ['headwear/hood.back', 'headwear/astronaut-helmet.back',
    'outfit/storyteller-cape.back', 'outfit/wizard-cape.back', 'crest/tucked-mint', 'wing/periwinkle']) {
    assert.ok(keys.includes(key), key)
  }
})

test('validates actual encoded dimensions, transparency and publication sizes', async () => {
  const result = await validateAvatarManifest(manifest, shared, root)
  assert.equal(result.layers, 5)
  assert.equal(result.fileCount, 20)
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
