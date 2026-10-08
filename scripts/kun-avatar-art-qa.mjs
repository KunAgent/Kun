import { resolve } from 'node:path'
import sharp from 'sharp'
import { assetPath, AVATAR_SCENES } from './kun-avatar-art-validation.mjs'

const backgrounds = [['light', '#f7f5ef'], ['dark', '#1d2530'], ['checker', 'transparent']]

async function juxtapose(images, backgroundSvg, color = '#f7f5ef', width = 128, height = 128) {
  const overlays = []
  for (const [index, image] of images.entries()) {
    const metadata = await sharp(image).metadata()
    overlays.push({ input: image, left: index * width + Math.floor((width - metadata.width) / 2),
      top: Math.floor((height - metadata.height) / 2) })
  }
  return sharp(backgroundSvg(width * images.length, height, color)).composite(overlays).png().toBuffer()
}

export async function generateAvatarArtQa(context) {
  const { manifest, shared, root, output, compose, portrait, writeGrid, backgroundSvg } = context
  const image = (key, size) => {
    const entry = manifest.assets[key]
    const tier = Object.keys(entry.webp).map(Number).sort((a, b) => a - b).find((tier) => tier >= size)
    return sharp(assetPath(root, tier ? entry.webp[tier] : entry.png)).resize(size, size).png().toBuffer()
  }
  const avatar = async (parts, size = 128, options = {}) => portrait(
    await compose(manifest, shared, root, shared.normalizeKunAvatarParts(parts), options),
    size, manifest, size <= 48)
  const cells = []
  const silhouettes = []
  for (const category of shared.KUN_AVATAR_ACCESSORY_CATEGORIES) {
    for (const part of shared.KUN_AVATAR_CATALOG[category]) {
      const icon = await image(`icon/${category}/${part.id}`, 64)
      const worn = await avatar({ [category]: part.id, bg: 'transparent' })
      for (const [name, color] of backgrounds) {
        cells.push({ image: await juxtapose([icon, worn], backgroundSvg, color),
          label: `${part.id} / ${name}` })
      }
      const { data, info } = await sharp(icon).resize(48, 48).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let pixel = 0; pixel < data.length; pixel += 4) data.fill(0, pixel, pixel + 3)
      const silhouette = await sharp(data, { raw: info }).png().toBuffer()
      silhouettes.push({ image: await juxtapose([silhouette], backgroundSvg, '#f7f5ef', 96, 64),
        label: `${category}/${part.id}` })
    }
  }
  await writeGrid(resolve(output, 'icons-vs-worn.png'), cells, 3, 272, 164)
  await writeGrid(resolve(output, 'icons-silhouette-48.png'), silhouettes, 6, 192, 108)

  const expressions = [], helmets = []
  for (const face of shared.KUN_AVATAR_CATALOG.face) for (const glasses of shared.KUN_AVATAR_CATALOG.glasses) {
    for (const color of shared.KUN_AVATAR_CATALOG.color) {
      expressions.push({ image: await avatar({ face: face.id, glasses: glasses.id, color: color.id }),
        label: `${face.id} / ${glasses.id} / ${color.id}` })
    }
  }
  for (const face of shared.KUN_AVATAR_CATALOG.face) for (const color of shared.KUN_AVATAR_CATALOG.color) {
    helmets.push({ image: await avatar({ face: face.id, color: color.id, headwear: 'astronaut-helmet' }),
      label: `${face.id} / helmet / ${color.id}` })
  }
  await writeGrid(resolve(output, 'faces-glasses-colors.png'), expressions, 4, 220, 168)
  await writeGrid(resolve(output, 'faces-helmet-colors.png'), helmets, 4, 220, 168)

  const effects = []
  for (const rarity of ['epic', 'legendary']) for (const color of shared.KUN_AVATAR_CATALOG.color) {
    for (const bg of ['#f7f5ef', '#1d2530', '#d9edf7', '#f5dcdb', '#ddedd7', '#e9dffa']) {
      const headwear = rarity === 'epic' ? 'detective-hat' : 'wizard-hat'
      effects.push({ image: await avatar({ color: color.id, headwear, bg }, 128, { size: 128, effects: true }),
        label: `${rarity} / ${color.id} / ${bg}` })
    }
  }
  await writeGrid(resolve(output, 'fx-overlays.png'), effects, 6, 200, 168)

  const scenes = [], smallScenes = []
  for (const preset of shared.KUN_AVATAR_PRESETS) for (const scene of AVATAR_SCENES) {
    const parts = { ...preset.parts, bg: `scene:${scene}` }
    scenes.push({ image: await avatar(parts), label: `${preset.id} / ${scene}` })
    smallScenes.push({ image: await juxtapose([
      await avatar({ ...preset.parts, bg: '#f7f5ef' }, 34, { size: 34 }),
      await avatar(parts, 34, { size: 34 })
    ], backgroundSvg, '#f7f5ef', 64, 64), label: `${preset.id} / ${scene}` })
  }
  await writeGrid(resolve(output, 'scenes-presets.png'), scenes, 6, 208, 168)
  await writeGrid(resolve(output, 'scenes-small.png'), smallScenes, 6, 208, 104)

  const bottles = []
  for (const state of ['sealed', 'glowing', 'open', 'glow']) for (const [name, color] of backgrounds) {
    bottles.push({ image: await juxtapose([
      await image(`container/bottle-${state}`, 96), await image(`container/bottle-${state}`, 256)
    ], backgroundSvg, color, 256, 256), label: `${state} / ${name} / 96px + 256px` })
  }
  await writeGrid(resolve(output, 'bottle-states.png'), bottles, 3, 528, 292)
  const cards = []
  for (const preset of shared.KUN_AVATAR_PRESETS) {
    const front = await avatar({ ...preset.parts, bg: `scene:${preset.cardScene}` })
    cards.push({ image: await juxtapose([front, await image('card/back', 128)], backgroundSvg),
      label: `${preset.id} / front + back` })
  }
  await writeGrid(resolve(output, 'card-art.png'), cards, 5, 272, 168)

  for (const [name, color] of backgrounds) {
    const comparisons = []
    for (const preset of shared.KUN_AVATAR_PRESETS) for (const size of [24, 34, 48]) {
      const parts = { ...preset.parts, bg: 'transparent' }
      comparisons.push({ image: await juxtapose([
        await avatar(parts, size, { size, legacy: true }), await avatar(parts, size, { size })
      ], backgroundSvg, color, 64, 64), label: `${preset.id} / ${size}px / old + small` })
    }
    await writeGrid(resolve(output, `sizes-${name}-before-after.png`), comparisons, 3, 224, 104)
  }
}
