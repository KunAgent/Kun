#!/usr/bin/env node
// Exports the wardrobe catalog (items, role cards, look options and drop rules) as JSON for the
// Kun account service, which seeds its database from it. The TypeScript catalog stays the only
// source of truth: run this after changing items, rarities, presets or rules, then regenerate the
// account service's catalog migration from the written file.
//
//   node scripts/export-kun-wardrobe-catalog.mjs --out ../kunserve/supabase/catalog/kun-wardrobe-catalog.json
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const outIndex = process.argv.indexOf('--out')
if (outIndex < 0 || !process.argv[outIndex + 1]) {
  console.error('usage: node scripts/export-kun-wardrobe-catalog.mjs --out <file.json>')
  process.exit(1)
}
const output = resolve(process.argv[outIndex + 1])
const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'kun-wardrobe-catalog-'))
try {
  const bundle = join(temp, 'catalog.mjs')
  await build({
    stdin: {
      contents: `export * from './kun/src/contracts/kun-avatar-catalog.ts'
export * from './kun/src/contracts/kun-avatar-presets.ts'
export * from './kun/src/contracts/kun-wardrobe.ts'`,
      resolveDir: root, loader: 'ts'
    },
    bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent'
  })
  const catalog = await import(pathToFileURL(bundle).href)
  const starter = new Set(catalog.KUN_WARDROBE_STARTER_PACK)
  const items = catalog.KUN_AVATAR_ACCESSORY_CATEGORIES.flatMap((category) =>
    catalog.KUN_AVATAR_CATALOG[category].map((part, index) => ({
      key: `${category}/${part.id}`, category, id: part.id, rarity: part.rarity,
      starter: starter.has(`${category}/${part.id}`), label: part.label, sort: index
    })))
  const cards = catalog.KUN_AVATAR_PRESETS.map((preset, index) => ({
    id: preset.id, rarity: catalog.kunAvatarRarity(preset.parts), label: preset.label, sort: index,
    items: catalog.kunWardrobePartKeys(preset.parts)
  }))
  const data = {
    items, cards,
    colors: catalog.KUN_AVATAR_CATALOG.color.map((entry) => entry.id),
    faces: catalog.KUN_AVATAR_CATALOG.face.map((entry) => entry.id),
    scenes: catalog.KUN_AVATAR_SCENES.map((entry) => entry.id),
    defaultLook: catalog.KUN_AVATAR_DEFAULT_PARTS,
    rules: catalog.KUN_WARDROBE_RULES
  }
  const version = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
  await writeFile(output, JSON.stringify({ version, ...data }, null, 2) + '\n')
  console.log(`wrote ${items.length} items and ${cards.length} cards (catalog ${version}) to ${output}`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
