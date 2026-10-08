import { wornRecipes } from './kun-avatar-worn-recipes.mjs'

// V2 F2/F3 generated icon extraction only. Keep natural painted aspect ratios.
export const v2ClothingRecipes = []
function icons(source, entries, family = 'outfit') {
  for (const [id, left, top, width, height] of entries) v2ClothingRecipes.push({
    key: `icon/${family}/${id}`, source,
    sourceCrop: { left, top, width, height },
    canvas: 512, tiers: [128, 256], box: [41, 41, 430, 430], fit: 'contain'
  })
}
icons('v2-icons-clothes-a.png', [
  ["black-hoodie",94,20,380,443],
  ["mint-hoodie",547,83,457,374],
  ["cardigan",107,500,375,461],
  ["security-jacket",975,567,547,320]
])
icons('v2-icons-clothes-b.png', [
  ["spacesuit",100,123,382,297],
  ["sailor-shirt",1096,132,340,324],
  ["overalls",137,550,289,340],
  ["chef-coat",627,545,289,356],
  ["nurse-uniform",1121,589,320,281]
])
icons('v2-icons-clothes-c.png', [
  ["wizard-cape",19,216,431,396],
  ["coffee-apron",468,103,332,519],
  ["tool-apron",825,319,377,282]
])
icons('v2-icons-clothes-d.png', [
  ["red-scarf",42,63,425,406],
  ["cream-scarf",522,192,493,170],
  ["night-scarf",1092,45,403,432],
  ["camera-shirt",56,532,400,424],
  ["sports-vest",621,538,290,421],
  ["storyteller-cape",985,585,537,339]
])
// F2 keeps the existing mailbag; the extra generated sheet cell is unused.
icons('v2-icons-clothes-refined.png', [
  ['lab-coat', 265, 46, 274, 624],
  ['pilot-jacket', 832, 160, 506, 418],
  ['blue-scarf', 1620, 46, 296, 623]
])
icons('v2-icons-clothes-hats.png', [
  ['sailor-hat', 78, 228, 798, 480],
  ['nurse-cap', 987, 265, 711, 434]
], 'headwear')
icons('v2-icons-clothes-refined-2.png', [
  ['robe', 42, 110, 752, 808]
])
icons('v2-icon-cream-shirt.png', [
  ['cream-shirt', 155, 198, 945, 878]
])

// Material-only second pass keeps the approved F2 poses and crop registration.
for (const [id, sheet] of [
  ['security-jacket', 'a'], ['spacesuit', 'b'], ['nurse-uniform', 'b'],
  ['night-scarf', 'd'], ['lab-coat', 'refined']
]) {
  v2ClothingRecipes.find((recipe) => recipe.key === `icon/outfit/${id}`).source =
    `v2-icons-clothes-${sheet}-materials.png`
}

// F3 material edits retain the original wearable crop, neck seam and 1024px box.
// F12's pale inner spacesuit neck is baked into the material edit, not painted in code.
for (const [sheet, ids] of [
  ['a', ['lab-coat', 'security-jacket', 'night-scarf']],
  ['b', ['spacesuit', 'pilot-jacket', 'nurse-uniform', 'storyteller-cape']],
  ['c', ['wizard-cape', 'robe']]
]) {
  for (const id of ids) {
    const original = wornRecipes.find((recipe) => recipe.key === `outfit/${id}`)
    v2ClothingRecipes.push({ ...original, source: `v2-worn-materials-${sheet}.png` })
  }
}
Object.assign(v2ClothingRecipes.find((recipe) => recipe.key === 'outfit/night-scarf'), {
  source: 'v2-worn-materials-a-knit.png'
})
