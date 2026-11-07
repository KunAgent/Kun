import type { BuiltinPetId } from '@shared/pets-builtin'
import { PET_SCENE_IDS, type PetSceneId } from '@shared/pets-ensemble'
import { jointSceneFor, type PetJointSceneId } from '@shared/pets-joint'

type SceneDefinition = { title: [string, string]; story: [string, string]; duration: number }
export const PET_JOINT_SCENES: Record<PetJointSceneId, SceneDefinition> = {
  bubbles: { title: ['一起托起大泡泡', 'Lift a bubble together'], duration: 14000,
    story: ['DS 召来泡泡，伙伴伸手一起托住、蓄力、放飞', 'DS calls a bubble; the friends cradle, lift and release it together'] },
  beatbox: { title: ['默契接传球', 'Catch and return'], duration: 14000,
    story: ['根据来球一起转身、伸手，接球的重量带动身体缓冲', 'Turn toward the ball, reach, cushion the catch and return the pass'] },
  dance: { title: ['牵手小舞步', 'Hand-in-hand dance'], duration: 12000,
    story: ['先牵住彼此，再借着对方的力量交换舞步、一起鞠躬', 'Join hands, share the balance, exchange steps and bow together'] },
  cheer: { title: ['一起弹起小星星', 'Bounce a star together'], duration: 14000,
    story: ['一起抓住软垫，接住星星后共同下蹲、将它弹起', 'Hold a soft blanket, catch a star, crouch and launch it together'] }
}

// Old scene names are still readable in imported packages and saved settings.
export const PET_SCENES = Object.fromEntries(PET_SCENE_IDS.map((id) => [id, PET_JOINT_SCENES[jointSceneFor(id)]])) as Record<PetSceneId, SceneDefinition>
export const PET_SCENE_DIRECTORS: Partial<Record<PetSceneId, BuiltinPetId>> = { bubbles: 'whale-girl', beatbox: 'ikun' }
export function petEnsembleText(text: [string, string], language: string): string {
  return text[language.toLowerCase().startsWith('zh') ? 0 : 1]
}
