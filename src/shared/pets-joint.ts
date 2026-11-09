/** Declarative anchors in a 192 x 208 sprite cell; nothing executable in pet packages. */
export type PetRigPoint = [number, number]
export type PetRigArm = { shoulder: PetRigPoint; hand: PetRigPoint; radius: number }
export type PetJointRig = {
  version: 1
  row: number
  blink: number[]
  ground: number
  head: PetRigPoint
  arms: [PetRigArm, PetRigArm]
  feet: [PetRigPoint, PetRigPoint]
}

export const PET_JOINT_SCENE_IDS = ['bubbles', 'beatbox', 'dance', 'cheer'] as const
export type PetJointSceneId = typeof PET_JOINT_SCENE_IDS[number]

export function jointSceneFor(value: string): PetJointSceneId {
  if (['beatbox', 'race', 'chase', 'debug'].includes(value)) return 'beatbox'
  if (['dance', 'circle-dance', 'conga', 'high-five', 'wave-relay', 'exercise', 'welcome', 'finale'].includes(value)) return 'dance'
  if (['cheer', 'leapfrog', 'gift', 'orchestra', 'coding', 'brainstorm', 'review'].includes(value)) return 'cheer'
  return 'bubbles'
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const point = (v: unknown): v is PetRigPoint => Array.isArray(v) && v.length === 2 && v.every((n) => number(n, .04, .96))

export function parsePetJointRig(value: unknown): PetJointRig | null {
  if (!record(value) || value.version !== 1 || !Number.isInteger(value.row) || !number(value.row, 0, 8) ||
    !Array.isArray(value.blink) || value.blink.length !== 6 || !value.blink.every((n) => number(n, 0, 7) && Number.isInteger(n)) ||
    !number(value.ground, .8, .98) || !point(value.head) || !Array.isArray(value.arms) || value.arms.length !== 2 ||
    !Array.isArray(value.feet) || value.feet.length !== 2 || !value.feet.every(point)) return null
  const arms: PetRigArm[] = []
  for (const arm of value.arms) {
    if (!record(arm) || !point(arm.shoulder) || !point(arm.hand) || !number(arm.radius, .018, .18)) return null
    if (Math.hypot(arm.shoulder[0] - arm.hand[0], arm.shoulder[1] - arm.hand[1]) < .04) return null
    arms.push({ shoulder: [...arm.shoulder], hand: [...arm.hand], radius: arm.radius })
  }
  return { version: 1, row: value.row, blink: [...value.blink], ground: value.ground,
    head: [...value.head], arms: arms as PetJointRig['arms'], feet: value.feet.map((p) => [...p]) as PetJointRig['feet'] }
}
