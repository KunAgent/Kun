import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import { outfitRasterDifference, reconstructOutfitRegistration, validateAvatarOutfitAlignment,
  validateOutfitBeakClearance, validateOutfitRaster } from './kun-avatar-outfit-alignment-check.mjs'

let source, registered, root, manifest
const registration = { left: 152, top: 750, width: 720 }
const blank = () => sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0000' } })

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-avatar-outfit-registration-'))
  const pixels = Buffer.alloc(64 * 48 * 4)
  for (let y = 8; y < 40; y++) for (let x = 8; x < 56; x++) {
    const offset = (y * 64 + x) * 4
    pixels[offset] = y < 24 ? 40 : 210
    pixels[offset + 1] = x * 3
    pixels[offset + 2] = y * 5
    pixels[offset + 3] = 255
  }
  source = await sharp(pixels, { raw: { width: 64, height: 48, channels: 4 } }).png().toBuffer()
  // The visible 48x32 sprite becomes 720x480; the bottom 206px leave the picture.
  const full = await sharp(source).extract({ left: 8, top: 8, width: 48, height: 32 })
    .resize(720, 480).png().toBuffer()
  const visible = await sharp(full).extract({ left: 0, top: 0, width: 720, height: 274 }).png().toBuffer()
  registered = await blank().composite([{ input: visible, left: 152, top: 750 }]).png().toBuffer()
  await mkdir(join(root, 'sources'))
  await writeFile(join(root, 'sources/coat.png'), source)
  const entry = { png: 'outfit/coat.png', webp: {}, canvas: 1024,
    source: { file: 'coat.png', registration } }
  await mkdir(join(root, 'outfit'))
  await writeFile(join(root, entry.png), registered)
  for (const size of [128, 256, 512]) {
    const path = `${size}/outfit/coat.webp`
    await mkdir(dirname(join(root, path)), { recursive: true })
    await sharp(registered).resize(size, size).webp({ quality: 90, alphaQuality: 100 }).toFile(join(root, path))
    entry.webp[size] = path
  }
  manifest = { canvas: 1024, anchors: { beak: [512, 666] }, assets: { 'outfit/coat': entry } }
})
after(async () => { await rm(root, { recursive: true, force: true }) })

test('registers source ink uniformly and crops the torso beyond the portrait edge', async () => {
  const result = await reconstructOutfitRegistration(source, registration)
  assert.deepEqual(result.sourceBounds, [8, 8, 56, 40])
  assert.deepEqual(result.scaledSize, [720, 480])
  assert.deepEqual(result.clippedSize, [720, 274])
  assert.deepEqual(await validateOutfitRaster(result.image, registered), { maxAlpha: 0, meanAlpha: 0, meanColor: 0 })
})

test('rejects the original fill-squeeze even when alpha bounds and silhouette are identical', async () => {
  const squeezed = await sharp(source).extract({ left: 8, top: 8, width: 48, height: 32 })
    .resize(720, 274, { fit: 'fill' }).png().toBuffer()
  const bad = await blank().composite([{ input: squeezed, left: 152, top: 750 }]).png().toBuffer()
  const metrics = await outfitRasterDifference(registered, bad)
  assert.equal(metrics.maxAlpha, 0, 'a bounding-box or alpha-only guard cannot detect this regression')
  assert.ok(metrics.meanColor > 10)
  await assert.rejects(validateOutfitRaster(registered, bad), /aspect-preserving registration/)
})

test('preserves width-only scale when odd aspect rounding would make cover crop a column', async () => {
  const pixels = Buffer.alloc(1238 * 489 * 4)
  for (let y = 0; y < 489; y++) for (let x = 0; x < 1238; x++) {
    const offset = (y * 1238 + x) * 4
    pixels[offset] = 45; pixels[offset + 1] = 165; pixels[offset + 2] = 142
    pixels[offset + 3] = x % 137 < 68 || y < 8 || y >= 481 ? 255 : 0
  }
  const oddSource = await sharp(pixels, { raw: { width: 1238, height: 489, channels: 4 } }).png().toBuffer()
  const scaled = await sharp(oddSource).resize({ width: 1080 }).png().toBuffer()
  assert.equal((await sharp(scaled).metadata()).height, 427)
  const visible = await sharp(scaled).extract({ left: 28, top: 0, width: 1024, height: 427 }).png().toBuffer()
  const actual = await blank().composite([{ input: visible, left: 0, top: 500 }]).png().toBuffer()
  const expected = await reconstructOutfitRegistration(oddSource, { left: -28, top: 500, width: 1080 })
  assert.deepEqual(expected.scaledSize, [1080, 427])
  assert.deepEqual(await validateOutfitRaster(expected.image, actual), { maxAlpha: 0, meanAlpha: 0, meanColor: 0 })
  const cover = await sharp(oddSource).resize(1080, 427).png().toBuffer()
  const coverClip = await sharp(cover).extract({ left: 28, top: 0, width: 1024, height: 427 }).png().toBuffer()
  const wrong = await blank().composite([{ input: coverClip, left: 0, top: 500 }]).png().toBuffer()
  await assert.rejects(validateOutfitRaster(expected.image, wrong), /aspect-preserving registration/)
})

test('clips a shoulder beyond the left edge without fitting it back inside the canvas', async () => {
  const result = await reconstructOutfitRegistration(source, { left: -20, top: 750, width: 720 })
  assert.deepEqual(result.scaledSize, [720, 480])
  assert.deepEqual(result.clippedSize, [700, 274])
  const actual = await sharp(result.image).ensureAlpha().raw().toBuffer()
  assert.equal(actual[(750 * 1024) * 4 + 3], 255)
  assert.equal(actual[(750 * 1024 + 700) * 4 + 3], 0)
})

test('rejects a moved layer and an independently authored target height', async () => {
  const moved = await reconstructOutfitRegistration(source, { ...registration, top: 770 })
  await assert.rejects(validateOutfitRaster(registered, moved.image), /aspect-preserving registration/)
  await assert.rejects(reconstructOutfitRegistration(source, { ...registration, height: 274 }), /no independent height/)
  await assert.rejects(reconstructOutfitRegistration(source, { left: 0, top: 1024, width: 720 }), /outside/)
})

test('validates published PNG colors, every WebP alpha tier and mouth clearance', async () => {
  const report = await validateAvatarOutfitAlignment(manifest, [{ id: 'coat' }], root)
  assert.equal(report.layers, 1)
  assert.equal(report.garments, 1)
  assert.equal(report.backLayers, 0)
  assert.equal(report.registrations[0].beak.overlapPixels, 0)
  assert.deepEqual(report.registrations[0].tiers.map(({ size }) => size), [128, 256, 512])
})

test('checks registered rear cape pixels while allowing alpha behind the face', async () => {
  const rear = await reconstructOutfitRegistration(source, { ...registration, top: 600 })
  await assert.rejects(validateOutfitBeakClearance(rear.image), /beak/)
  const entry = { png: 'outfit/coat.back.png', webp: {}, canvas: 1024,
    source: { file: 'coat.png', registration: { ...registration, top: 600 } } }
  await writeFile(join(root, entry.png), rear.image)
  for (const size of [128, 256, 512]) {
    entry.webp[size] = `${size}/outfit/coat.back.webp`
    await sharp(rear.image).resize(size, size).webp({ quality: 90, alphaQuality: 100 }).toFile(join(root, entry.webp[size]))
  }
  const withRear = structuredClone(manifest)
  withRear.assets['outfit/coat.back'] = entry
  const report = await validateAvatarOutfitAlignment(withRear, [{ id: 'coat', hasBack: true }], root)
  assert.equal(report.garments, 1)
  assert.equal(report.layers, 2)
  assert.equal(report.backLayers, 1)
  assert.equal(report.registrations[1].beak, null)
  assert.deepEqual(report.registrations[1].tiers.map(({ size }) => size), [128, 256, 512])
  const incorrect = await reconstructOutfitRegistration(source, { ...registration, top: 620 })
  await writeFile(join(root, entry.png), incorrect.image)
  await assert.rejects(validateAvatarOutfitAlignment(withRear, [{ id: 'coat', hasBack: true }], root),
    /outfit\/coat.back: Outfit raster differs/)
})

test('leaves legacy unregistered rear layers to the general manifest checks', async () => {
  const legacy = structuredClone(manifest)
  legacy.assets['outfit/coat.back'] = { source: { file: 'coat.png' }, png: 'legacy-rear.png' }
  const report = await validateAvatarOutfitAlignment(legacy, [{ id: 'coat', hasBack: true }], root)
  assert.equal(report.layers, 1)
  assert.equal(report.backLayers, 0)
})

test('rejects missing placement provenance and stale WebP geometry', async () => {
  const missing = structuredClone(manifest)
  delete missing.assets['outfit/coat'].source.registration
  await assert.rejects(validateAvatarOutfitAlignment(missing, [{ id: 'coat' }], root), /Missing aspect-preserving/)
  await sharp(registered).flip().resize(128, 128).webp({ alphaQuality: 100 }).toFile(join(root, 'stale.webp'))
  const stale = structuredClone(manifest)
  stale.assets['outfit/coat'].webp[128] = 'stale.webp'
  await assert.rejects(validateAvatarOutfitAlignment(stale, [{ id: 'coat' }], root), /aspect-preserving registration/)
})

test('rejects collar intrusion into the mouth while allowing lower cheek edges', async () => {
  const intruder = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#212840' } })
    .png().toBuffer()
  const bad = await blank().composite([{ input: intruder, left: 502, top: 650 }]).png().toBuffer()
  await assert.rejects(validateOutfitBeakClearance(bad), /400 pixels.*beak/)
  const cheek = await blank().composite([{ input: intruder, left: 280, top: 720 }]).png().toBuffer()
  assert.equal((await validateOutfitBeakClearance(cheek)).overlapPixels, 0)
})
