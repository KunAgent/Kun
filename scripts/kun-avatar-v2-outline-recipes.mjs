// F6 local ImageGen contour repairs; retain each wearing layer's original registration.
export const v2OutlineRecipes = [
  { key: 'headwear/beret', source: 'v2-outline-repairs.png',
    sourceCrop: { left: 40, top: 221, width: 748, height: 285 },
    box: [140, 142, 720, 263] },
  { key: 'glasses/square', source: 'v2-outline-square-refined.png',
    sourceCrop: { left: 203, top: 104, width: 1634, height: 566 },
    box: [173, 476, 678, 250] },
  { key: 'prop/quill', source: 'v2-outline-quill-refined.png',
    sourceCrop: { left: 60, top: 76, width: 934, height: 1364 },
    box: [732, 620, 260, 380] }
]
