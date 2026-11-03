import { z } from 'zod'
import type { ArtManifest } from './kun-art-types.js'
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const key = z.string().max(180).regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*(?:\.(?:small|back))?$/)
const path = z.string().max(200).regex(/^(96|128|256|512)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*(?:\.(?:small|back))?\.webp$/)
const label = z.object({ zh: z.string().min(1).max(200), en: z.string().min(1).max(200) }).strict()
const entry = z.object({ id, label }).strict()
const accessory = entry.extend({ rarity: z.enum(['common', 'rare', 'epic', 'legendary']), set: id,
  flavor: label, crest: z.enum(['normal', 'tucked', 'hidden']), hidesCrest: z.boolean(), hasBack: z.boolean(),
  excludes: z.array(z.string().regex(/^(headwear|glasses|outfit|prop):([a-z0-9-]+|\*)$/)).max(40) }).strict()
const list = <T extends z.ZodType>(type: T) => z.array(type).min(1).max(2000)
const parts = z.object({ color: id, face: id, headwear: id.optional(), glasses: id.optional(), outfit: id.optional(),
  prop: id.optional(), bg: z.string().regex(/^(#[a-fA-F0-9]{6}|transparent|scene:[a-z0-9-]+)$/) }).strict()
export const ArtCatalogSchema = z.object({
  parts: z.object({ color: list(entry.extend({ hex: z.string().regex(/^#[a-fA-F0-9]{6}$/) })), face: list(entry),
    headwear: list(accessory), glasses: list(accessory), outfit: list(accessory), prop: list(accessory) }).strict(),
  scenes: list(entry), presets: list(entry.extend({ parts, cardScene: id })),
  smallHeadwear: z.array(id).max(2000), sleevedOutfits: z.array(id).max(2000)
}).strict().superRefine((value, ctx) => {
  for (const rows of [...Object.values(value.parts), value.scenes, value.presets]) {
    if (new Set(rows.map(x => x.id)).size !== rows.length) ctx.addIssue({ code: 'custom', message: 'Duplicate catalog ID' })
  }
  const has = (category: keyof typeof value.parts, name: string) => value.parts[category].some(x => x.id === name)
  for (const preset of value.presets) {
    for (const [category, name] of Object.entries(preset.parts)) {
      if (category !== 'bg' && name && !has(category as keyof typeof value.parts, name)) ctx.addIssue({ code: 'custom', message: 'Unknown preset part' })
    }
    if (!value.scenes.some(x => x.id === preset.cardScene)) ctx.addIssue({ code: 'custom', message: 'Unknown card scene' })
  }
  if (!has('color', 'sky') || !has('face', 'normal')) ctx.addIssue({ code: 'custom', message: 'Missing default avatar' })
})
const box = z.array(z.number().finite().min(0).max(1024)).length(4).refine(b => b[2] > b[0] && b[3] > b[1])
export const ArtManifestSchema = z.object({
  schemaVersion: z.literal(1), rendererVersion: z.literal(1), releaseId: id,
  minAppVersion: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/), catalogVersion: z.string().regex(/^[a-f0-9]{16,64}$/),
  catalog: ArtCatalogSchema, canvas: z.literal(1024), anchors: z.object({ faceBox: box, compactFaceBox: box.optional() }).strict(),
  assets: z.record(key, z.object({ webp: z.record(z.string().regex(/^(96|128|256|512)$/), path) }).strict()),
  files: z.record(path, z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(8 * 1024 * 1024),
    width: z.number().int().min(1).max(1024), height: z.number().int().min(1).max(1024) }).strict())
}).strict().superRefine((m, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (!Object.keys(m.files).length || Object.keys(m.files).length > 5000 || Object.keys(m.assets).length > 2000 ||
      Object.values(m.files).reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) fail('Invalid release size')
  for (const asset of Object.values(m.assets)) {
    if (!Object.keys(asset.webp).length) fail('Empty asset')
    for (const [tier, name] of Object.entries(asset.webp)) {
      const f = m.files[name]
      if (!f || f.width !== Number(tier) || f.height !== Number(tier)) fail('Missing or invalid asset variant')
    }
  }
  const requireLayer = (name: string, tiers = ['128', '256', '512']) => {
    for (const tier of tiers) if (!m.assets[name]?.webp[tier]) fail(`Missing layer ${name}/${tier}`)
  }
  for (const color of m.catalog.parts.color) for (const prefix of ['base', 'wing', 'crest', 'crest/tucked-']) {
    requireLayer(prefix === 'crest/tucked-' ? `crest/tucked-${color.id}` : `${prefix}/${color.id}`)
  }
  for (const category of ['face', 'headwear', 'glasses', 'outfit', 'prop'] as const) {
    for (const item of m.catalog.parts[category]) {
      requireLayer(`${category}/${item.id}`)
      if ('hasBack' in item && item.hasBack) requireLayer(`${category}/${item.id}.back`)
      if (category === 'glasses' || (category === 'headwear' && m.catalog.smallHeadwear.includes(item.id))) requireLayer(`${category}/${item.id}.small`)
    }
  }
  for (const scene of m.catalog.scenes) { requireLayer(`scene/${scene.id}`); requireLayer(`scene/${scene.id}.small`) }
})
export function parseArtManifest(value: unknown): ArtManifest { return ArtManifestSchema.parse(value) as ArtManifest }
