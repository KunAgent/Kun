import { avatarRecipes } from './kun-avatar-asset-recipes.mjs'

// Extraction/registration of generated raster art only. No character art is drawn in code.
export const polishRecipes = []
function icons(source, grid, ids) {
  ids.forEach((id, cell) => polishRecipes.push({ key: `icon/outfit/${id}`, source, grid, cell,
    canvas: 512, tiers: [128, 256], box: [41, 41, 430, 430], fit: 'contain' }))
}
icons('polish-icons-clothes-a.png', [3, 3], ['black-hoodie', 'mint-hoodie', 'cream-shirt',
  'cardigan', 'lab-coat', 'security-jacket', 'red-scarf', 'cream-scarf', 'night-scarf'])
icons('polish-icons-clothes-b.png', [3, 3], ['spacesuit', 'pilot-jacket', 'sailor-shirt',
  'overalls', 'chef-coat', 'nurse-uniform', 'camera-shirt', 'sports-vest', 'storyteller-cape'])
icons('polish-icons-clothes-c.png', [2, 3], ['wizard-cape', 'coffee-apron', 'tool-apron',
  'mailbag', 'robe', 'blue-scarf'])
// The generated robe collar overlaps the nominal apron cell; exclude that neighboring ink.
Object.assign(polishRecipes.find((recipe) => recipe.key === 'icon/outfit/tool-apron'),
  { sourceCrop: { left: 0, top: 512, width: 512, height: 486 } })
Object.assign(polishRecipes.find((recipe) => recipe.key === 'icon/outfit/robe'),
  { source: 'polish-icons-clothes-c-refined.png', sourceCrop: { left: 0, top: 1000, width: 512, height: 536 } })

for (const [cell, [id, box]] of [
  ['surprised', [182, 388, 660, 408]], ['wink', [182, 466, 660, 330]],
  ['focused', [182, 416, 660, 380]], ['sleepy', [182, 416, 660, 380]]
].entries()) polishRecipes.push({ key: `face/${id}`, source: 'polish-faces.png', grid: [2, 2], cell, box })

for (const [cell, id] of ['square', 'round', 'lab', 'rectangular', 'cat-eye'].entries()) {
  const original = avatarRecipes.find((recipe) => recipe.key === `glasses/${id}`)
  polishRecipes.push({ key: `glasses/${id}.small`, source: 'polish-glasses-small.png',
    grid: [3, 2], cell, box: original.box })
}
// Re-register the original hat pixels so the brim survives the compact face crop.
for (const [id, box] of [
  ['wizard-hat', [108, 174, 808, 338]], ['beanie', [168, 180, 688, 330]],
  ['headphones', [120, 253, 784, 545]], ['hard-hat', [146, 196, 732, 312]]
]) {
  const original = avatarRecipes.find((recipe) => recipe.key === `headwear/${id}`)
  polishRecipes.push({ ...original, key: `${original.key}.small`, box })
}

for (const [cell, id] of ['sunset-bay', 'night-study', 'star-deck', 'cafe', 'laboratory', 'forest-cabin'].entries()) {
  // Two-pixel gutters in the generated scene sheet are excluded, not painted over.
  const sourceCrop = { left: cell % 3 * 512 + 3, top: Math.floor(cell / 3) * 512 + 3, width: 506, height: 506 }
  const recipe = { key: `scene/${id}`, source: 'polish-scenes.png', sourceCrop,
    box: [0, 0, 1024, 1024], trim: false, quality: 82 }
  polishRecipes.push(recipe, { ...recipe, key: `${recipe.key}.small`, simplify: 12 })
}
for (const [cell, id] of ['epic', 'legendary'].entries()) polishRecipes.push({ key: `fx/${id}`,
  source: 'polish-fx.png', grid: [2, 1], cell, trim: false, box: [0, 0, 1024, 1024] })

for (const [cell, [id, box]] of [
  ['sealed', [108, 82, 296, 358]], ['glowing', [108, 82, 296, 358]],
  ['open', [108, 34, 296, 406]], ['glow', [41, 41, 430, 430]]
].entries()) polishRecipes.push({ key: `container/bottle-${id}`, source: 'polish-bottles.png',
  grid: [2, 2], cell, box, canvas: 512, tiers: [96, 256, 512] })
polishRecipes.push({ key: 'card/back', source: 'polish-card-back.png', canvas: 512,
  tiers: [128, 256, 512], trim: false, box: [0, 0, 512, 512], quality: 82 })
