import { KUN_AVATAR_CATALOG, KUN_AVATAR_SCENES, type KunAvatarAccessoryCategory } from '@shared/rooms-api'
import type { Kun3dAssetCategory, Kun3dAssetEntry } from '@shared/kun-3d-assets'

type Language = 'zh' | 'en'
const ACCESSORIES: readonly Kun3dAssetCategory[] = ['headwear', 'glasses', 'outfit', 'prop']

/** The wardrobe name for a model whose file follows `<category>/<id>.glb`, or null when it matches nothing. */
export function kun3dCatalogLabel(category: Kun3dAssetCategory, id: string, language: Language): string | null {
  if (ACCESSORIES.includes(category)) {
    const part = KUN_AVATAR_CATALOG[category as KunAvatarAccessoryCategory].find((entry) => entry.id === id)
    return part ? part.label[language] : null
  }
  if (category === 'scene') return KUN_AVATAR_SCENES.find((scene) => scene.id === id)?.label[language] ?? null
  if (category === 'base' && id === 'kun') return language === 'zh' ? 'Kun 素体' : 'Kun base'
  if (category === 'bottle' && id === 'bottle') return language === 'zh' ? '漂流瓶' : 'Bottle'
  return null
}

export function kun3dEntryMatches(entry: Kun3dAssetEntry, query: string, language: Language): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return entry.key.toLowerCase().includes(needle) || (kun3dCatalogLabel(entry.category, entry.id, language) ?? '').toLowerCase().includes(needle)
}
