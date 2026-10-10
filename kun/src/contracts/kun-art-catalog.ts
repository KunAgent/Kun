import { KUN_AVATAR_CATALOG, KUN_AVATAR_SCENES, KUN_AVATAR_SMALL_HEADWEAR, SLEEVED_OUTFITS } from './kun-avatar-catalog.js'
import { KUN_AVATAR_PRESETS, KUN_AVATAR_CARD_SCENES } from './kun-avatar-presets.js'
import { ArtCatalogSchema } from './kun-art-schema.js'
import type { ArtCatalog } from './kun-art-types.js'
export function readArtCatalog(): ArtCatalog {
  return structuredClone({ parts: KUN_AVATAR_CATALOG, scenes: KUN_AVATAR_SCENES, presets: KUN_AVATAR_PRESETS,
    smallHeadwear: KUN_AVATAR_SMALL_HEADWEAR, sleevedOutfits: SLEEVED_OUTFITS })
}
const bundled = readArtCatalog()
/** Only display metadata changes. Account ownership remains server-authoritative. */
export function installArtCatalog(input: unknown | null): void {
  const data = input === null ? structuredClone(bundled) : ArtCatalogSchema.parse(input)
  for (const category of Object.keys(data.parts) as (keyof ArtCatalog['parts'])[]) {
    // Keep exported arrays stable for existing consumers.
    const target = KUN_AVATAR_CATALOG[category] as unknown[]
    target.splice(0, target.length, ...data.parts[category])
  }
  KUN_AVATAR_SCENES.splice(0, KUN_AVATAR_SCENES.length, ...data.scenes)
  KUN_AVATAR_PRESETS.splice(0, KUN_AVATAR_PRESETS.length, ...data.presets)
  KUN_AVATAR_SMALL_HEADWEAR.splice(0, KUN_AVATAR_SMALL_HEADWEAR.length, ...data.smallHeadwear)
  SLEEVED_OUTFITS.splice(0, SLEEVED_OUTFITS.length, ...data.sleevedOutfits)
  for (const key of Object.keys(KUN_AVATAR_CARD_SCENES)) delete KUN_AVATAR_CARD_SCENES[key]
  for (const preset of data.presets) KUN_AVATAR_CARD_SCENES[preset.id] = preset.cardScene
}
