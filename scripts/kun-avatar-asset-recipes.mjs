// Bounds are calibrated in the final 1024px coordinate system. Generated art is never redrawn.
export const avatarRecipes = [
  { key: 'base/sky', source: 'body.png', sourceCrop: { left: 0, top: 0, width: 1254, height: 1224 }, box: [64, 190, 896, 834] },
  { key: 'face/normal', source: 'features.png', grid: [2, 2], cell: 0, box: [182, 466, 660, 330] },
  { key: 'face/happy', source: 'features.png', grid: [2, 2], cell: 1, box: [182, 549, 660, 247] },
  { key: 'crest/sky', source: 'features.png', grid: [2, 2], cell: 2, box: [430, 34, 260, 222] },
  { key: 'crest/tucked-sky', source: 'features.png', grid: [2, 2], cell: 2, box: [546, 89, 195, 167] },
  { key: 'wing/sky', source: 'features.png', grid: [2, 2], cell: 3, box: [742, 832, 160, 168] },
  { key: 'headwear/headset', source: 'accessories.png', grid: [3, 3], cell: 0, box: [54, 179, 916, 650] },
  { key: 'headwear/headphones', source: 'accessories.png', grid: [3, 3], cell: 1, box: [54, 179, 916, 620] },
  { key: 'glasses/square', source: 'accessories.png', grid: [3, 3], cell: 2, box: [173, 476, 678, 250] },
  { key: 'glasses/round', source: 'accessories.png', sourceCrop: { left: 0, top: 470, width: 418, height: 340 }, box: [173, 467, 678, 266] },
  { key: 'glasses/lab', source: 'accessories.png', sourceCrop: { left: 418, top: 470, width: 418, height: 340 }, box: [148, 458, 728, 280] },
  { key: 'glasses/rectangular', source: 'accessories.png', sourceCrop: { left: 836, top: 470, width: 418, height: 340 }, box: [173, 492, 678, 230] },
  { key: 'glasses/cat-eye', source: 'accessories.png', grid: [3, 3], cell: 6, box: [164, 463, 696, 270] },
  { key: 'outfit/blue-scarf', source: 'accessories.png', grid: [3, 3], cell: 7, box: [156, 806, 712, 218] }
]

function sheet(source, entries, rowCuts = [0, 418, 836, 1254], columnCuts = [0, 418, 836, 1254]) {
  for (const [cell, [key, box]] of entries.entries()) {
    const col = cell % 3, row = Math.floor(cell / 3)
    avatarRecipes.push({ key, source: `${source}.png`, box,
      sourceCrop: { left: columnCuts[col], top: rowCuts[row],
        width: columnCuts[col + 1] - columnCuts[col], height: rowCuts[row + 1] - rowCuts[row] } })
  }
}

sheet('hats-a', [
  ['headwear/detective-hat', [120, 125, 784, 320]],
  ['headwear/beret', [140, 142, 720, 263]],
  ['headwear/hard-hat', [94, 78, 836, 354]],
  ['headwear/baseball-cap', [95, 145, 820, 305]],
  ['headwear/pilot-cap', [104, 165, 816, 558]],
  ['headwear/sailor-hat', [160, 170, 716, 280]],
  ['headwear/straw-hat', [32, 130, 960, 350]],
  ['headwear/chef-hat', [144, 20, 736, 426]],
  ['headwear/nurse-cap', [185, 161, 654, 305]]
], [0, 453, 831, 1254], [0, 439, 824, 1254])
sheet('hats-b', [
  ['headwear/sports-headband', [150, 302, 724, 131]],
  ['headwear/beanie', [137, 35, 750, 395]],
  ['headwear/hood', [44, 113, 936, 798]],
  ['headwear/wizard-hat', [20, 6, 984, 483]],
  ['headwear/newsboy-cap', [117, 164, 790, 288]],
  ['headwear/welding-goggles', [160, 289, 704, 208]],
  ['headwear/laurel', [125, 165, 774, 339]],
  ['headwear/astronaut-helmet', [31, 153, 962, 738]]
], [0, 459, 812, 1254])
// Avoid the neighboring chef-hat / wizard-brim tips in the generated sheet gutters.
Object.assign(avatarRecipes.find((recipe) => recipe.key === 'headwear/nurse-cap'),
  { sourceCrop: { left: 836, top: 856, width: 418, height: 398 } })
Object.assign(avatarRecipes.find((recipe) => recipe.key === 'headwear/newsboy-cap'),
  { sourceCrop: { left: 438, top: 530, width: 391, height: 271 } })

sheet('clothes-a', [
  ['outfit/black-hoodie', [73, 812, 878, 212]],
  ['outfit/mint-hoodie', [73, 812, 878, 212]],
  ['outfit/cream-shirt', [73, 812, 878, 212]],
  ['outfit/cardigan', [73, 812, 878, 212]],
  ['outfit/lab-coat', [73, 812, 878, 212]],
  ['outfit/security-jacket', [73, 812, 878, 212]],
  ['outfit/red-scarf', [156, 806, 712, 218]],
  ['outfit/cream-scarf', [156, 806, 712, 218]],
  ['outfit/night-scarf', [156, 806, 712, 218]]
], [0, 449, 824, 1254], [0, 437, 831, 1254])
sheet('clothes-b', [
  ['outfit/spacesuit', [65, 806, 894, 218]],
  ['outfit/pilot-jacket', [73, 812, 878, 212]],
  ['outfit/sailor-shirt', [73, 812, 878, 212]],
  ['outfit/overalls', [73, 812, 878, 212]],
  ['outfit/chef-coat', [73, 812, 878, 212]],
  ['outfit/nurse-uniform', [73, 812, 878, 212]],
  ['outfit/camera-shirt', [73, 812, 878, 212]],
  ['outfit/sports-vest', [104, 812, 816, 212]],
  ['outfit/storyteller-cape', [65, 812, 894, 212]]
])
// The shirt was regenerated without an embedded camera so the prop remains independent.
Object.assign(avatarRecipes.find((recipe) => recipe.key === 'outfit/camera-shirt'),
  { source: 'camera-shirt.png', sourceCrop: undefined, grid: [1, 1], cell: 0 })
sheet('clothes-c', [
  ['outfit/wizard-cape', [65, 812, 894, 212]],
  ['outfit/coffee-apron', [162, 812, 700, 212]],
  ['outfit/tool-apron', [162, 812, 700, 212]],
  ['outfit/mailbag', [254, 808, 625, 216]],
  ['outfit/robe', [73, 812, 878, 212]],
  ['outfit/storyteller-cape.back', [26, 803, 972, 221]],
  ['outfit/wizard-cape.back', [26, 803, 972, 221]],
  ['headwear/astronaut-helmet.back', [31, 153, 962, 738]],
  ['headwear/hood.back', [44, 113, 936, 798]]
], [0, 458, 830, 1254], [0, 439, 826, 1254])

sheet('props', [
  ['prop/magnifier', [714, 635, 288, 352]],
  ['prop/paintbrush', [740, 630, 220, 370]],
  ['prop/flask', [737, 730, 250, 294]],
  ['prop/quill', [732, 620, 260, 380]],
  ['prop/notebook', [706, 752, 276, 272]],
  ['prop/wrench', [739, 650, 241, 350]],
  ['prop/book', [704, 752, 290, 272]],
  ['prop/leaf', [724, 645, 272, 360]],
  ['prop/camera', [688, 790, 318, 234]]
], [0, 451, 839, 1254])

for (const [column, color] of ['teal', 'periwinkle', 'mint'].entries()) {
  const sourceCrop = (top, height) => ({ left: column * 418, top, width: 418, height })
  avatarRecipes.push(
    { key: `base/${color}`, source: 'color-variants.png', sourceCrop: sourceCrop(0, 539), box: [64, 190, 896, 834] },
    { key: `crest/${color}`, source: 'color-variants.png', sourceCrop: sourceCrop(568, 331), box: [430, 34, 260, 222] },
    { key: `crest/tucked-${color}`, source: 'color-variants.png', sourceCrop: sourceCrop(568, 331), box: [546, 89, 195, 167] },
    { key: `wing/${color}`, source: 'color-variants.png', sourceCrop: sourceCrop(920, 334), box: [742, 832, 160, 168] }
  )
}
