/** Pure avatar metadata shared by the runtime and renderer; never imports image files. */
export type KunAvatarLabel = { zh: string; en: string }
export type KunAvatarCrest = 'normal' | 'tucked' | 'hidden'
export type KunAvatarAccessoryCategory = 'headwear' | 'glasses' | 'outfit' | 'prop'
export type KunAvatarExclusion = `${KunAvatarAccessoryCategory}:${string}`
export type KunAvatarAccessoryMetadata = {
  crest: KunAvatarCrest
  hidesCrest: boolean
  hasBack: boolean
  excludes: readonly KunAvatarExclusion[]
}

function accessory<const Id extends string>(id: Id, zh: string, en: string,
  options: Partial<Omit<KunAvatarAccessoryMetadata, 'hidesCrest'>> = {}) {
  const crest = options.crest ?? 'normal'
  return { id, label: { zh, en }, crest, hidesCrest: crest === 'hidden',
    hasBack: options.hasBack ?? false, excludes: options.excludes ?? [] }
}

export const KUN_AVATAR_CATALOG = {
  color: [
    { id: 'sky', label: { zh: '天空蓝', en: 'Sky' }, hex: '#95cbf6' },
    { id: 'teal', label: { zh: '薄荷青', en: 'Teal' }, hex: '#7cdadb' },
    { id: 'periwinkle', label: { zh: '蓝紫', en: 'Periwinkle' }, hex: '#a6c1fc' },
    { id: 'mint', label: { zh: '青绿', en: 'Mint' }, hex: '#79d1cb' }
  ],
  face: [
    { id: 'normal', label: { zh: '默认', en: 'Default' } },
    { id: 'happy', label: { zh: '眯眼笑', en: 'Happy' } }
  ],
  headwear: [
    accessory('headset', '带麦耳机', 'Headset'),
    accessory('detective-hat', '侦探帽', 'Detective hat', { crest: 'tucked' }),
    accessory('beret', '贝雷帽', 'Beret', { crest: 'tucked' }),
    accessory('hard-hat', '安全帽', 'Hard hat', { crest: 'hidden' }),
    accessory('baseball-cap', '鸭舌帽', 'Baseball cap', { crest: 'hidden' }),
    accessory('astronaut-helmet', '宇航头盔', 'Space helmet',
      { crest: 'hidden', hasBack: true, excludes: ['glasses:*'] }),
    accessory('pilot-cap', '飞行帽', 'Pilot cap', { crest: 'hidden' }),
    accessory('sailor-hat', '水手帽', 'Sailor hat', { crest: 'tucked' }),
    accessory('headphones', '头戴式耳机', 'Headphones'),
    accessory('straw-hat', '草帽', 'Straw hat', { crest: 'hidden' }),
    accessory('chef-hat', '厨师帽', 'Chef hat', { crest: 'hidden' }),
    accessory('nurse-cap', '护士帽', 'Nurse cap', { crest: 'tucked' }),
    accessory('sports-headband', '运动头带', 'Sports headband'),
    accessory('beanie', '毛线帽', 'Beanie', { crest: 'hidden' }),
    accessory('hood', '兜帽', 'Hood', { crest: 'hidden', hasBack: true }),
    accessory('wizard-hat', '巫师帽', 'Wizard hat', { crest: 'hidden' }),
    accessory('newsboy-cap', '报童帽', 'Newsboy cap', { crest: 'hidden' }),
    accessory('welding-goggles', '额头护目镜', 'Welding goggles'),
    accessory('laurel', '桂冠', 'Laurel wreath')
  ],
  glasses: [
    accessory('square', '方框眼镜', 'Square glasses'),
    accessory('round', '圆框金边眼镜', 'Round gold glasses'),
    accessory('lab', '实验护目镜', 'Lab goggles'),
    accessory('rectangular', '长方框眼镜', 'Rectangular glasses'),
    accessory('cat-eye', '猫眼眼镜', 'Cat-eye glasses')
  ],
  outfit: [
    accessory('black-hoodie', '黑色卫衣', 'Black hoodie'),
    accessory('mint-hoodie', '薄荷卫衣', 'Mint hoodie'),
    accessory('cream-shirt', '米色衬衫', 'Cream shirt'),
    accessory('cardigan', '开衫', 'Cardigan'),
    accessory('lab-coat', '实验服', 'Lab coat'),
    accessory('security-jacket', '安保夹克', 'Security jacket'),
    accessory('blue-scarf', '蓝围巾', 'Blue scarf'),
    accessory('red-scarf', '红围巾', 'Red scarf'),
    accessory('cream-scarf', '米色围巾', 'Cream scarf'),
    accessory('night-scarf', '月亮围巾', 'Night scarf'),
    accessory('spacesuit', '宇航服', 'Spacesuit'),
    accessory('pilot-jacket', '飞行夹克', 'Pilot jacket'),
    accessory('sailor-shirt', '水手服', 'Sailor shirt'),
    accessory('overalls', '背带裤', 'Overalls'),
    accessory('chef-coat', '厨师服', 'Chef coat'),
    accessory('nurse-uniform', '护士服', 'Nurse uniform'),
    accessory('camera-shirt', '相机背带衬衫', 'Camera shirt'),
    accessory('sports-vest', '运动背心', 'Sports vest'),
    accessory('storyteller-cape', '故事家披风', 'Storyteller cape', { hasBack: true }),
    accessory('wizard-cape', '魔法师披风', 'Wizard cape', { hasBack: true }),
    accessory('coffee-apron', '咖啡围裙', 'Coffee apron'),
    accessory('tool-apron', '工具围裙', 'Tool apron'),
    accessory('mailbag', '邮差包', 'Mailbag'),
    accessory('robe', '长袍', 'Robe')
  ],
  prop: [
    accessory('magnifier', '放大镜', 'Magnifier'),
    accessory('paintbrush', '画笔', 'Paintbrush'),
    accessory('flask', '烧瓶', 'Flask'),
    accessory('quill', '羽毛笔', 'Quill'),
    accessory('notebook', '笔记本', 'Notebook'),
    accessory('wrench', '扳手', 'Wrench'),
    accessory('book', '书', 'Book'),
    accessory('leaf', '树叶', 'Leaf'),
    accessory('camera', '相机', 'Camera')
  ]
} as const

export type KunAvatarColor = (typeof KUN_AVATAR_CATALOG.color)[number]['id']
export type KunAvatarFace = (typeof KUN_AVATAR_CATALOG.face)[number]['id']
export type KunAvatarHeadwear = (typeof KUN_AVATAR_CATALOG.headwear)[number]['id']
export type KunAvatarGlasses = (typeof KUN_AVATAR_CATALOG.glasses)[number]['id']
export type KunAvatarOutfit = (typeof KUN_AVATAR_CATALOG.outfit)[number]['id']
export type KunAvatarProp = (typeof KUN_AVATAR_CATALOG.prop)[number]['id']
export type KunAvatarParts = {
  color: KunAvatarColor
  face: KunAvatarFace
  headwear?: KunAvatarHeadwear
  glasses?: KunAvatarGlasses
  outfit?: KunAvatarOutfit
  prop?: KunAvatarProp
  bg: string
}
export type KunAvatarCategory = keyof KunAvatarParts
export type KunComposedAvatarReference = { kind: 'composed'; version: 1; parts: KunAvatarParts }

export const KUN_AVATAR_DEFAULT_PARTS: Readonly<KunAvatarParts> = {
  color: 'sky', face: 'normal', bg: '#f7f5ef'
}
export const KUN_AVATAR_ACCESSORY_CATEGORIES = ['headwear', 'glasses', 'outfit', 'prop'] as const

/** Omit absent slots and normalize background case for stable persistence/cache keys. */
export function normalizeKunAvatarParts(parts: Partial<KunAvatarParts> = {}): KunAvatarParts {
  return {
    color: parts.color ?? KUN_AVATAR_DEFAULT_PARTS.color,
    face: parts.face ?? KUN_AVATAR_DEFAULT_PARTS.face,
    ...(parts.headwear ? { headwear: parts.headwear } : {}),
    ...(parts.glasses ? { glasses: parts.glasses } : {}),
    ...(parts.outfit ? { outfit: parts.outfit } : {}),
    ...(parts.prop ? { prop: parts.prop } : {}),
    bg: (parts.bg ?? KUN_AVATAR_DEFAULT_PARTS.bg).toLowerCase()
  }
}

export type KunAvatarConflict = { categories: readonly [KunAvatarAccessoryCategory, KunAvatarAccessoryCategory] }
export function getKunAvatarConflicts(parts: KunAvatarParts): KunAvatarConflict[] {
  const conflicts: KunAvatarConflict[] = []
  for (const [index, category] of KUN_AVATAR_ACCESSORY_CATEGORIES.entries()) {
    const part = KUN_AVATAR_CATALOG[category].find((entry) => entry.id === parts[category])
    if (!part) continue
    for (const otherCategory of KUN_AVATAR_ACCESSORY_CATEGORIES.slice(index + 1)) {
      const other = KUN_AVATAR_CATALOG[otherCategory].find((entry) => entry.id === parts[otherCategory])
      if (!other) continue
      const matches = (rules: readonly KunAvatarExclusion[], slot: KunAvatarAccessoryCategory, id: string) =>
        rules.some((rule) => rule === `${slot}:*` || rule === `${slot}:${id}`)
      if (matches(part.excludes, otherCategory, other.id) || matches(other.excludes, category, part.id)) {
        conflicts.push({ categories: [category, otherCategory] })
      }
    }
  }
  return conflicts
}

/** The user's newly selected accessory wins, regardless of which slot declares the rule. */
export function updateKunAvatarPart<Category extends KunAvatarCategory>(parts: KunAvatarParts,
  category: Category, value: KunAvatarParts[Category]): { parts: KunAvatarParts; removed: KunAvatarAccessoryCategory[] } {
  const next = normalizeKunAvatarParts({ ...parts, [category]: value })
  const removed: KunAvatarAccessoryCategory[] = []
  for (const conflict of getKunAvatarConflicts(next)) {
    const other = conflict.categories.find((slot) => slot !== category)
    if (other && conflict.categories.some((slot) => slot === category)) {
      delete next[other]
      removed.push(other)
    }
  }
  return { parts: next, removed }
}

export function randomKunAvatarParts(random: () => number = Math.random): KunAvatarParts {
  const pick = <Value>(choices: readonly Value[]): Value =>
    choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))]!
  let parts = normalizeKunAvatarParts({ color: pick(KUN_AVATAR_CATALOG.color).id,
    face: pick(KUN_AVATAR_CATALOG.face).id })
  for (const category of KUN_AVATAR_ACCESSORY_CATEGORIES) {
    const id = pick([undefined, ...KUN_AVATAR_CATALOG[category].map((part) => part.id)])
    parts = updateKunAvatarPart(parts, category, id).parts
  }
  return parts
}

export function canonicalKunAvatarKey(parts: KunAvatarParts): string {
  const normalized = normalizeKunAvatarParts(parts)
  return JSON.stringify([normalized.color, normalized.face, normalized.headwear ?? null,
    normalized.glasses ?? null, normalized.outfit ?? null, normalized.prop ?? null, normalized.bg])
}

/** Stable, full-canvas layer keys used by both the renderer and asset QA tooling. */
export function kunAvatarLayerKeys(parts: KunAvatarParts): string[] {
  const headwear = KUN_AVATAR_CATALOG.headwear.find((part) => part.id === parts.headwear)
  const outfit = KUN_AVATAR_CATALOG.outfit.find((part) => part.id === parts.outfit)
  const crest = headwear?.crest ?? 'normal'
  return [
    outfit?.hasBack ? `outfit/${outfit.id}.back` : '',
    headwear?.hasBack ? `headwear/${headwear.id}.back` : '',
    crest === 'hidden' ? '' : `crest/${crest === 'tucked' ? 'tucked-' : ''}${parts.color}`,
    `base/${parts.color}`, `face/${parts.face}`,
    parts.outfit ? `outfit/${parts.outfit}` : '',
    parts.glasses ? `glasses/${parts.glasses}` : '',
    parts.headwear ? `headwear/${parts.headwear}` : '',
    parts.prop ? `prop/${parts.prop}` : '',
    parts.prop ? `wing/${parts.color}` : ''
  ].filter(Boolean)
}
