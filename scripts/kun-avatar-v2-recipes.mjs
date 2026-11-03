// V2 art: only registration of generated pixels and documented export operations.
export const v2Recipes = ['surprised', 'focused', 'sleepy'].map((id, cell) => ({
  key: `face/${id}`, source: 'v2-faces.png', grid: [3, 1], cell,
  box: id === 'surprised' ? [182, 457, 660, 339] : [182, 467, 660, 329]
}))

// Separate generated star glyphs are registered around the protected face region.
// All boxes stay completely outside faceBox, including their antialiased halos.
const starBoxes = [
  [72, 90, 154, 154], [798, 110, 154, 154], [804, 697, 154, 154],
  [450, 75, 118, 118], [85, 340, 118, 118], [78, 620, 118, 118],
  [820, 460, 118, 118], [175, 882, 118, 118],
  [320, 204, 82, 82], [645, 204, 82, 82], [824, 302, 82, 82], [720, 914, 82, 82]
]
for (const [cell, rarity] of ['epic', 'legendary'].entries()) {
  const sourceCrop = { left: 222 + cell * 887, top: 26, width: 222, height: 222 }
  v2Recipes.push({ key: `fx/${rarity}`, source: 'v2-fx-stars.png',
    fragments: starBoxes.map((box) => ({ sourceCrop, box, trim: false })), box: [0, 0, 1024, 1024] })
  v2Recipes.push({ key: `fx/${rarity}.back`, source: 'v2-fx-back.png', grid: [2, 1], cell,
    box: [92, 140, 840, 840], opacity: 0.45 })
}
for (const [cell, id] of ['sunset-bay', 'night-study', 'star-deck', 'cafe', 'laboratory', 'forest-cabin'].entries()) {
  const sourceCrop = { left: cell % 3 * 512 + 2, top: Math.floor(cell / 3) * 512 + 2, width: 508, height: 508 }
  v2Recipes.push({ key: `scene/${id}.small`, source: 'v2-scenes-small.png', sourceCrop,
    trim: false, simplify: 64, box: [0, 0, 1024, 1024], quality: 82 })
}
// Miniature exports remove source-resolution texture before scaling to the common canvas.
for (const [cell, id] of ['sunset-bay', 'cafe'].entries()) {
  Object.assign(v2Recipes.find((recipe) => recipe.key === `scene/${id}.small`), {
    source: 'v2-scenes-small-refined.png',
    sourceCrop: { left: cell * 887 + 2, top: 2, width: 883, height: 883 }
  })
}

for (const [cell, id] of ['sunset-bay', 'night-study', 'star-deck', 'forest-cabin'].entries()) {
  const sourceCrop = { left: cell % 2 * 768 + 2, top: Math.floor(cell / 2) * 512 + 2, width: 764, height: 508 }
  v2Recipes.push({ key: `scene/${id}`, source: 'v2-scenes.png', sourceCrop,
    trim: false, box: [0, 0, 1024, 1024], quality: 82 })
}
v2Recipes.push({ key: 'container/bottle-glowing', source: 'v2-bottle-glowing.png',
  canvas: 512, tiers: [96, 256, 512], box: [108, 82, 296, 358] })
