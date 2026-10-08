// ImageGen chest overlays; register one scale only and let the avatar canvas clip.
// Rows intentionally end in continuing fabric rather than a miniature garment hem.
// A few pixels of lower overscan keep the source's antialiased cut below the final canvas.
export const outfitBustRecipes = [
  { key: 'outfit/lab-coat', source: 'alignment-bust-clinical.png',
    sourceCrop: { left: 0, top: 0, width: 1536, height: 512 },
    registration: { left: 10, top: 758, width: 1004 } },
  { key: 'outfit/nurse-uniform', source: 'alignment-bust-clinical.png',
    sourceCrop: { left: 0, top: 512, width: 1536, height: 512 },
    registration: { left: 0, top: 756, width: 1024 } },
  { key: 'outfit/security-jacket', source: 'alignment-bust-uniform.png',
    sourceCrop: { left: 0, top: 0, width: 1536, height: 512 },
    registration: { left: 20, top: 748, width: 984 } },
  { key: 'outfit/sailor-shirt', source: 'alignment-bust-sailor-repaired.png',
    sourceCrop: { left: 0, top: 512, width: 1536, height: 512 },
    registration: { left: 30, top: 744, width: 964 } },
  { key: 'outfit/spacesuit', source: 'alignment-bust-special.png',
    sourceCrop: { left: 0, top: 0, width: 1536, height: 512 },
    registration: { left: 15, top: 752, width: 994 } },
  { key: 'outfit/coffee-apron', source: 'alignment-bust-special.png',
    sourceCrop: { left: 0, top: 512, width: 1536, height: 512 },
    registration: { left: 35, top: 750, width: 954 } }
]
