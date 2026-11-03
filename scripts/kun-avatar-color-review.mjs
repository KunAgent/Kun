import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadAvatarCatalog } from './kun-avatar-compose-check.mjs'
import { FEATHER_TARGET_HUES, FEATHER_ORIGINAL_HUES, mapFeatherImage } from './kun-avatar-feather-mapping.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(project, 'src/asset/img/kun-avatar')
const output = resolve(process.argv[2] ?? resolve(project, '.cache/kun-avatar-v2-review'))
const shared = await loadAvatarCatalog()
const colors = ['sky', 'periwinkle', 'teal', 'mint']
const modes = ['current', 'unified', 'hue-only']
const images = {}
// Review output only: this script never writes a published asset or a manifest.
for (const mode of modes) {
  images[mode] = {}
  for (const color of colors) for (const prefix of ['base/', 'crest/', 'crest/tucked-', 'wing/']) {
    const key = prefix + color, source = mode === 'unified' ? 'sky' : color
    images[mode][key] = mode === 'current' || color === 'sky' ? await readFile(resolve(root, `${key}.png`))
      : await mapFeatherImage(resolve(root, `${prefix}${source}.png`), FEATHER_TARGET_HUES[color], FEATHER_ORIGINAL_HUES[source])
  }
}
const label = (text, width) => Buffer.from(`<svg width="${width}" height="26">` +
  `<text x="8" y="19" font-size="14" fill="#8a93a3" font-family="sans-serif">${text}</text></svg>`)
const outfits = [{}, { outfit: 'black-hoodie', glasses: 'square' }, { outfit: 'cream-shirt', headwear: 'beret' }]
await mkdir(output, { recursive: true })
for (const [name, background] of [['light', '#f7f5ef'], ['dark', '#1d2530']]) {
  const overlays = []
  for (const [row, mode] of modes.entries()) for (const [column, color] of colors.entries()) {
    for (const [outfitIndex, outfit] of outfits.entries()) {
      const parts = shared.normalizeKunAvatarParts({ color, face: 'normal', ...outfit, bg: 'transparent' })
      const layers = shared.kunAvatarLayerKeys(parts).map((key) => ({
        input: images[mode][key] ?? resolve(root, `${key}.png`), left: 0, top: 0
      }))
      const full = await sharp({ create: { width: 1024, height: 1024, channels: 4, background } })
        .composite(layers).png().toBuffer()
      const left = (column * 3 + outfitIndex) * 136, top = row * 168
      overlays.push({ input: await sharp(full).resize(128, 128).png().toBuffer(), left, top: top + 26 })
      overlays.push({ input: label(`${mode} ${color}`, 136), left, top })
    }
  }
  await sharp({ create: { width: 1632, height: 504, channels: 4, background } }).composite(overlays)
    .png().toFile(resolve(output, `colors-${name}.png`))
}
console.log(`F7 review candidates (unpublished): ${output}`)
