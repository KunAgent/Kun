import type { PetJointRig, PetRigPoint } from '@shared/pets-joint'
import type { PetSummary } from '@shared/pets'
import type { ArmCutouts } from '../joint/arm-layer'

const uv = (x: number, y: number): PetRigPoint => [x / 192, y / 208]
const contour = (points: number[][]): PetRigPoint[] => points.map(([x, y]) => uv(x, y))

type TypingArtwork = { shoulders: [PetRigPoint, PetRigPoint]; tips: [PetRigPoint, PetRigPoint]; cutouts: ArmCutouts }
const ARTWORK: Record<string, TypingArtwork> = {
  'kun:xiao-kun': {
    shoulders: [uv(28, 123), uv(141, 128)], tips: [uv(21, 160), uv(151, 166)],
    cutouts: [
      { scale: 1, contour: contour([[29, 119], [29, 130], [28, 140], [30, 152], [26, 159], [19, 161], [14, 157], [11, 150], [13, 140], [19, 130], [25, 123]]) },
      { scale: 1, contour: contour([[139, 123], [149, 122], [156, 127], [161, 138], [163, 155], [161, 163], [156, 168], [145, 169], [132, 165], [123, 158], [120, 151], [124, 149], [130, 141], [132, 132]]) }
    ]
  },
  'kun:ikun': {
    shoulders: [uv(67, 132), uv(126, 132)], tips: [uv(59, 161), uv(135, 161)],
    cutouts: [
      { scale: 1, contour: contour([[64, 128], [70, 132], [71, 145], [68, 155], [63, 162], [56, 161], [51, 155], [49, 145], [54, 136], [59, 131]]) },
      { scale: 1, contour: contour([[122, 132], [127, 128], [133, 132], [139, 140], [144, 149], [141, 157], [137, 162], [131, 162], [127, 153], [124, 143]]) }
    ]
  },
  'kun:whale-girl': {
    shoulders: [uv(79, 132), uv(113, 132)], tips: [uv(70, 143), uv(122, 143)],
    cutouts: [
      { scale: 1.25, contour: contour([[78, 130], [81, 132], [78, 138], [73, 143], [70, 145], [68, 142], [71, 138], [74, 133]]) },
      { scale: 1.25, contour: contour([[111, 132], [114, 130], [118, 135], [122, 139], [124, 142], [122, 145], [119, 143], [115, 138]]) }
    ]
  }
}

export function petTypingCutouts(pet: Pick<PetSummary, 'id'>): ArmCutouts | undefined {
  return ARTWORK[pet.id]?.cutouts
}

/** Contact anchors are at the palm/wing tip, not the middle of the hand. */
export function petTypingRig(pet: Pick<PetSummary, 'id' | 'interactions'>): PetJointRig | undefined {
  const rig = pet.interactions?.joint, artwork = ARTWORK[pet.id]
  if (!rig || !artwork) return rig
  return { ...rig, arms: [0, 1].map((side) => ({ ...rig.arms[side],
    shoulder: artwork.shoulders[side], hand: artwork.tips[side] })) as PetJointRig['arms'] }
}
