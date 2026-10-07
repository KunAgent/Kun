import { normalizeKunAvatarParts, type KunAvatarParts } from './kun-avatar-catalog.js'

export const ROOM_BUILTIN_AVATAR_IDS = ['coordinator', 'coder', 'reviewer', 'detective', 'designer', 'architect',
  'scientist', 'security', 'writer', 'researcher', 'data', 'operations', 'astronaut', 'pilot', 'navigator',
  'librarian', 'musician', 'gardener', 'chef', 'medic', 'photographer', 'athlete', 'explorer', 'storyteller',
  'magician', 'night-thinker', 'barista', 'maker', 'courier', 'strategist'] as const
export type KunAvatarPresetId = (typeof ROOM_BUILTIN_AVATAR_IDS)[number]

function preset(id: KunAvatarPresetId, zh: string, en: string, parts: Partial<KunAvatarParts>) {
  return { id, label: { zh, en }, parts: normalizeKunAvatarParts(parts) }
}

export const KUN_AVATAR_PRESETS = [
  preset('coordinator', '协调员', 'Coordinator', { headwear: 'headset' }),
  preset('coder', '程序员', 'Coder', { color: 'teal', glasses: 'square', outfit: 'black-hoodie' }),
  preset('reviewer', '评审员', 'Reviewer', { color: 'periwinkle', glasses: 'round', outfit: 'cream-shirt' }),
  preset('detective', '侦探', 'Detective', { headwear: 'detective-hat', prop: 'magnifier' }),
  preset('designer', '设计师', 'Designer', { color: 'mint', headwear: 'beret', prop: 'paintbrush' }),
  preset('architect', '架构师', 'Architect', { headwear: 'hard-hat', outfit: 'blue-scarf' }),
  preset('scientist', '科学家', 'Scientist', { color: 'teal', glasses: 'lab', outfit: 'lab-coat', prop: 'flask' }),
  preset('security', '安全专家', 'Security', { color: 'periwinkle', outfit: 'security-jacket' }),
  preset('writer', '作家', 'Writer', { outfit: 'red-scarf', prop: 'quill' }),
  preset('researcher', '研究员', 'Researcher', { color: 'teal', glasses: 'round', prop: 'notebook' }),
  preset('data', '数据分析师', 'Data analyst', { color: 'periwinkle', glasses: 'rectangular', outfit: 'mint-hoodie' }),
  preset('operations', '运维工程师', 'Operations', { headwear: 'baseball-cap', prop: 'wrench' }),
  preset('astronaut', '宇航员', 'Astronaut', { headwear: 'astronaut-helmet', outfit: 'spacesuit' }),
  preset('pilot', '飞行员', 'Pilot', { color: 'teal', headwear: 'pilot-cap', outfit: 'pilot-jacket' }),
  preset('navigator', '领航员', 'Navigator', { headwear: 'sailor-hat', outfit: 'sailor-shirt' }),
  preset('librarian', '图书管理员', 'Librarian', { color: 'periwinkle', glasses: 'cat-eye', outfit: 'cardigan', prop: 'book' }),
  preset('musician', '音乐家', 'Musician', { face: 'happy', headwear: 'headphones' }),
  preset('gardener', '园艺师', 'Gardener', { color: 'mint', headwear: 'straw-hat', outfit: 'overalls', prop: 'leaf' }),
  preset('chef', '厨师', 'Chef', { headwear: 'chef-hat', outfit: 'chef-coat' }),
  preset('medic', '医护员', 'Medic', { color: 'teal', headwear: 'nurse-cap', outfit: 'nurse-uniform' }),
  preset('photographer', '摄影师', 'Photographer', { color: 'periwinkle', outfit: 'camera-shirt', prop: 'camera' }),
  preset('athlete', '运动员', 'Athlete', { headwear: 'sports-headband', outfit: 'sports-vest' }),
  preset('explorer', '探险家', 'Explorer', { face: 'happy', headwear: 'beanie', outfit: 'cream-scarf' }),
  preset('storyteller', '故事家', 'Storyteller', { color: 'teal', headwear: 'hood', outfit: 'storyteller-cape' }),
  preset('magician', '魔法师', 'Magician', { color: 'periwinkle', headwear: 'wizard-hat', outfit: 'wizard-cape' }),
  preset('night-thinker', '夜间思考者', 'Night thinker', { outfit: 'night-scarf' }),
  preset('barista', '咖啡师', 'Barista', { color: 'mint', face: 'happy', headwear: 'newsboy-cap', outfit: 'coffee-apron' }),
  preset('maker', '创客', 'Maker', { color: 'periwinkle', headwear: 'welding-goggles', outfit: 'tool-apron' }),
  preset('courier', '信使', 'Courier', { headwear: 'baseball-cap', outfit: 'mailbag' }),
  preset('strategist', '策略师', 'Strategist', { color: 'mint', headwear: 'laurel', outfit: 'robe' })
] as const
