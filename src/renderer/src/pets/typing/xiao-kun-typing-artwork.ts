import type { PetRigPoint } from '@shared/pets-joint'
import type { ArmCutouts } from '../joint/arm-layer'

const uv = (x: number, y: number): PetRigPoint => [x / 192, y / 208]
// Row 7 contains the actual blue working wing. The cream/gold shape in idle
// belongs to the character's decoration and must not become a giant typing hand.
const wing = [[118, 147], [122, 149], [125, 153], [129, 158], [128, 162], [123, 166],
  [114, 172], [107, 176], [101, 176], [98, 173], [97, 169], [94, 171], [91, 172],
  [87, 169], [86, 165], [88, 160], [93, 155], [101, 151], [109, 148]]
const placed = (mirror: boolean): PetRigPoint[] => wing.map(([x, y]) => uv(mirror ? 171 - x : x + 21, y - 26))
const oldLeftWing = [[28, 122], [27, 130], [27, 140], [30, 153], [31, 166],
  [0, 166], [0, 122]].map(([x, y]) => uv(x, y))

export const XIAO_KUN_TYPING_ARTWORK: {
  shoulders: [PetRigPoint, PetRigPoint]; tips: [PetRigPoint, PetRigPoint]; cutouts: ArmCutouts
} = {
  shoulders: [uv(47, 128), uv(145, 128)], tips: [uv(71, 148), uv(121, 148)],
  cutouts: [
    { scale: 1, contour: placed(true), source: { row: 7, column: 0, offset: uv(21, -26), mirrorX: true },
      eraseContour: oldLeftWing, eraseFrom: 0 },
    { scale: 1, contour: placed(false), source: { row: 7, column: 0, offset: uv(21, -26) }, eraseContour: null }
  ]
}
