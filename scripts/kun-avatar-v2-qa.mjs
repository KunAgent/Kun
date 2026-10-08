import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
import sharp from 'sharp'
import { assetPath } from './kun-avatar-art-validation.mjs'
import { alphaMask, AVATAR_FACEBOX_CANDIDATES, readAvatarPixels } from './kun-avatar-art-metrics.mjs'

/** QA grids only compose published raster art. SVG helpers supplied by the checker draw
 * labels and neutral backgrounds; they never generate or replace character artwork. */
export async function generateAvatarV2Qa(context, audit) {
  const { manifest, shared, root, output, compose, portrait, writeGrid, backgroundSvg } = context
  const read = (key, size) => sharp(assetPath(root, manifest.assets[key].png)).resize(size, size).png().toBuffer()
  const avatar = async (parts, size, options = {}) => portrait(await compose(manifest, shared, root,
    shared.normalizeKunAvatarParts(parts), options), size, manifest)
  const cells = [], scale = []
  for (const icon of audit.icons) {
    const image = await read(icon.key, 58), overlays = []
    for (const [index, bg] of ['#2c2c2c', '#181818', '#2c2c2c', '#181818'].entries()) {
      const left = index * 82
      overlays.push({ input: backgroundSvg(82, 82, bg), left, top: 0 })
      if (index >= 2) {
        overlays.push({ input: backgroundSvg(66, 66, '#4a4a4a'), left: left + 8, top: 8 })
        const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
        for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(data[i + 3] * 0.5) }
        overlays.push({ input: await sharp(data, { raw: info }).blur(1).png().toBuffer(), left: left + 12, top: 12 })
      }
      overlays.push({ input: image, left: left + 12, top: 12 })
    }
    cells.push({ image: await sharp(backgroundSvg(328, 82, '#eef0f5')).composite(overlays).png().toBuffer(),
      label: `${icon.key.replace('icon/', '')}: raw x2 / plate+rim x2` })
    scale.push({ image: await sharp(backgroundSvg(82, 82, '#eceff4')).composite([{ input: image, left: 12, top: 12 }]).png().toBuffer(),
      label: icon.key.replace('icon/', '') })
  }
  await writeGrid(resolve(output, 'icons-dark-theme.png'), cells, 3, 354, 128)
  await writeGrid(resolve(output, 'icons-same-scale.png'), scale, 6, 192, 124)
  const pairs = Object.values(audit.silhouettes).flatMap((group) => group.pairs).sort((a, b) => b.iou - a.iou).slice(0, 20)
  const silhouettes = []
  for (const pair of pairs) {
    const overlays = []
    for (const [index, key] of [pair.a, pair.b].entries()) {
      const pixels = await readAvatarPixels(assetPath(root, manifest.assets[key].png), 48), mask = alphaMask(pixels)
      const rgba = Buffer.alloc(48 * 48 * 4)
      for (let i = 0; i < mask.length; i++) rgba[i * 4 + 3] = mask[i] * 255
      const image = await sharp(rgba, { raw: { width: 48, height: 48, channels: 4 } }).png().toBuffer()
      overlays.push({ input: image, left: index * 64 + 8, top: 14 })
    }
    silhouettes.push({ image: await sharp(backgroundSvg(128, 76, '#eceff4')).composite(overlays).png().toBuffer(),
      label: `${pair.a.split('/').at(-1)} / ${pair.b.split('/').at(-1)} = ${pair.iou.toFixed(3)}` })
  }
  await writeGrid(resolve(output, 'silhouette-pairs.png'), silhouettes, 4, 330, 124)
  const effects = []
  for (const [rarity, headwear] of [['epic', 'detective-hat'], ['legendary', 'wizard-hat']]) {
    for (const bg of ['#f7f5ef', '#1d2530']) {
      effects.push({ image: await avatar({ headwear, bg }, 270, { size: 270, effects: true }),
        label: `${rarity} / ${bg} / 270px` })
    }
  }
  await writeGrid(resolve(output, 'fx-stage-270.png'), effects, 4, 286, 310)
  const faces = [], safety = []
  for (const { id: face } of shared.KUN_AVATAR_CATALOG.face) {
    for (const { id: color } of shared.KUN_AVATAR_CATALOG.color) for (const glasses of [undefined, 'round']) {
      const image = await compose(manifest, shared, root, shared.normalizeKunAvatarParts({ face, color, glasses, bg: '#f7f5ef' }))
      const [left, top, right, bottom] = manifest.anchors.faceBox.map((value) => Math.round(value / 2))
      faces.push({ image: await sharp(image).extract({ left, top, width: right - left, height: bottom - top }).resize(224, 224).png().toBuffer(),
        label: `${face} / ${color} / ${glasses ?? 'no glasses'}` })
    }
    for (const headwear of ['hard-hat', 'hood']) safety.push({ image: await avatar({ face, headwear }, 224), label: `${face} / ${headwear}` })
  }
  await writeGrid(resolve(output, 'faces-closeup.png'), faces, 8, 242, 264)
  await writeGrid(resolve(output, 'faces-hard-hat-hood.png'), safety, 4, 242, 264)
  const candidates = []
  for (const { id: headwear } of shared.KUN_AVATAR_CATALOG.headwear) {
    for (const [name, box] of Object.entries(AVATAR_FACEBOX_CANDIDATES)) {
      const overlays = []
      for (const [index, size] of [24, 34].entries()) {
        const image = await compose(manifest, shared, root, shared.normalizeKunAvatarParts({ headwear, bg: '#f7f5ef' }), { size })
        const [left, top, right, bottom] = box.map((value) => Math.round(value / 2))
        const cropped = await sharp(image).extract({ left, top, width: right - left, height: bottom - top }).resize(size, size).png().toBuffer()
        overlays.push({ input: cropped, left: index * 80 + Math.floor((80 - size) / 2), top: Math.floor((64 - size) / 2) })
      }
      const hat = audit.hats.find((item) => item.key === `headwear/${headwear}`)
      candidates.push({ image: await sharp(backgroundSvg(160, 64, '#eceff4')).composite(overlays).png().toBuffer(),
        label: `${headwear} / ${name}: ${(hat.candidates[name].small.ratio * 100).toFixed(1)}% / 24+34px` })
    }
  }
  await writeGrid(resolve(output, 'facebox-candidates.png'), candidates, 3, 320, 108)
  const beforeRoot = resolve(root, '../../../../.cache/kun-avatar-v2-before')
  if (await access(beforeRoot).then(() => true, () => false)) {
    const materialAvatar = async (category, part, previous, size) => {
      const parts = shared.normalizeKunAvatarParts({ [category]: part.id, bg: '#eceff4' })
      const overlays = []
      for (const key of shared.kunAvatarLayerKeys(parts, { size })) {
        const oldFile = assetPath(beforeRoot, `${key}.png`)
        const file = previous && await access(oldFile).then(() => true, () => false)
          ? oldFile : assetPath(root, manifest.assets[key].png)
        overlays.push({ input: file, left: 0, top: 0 })
      }
      const full = await sharp(backgroundSvg(1024, 1024, '#eceff4')).composite(overlays).png().toBuffer()
      let image = sharp(full)
      if (size <= 48) {
        const [left, top, right, bottom] = manifest.anchors.compactFaceBox ?? manifest.anchors.faceBox
        image = image.extract({ left, top, width: right - left, height: bottom - top })
      }
      return image.resize(size, size).png().toBuffer()
    }
    const materials = []
    for (const category of shared.KUN_AVATAR_ACCESSORY_CATEGORIES) {
      for (const part of shared.KUN_AVATAR_CATALOG[category].filter((item) => ['epic', 'legendary'].includes(item.rarity))) {
        const key = `${category}/${part.id}`, old = assetPath(beforeRoot, `${key}.png`)
        if (!await access(old).then(() => true, () => false)) continue
        const overlays = []
        for (const [index, previous] of [true, false].entries()) {
          overlays.push({ input: await materialAvatar(category, part, previous, 270), left: index * 280, top: 0 })
          overlays.push({ input: await materialAvatar(category, part, previous, 24), left: index * 280 + 123, top: 282 })
        }
        materials.push({ image: await sharp(backgroundSvg(560, 318, '#eceff4')).composite(overlays).png().toBuffer(),
          label: `${key} / old -> new / avatar 270px + 24px` })
      }
    }
    if (materials.length) await writeGrid(resolve(output, 'rarity-material-before-after.png'), materials, 3, 576, 358)
  }
}
