// Register garment necklines on the locked body. Height follows the source aspect;
// cloth below the portrait continues off canvas instead of being squeezed into it.
export const outfitRegistrations = Object.fromEntries([
  ['black-hoodie', 1080, 750], ['mint-hoodie', 1080, 750],
  ['cream-shirt', 1000, 720], ['cardigan', 1020, 720],
  ['lab-coat', 1040, 720], ['security-jacket', 1040, 720],
  ['red-scarf', 720, 730], ['cream-scarf', 720, 730], ['night-scarf', 720, 740],
  ['spacesuit', 1080, 760], ['pilot-jacket', 1080, 760], ['sailor-shirt', 1080, 760],
  ['overalls', 1080, 760], ['chef-coat', 1080, 760], ['nurse-uniform', 1080, 760],
  ['camera-shirt', 1080, 760], ['sports-vest', 860, 750],
  ['storyteller-cape', 1080, 760], ['wizard-cape', 1000, 720],
  ['coffee-apron', 650, 740], ['tool-apron', 680, 740], ['mailbag', 400, 740],
  ['robe', 1040, 720], ['blue-scarf', 700, 780],
  ['storyteller-cape.back', 1400, 600], ['wizard-cape.back', 1500, 580]
].map(([id, width, top]) => [`outfit/${id}`, { left: Math.round((1024 - width) / 2), top, width }]))

export const alignedHoodieRecipes = [
  { key: 'outfit/black-hoodie', source: 'alignment-hoodie-prototype.png' },
  { key: 'outfit/mint-hoodie', source: 'alignment-mint-hoodie.png' }
].map((recipe) => ({ ...recipe, registration: outfitRegistrations[recipe.key] }))

export function registerOutfits(recipes, replacements = alignedHoodieRecipes) {
  for (const [key, registration] of Object.entries(outfitRegistrations)) {
    const recipe = recipes.get(key)
    if (!recipe) throw new Error(`Missing wearable outfit recipe: ${key}`)
    const { box: _box, ...source } = recipe
    recipes.set(key, { ...source, registration })
  }
  for (const recipe of replacements) {
    if (!recipes.has(recipe.key)) throw new Error(`Unknown replacement outfit: ${recipe.key}`)
    recipes.set(recipe.key, { canvas: 1024, tiers: [128, 256, 512], ...recipe })
  }
}
