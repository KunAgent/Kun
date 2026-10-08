/** Pure avatar metadata shared by the runtime and renderer; never imports image files. */
export type KunAvatarLabel = { zh: string; en: string }
export type KunAvatarRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type KunAvatarCollectible = { rarity: KunAvatarRarity; set: string; flavor: KunAvatarLabel }
export type KunAvatarCrest = 'normal' | 'tucked' | 'hidden'
export type KunAvatarAccessoryCategory = 'headwear' | 'glasses' | 'outfit' | 'prop'
export type KunAvatarExclusion = `${KunAvatarAccessoryCategory}:${string}`
export type KunAvatarAccessoryMetadata = KunAvatarCollectible & {
  crest: KunAvatarCrest
  hidesCrest: boolean
  hasBack: boolean
  excludes: readonly KunAvatarExclusion[]
}

const collectible = (rarity: KunAvatarRarity, set: string, zh: string, en: string): KunAvatarCollectible =>
  ({ rarity, set, flavor: { zh, en } })

const equipment = {
  headset: collectible('common', 'coordinator', '让每个声音都被听见。', 'Every voice has a place.'),
  'detective-hat': collectible('epic', 'detective', '帽檐之下，线索悄悄相连。', 'Clues connect beneath the brim.'),
  beret: collectible('rare', 'designer', '今天也有新的颜色。', 'A new color for a new idea.'),
  'hard-hat': collectible('rare', 'architect', '稳稳托住下一个构想。', 'A solid start for the next idea.'),
  'baseball-cap': collectible('common', 'operations', '随时准备出发。', 'Ready to go at a moment’s notice.'),
  'astronaut-helmet': collectible('legendary', 'astronaut', '把好奇心带到星星之间。', 'Take your curiosity to the stars.'),
  'pilot-cap': collectible('epic', 'pilot', '云层之上，方向依然清楚。', 'A clear course above the clouds.'),
  'sailor-hat': collectible('rare', 'navigator', '听见远方海浪的回信。', 'Hear the answer in distant waves.'),
  headphones: collectible('rare', 'musician', '把灵感调到喜欢的音量。', 'Turn inspiration up to your favorite volume.'),
  'straw-hat': collectible('rare', 'gardener', '留一片阴凉给新芽。', 'A patch of shade for something new.'),
  'chef-hat': collectible('rare', 'chef', '好点子正在慢慢炖煮。', 'Good ideas are simmering.'),
  'nurse-cap': collectible('rare', 'medic', '认真照顾每一个小细节。', 'Care lives in the little details.'),
  'sports-headband': collectible('common', 'athlete', '再往前一步。', 'One more step forward.'),
  beanie: collectible('common', 'explorer', '温暖陪着好奇心上路。', 'Warmth for a curious journey.'),
  hood: collectible('epic', 'storyteller', '藏着还没讲完的故事。', 'There is always another story.'),
  'wizard-hat': collectible('legendary', 'magician', '帽尖收藏着一点星光。', 'A little starlight at the tip.'),
  'newsboy-cap': collectible('common', 'barista', '带着晨间咖啡的香气。', 'A hint of morning coffee.'),
  'welding-goggles': collectible('epic', 'maker', '在火花里找到新办法。', 'Find a new idea in the sparks.'),
  laurel: collectible('legendary', 'strategist', '每片叶子记下一次坚持。', 'Each leaf remembers a little persistence.'),
  square: collectible('common', 'coder', '把复杂问题看清楚。', 'Bring a complex problem into focus.'),
  round: collectible('rare', 'reviewer', '换个角度，也许就有答案。', 'A new perspective may hold the answer.'),
  lab: collectible('epic', 'scientist', '保护眼前的小小发现。', 'Keep a small discovery in sight.'),
  rectangular: collectible('common', 'data', '整齐的线条里也有惊喜。', 'Surprises hide between tidy lines.'),
  'cat-eye': collectible('rare', 'librarian', '书页之间，一眼找到宝藏。', 'Spot a treasure between the pages.'),
  'black-hoodie': collectible('common', 'coder', '舒舒服服，把想法写出来。', 'Settle in and bring an idea to life.'),
  'mint-hoodie': collectible('common', 'data', '给忙碌的一天一点清新。', 'A fresh note for a busy day.'),
  'cream-shirt': collectible('common', 'reviewer', '认真，也可以很柔软。', 'Thoughtfulness can be soft.'),
  cardigan: collectible('rare', 'librarian', '适合翻开下一本书。', 'Just right for the next chapter.'),
  'lab-coat': collectible('epic', 'scientist', '口袋里装着待验证的猜想。', 'Pockets full of hypotheses.'),
  'security-jacket': collectible('epic', 'security', '小小徽章，大大的安心。', 'A small badge, a steady guard.'),
  'blue-scarf': collectible('common', 'architect', '像蓝图一样清楚而轻盈。', 'As clear and light as a blueprint.'),
  'red-scarf': collectible('common', 'writer', '为下一句话添点热情。', 'A warm start to the next sentence.'),
  'cream-scarf': collectible('common', 'explorer', '把旅途的风轻轻收好。', 'Keep the journey’s breeze close.'),
  'night-scarf': collectible('epic', 'night-thinker', '月亮扣住了深夜的灵感。', 'A moon clasp holds a midnight thought.'),
  spacesuit: collectible('legendary', 'astronaut', '下一站，尚未命名的星球。', 'Next stop: a world without a name.'),
  'pilot-jacket': collectible('epic', 'pilot', '飞过的云都记得你。', 'The clouds remember your journey.'),
  'sailor-shirt': collectible('rare', 'navigator', '把海风穿在身上。', 'Carry the sea breeze with you.'),
  overalls: collectible('rare', 'gardener', '口袋里有泥土和希望。', 'Pockets full of soil and hope.'),
  'chef-coat': collectible('rare', 'chef', '红领巾系住一份用心。', 'A red neckerchief, tied with care.'),
  'nurse-uniform': collectible('epic', 'medic', '温柔，也是可靠的力量。', 'Kindness is a steady strength.'),
  'camera-shirt': collectible('rare', 'photographer', '为值得记住的一刻准备。', 'Ready for a moment worth keeping.'),
  'sports-vest': collectible('rare', 'athlete', '轻装出发，尽兴而归。', 'Travel light and enjoy the run.'),
  'storyteller-cape': collectible('legendary', 'storyteller', '每一道褶皱都是故事的开头。', 'Every fold begins another tale.'),
  'wizard-cape': collectible('legendary', 'magician', '星光沿着衣角悄悄流动。', 'Starlight follows every fold.'),
  'coffee-apron': collectible('rare', 'barista', '把日常冲泡得香一点。', 'Brew a little comfort into the day.'),
  'tool-apron': collectible('rare', 'maker', '让双手自由，让想法落地。', 'Free your hands to make an idea real.'),
  mailbag: collectible('rare', 'courier', '装得下远方的好消息。', 'Room for good news from afar.'),
  robe: collectible('epic', 'strategist', '从容地走向下一步。', 'Take the next step with calm.'),
  magnifier: collectible('epic', 'detective', '答案有时只差仔细一看。', 'Sometimes the answer needs a closer look.'),
  paintbrush: collectible('rare', 'designer', '第一笔，世界就不一样了。', 'The first brushstroke changes everything.'),
  flask: collectible('epic', 'scientist', '下一次发现正在冒泡。', 'The next discovery is bubbling up.'),
  quill: collectible('rare', 'writer', '轻轻一划，让故事起飞。', 'A light stroke lets a story take flight.'),
  notebook: collectible('common', 'researcher', '先记下来，灵感会长大。', 'Write it down and let the idea grow.'),
  wrench: collectible('rare', 'operations', '转一转，让事情顺起来。', 'A small turn keeps things running.'),
  book: collectible('common', 'librarian', '一扇可以随身带走的门。', 'A door you can carry with you.'),
  leaf: collectible('common', 'gardener', '小小叶片，也有自己的方向。', 'Even a small leaf finds its way.'),
  camera: collectible('rare', 'photographer', '把此刻留给以后的自己。', 'Save this moment for your future self.')
} satisfies Record<string, KunAvatarCollectible>

function accessory<const Id extends keyof typeof equipment>(id: Id, zh: string, en: string,
  options: Partial<Pick<KunAvatarAccessoryMetadata, 'crest' | 'hasBack' | 'excludes'>> = {}):
  { id: Id; label: KunAvatarLabel } & KunAvatarAccessoryMetadata {
  const crest = options.crest ?? 'normal'
  return { id, label: { zh, en }, ...equipment[id], crest, hidesCrest: crest === 'hidden',
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
    { id: 'happy', label: { zh: '眯眼笑', en: 'Happy' } },
    { id: 'surprised', label: { zh: '惊喜', en: 'Surprised' } },
    { id: 'wink', label: { zh: '眨眼', en: 'Wink' } },
    { id: 'focused', label: { zh: '认真', en: 'Focused' } },
    { id: 'sleepy', label: { zh: '困', en: 'Sleepy' } }
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

export const KUN_AVATAR_SCENES = [
  { id: 'sunset-bay', label: { zh: '海湾日落', en: 'Sunset bay' } },
  { id: 'night-study', label: { zh: '深夜书房', en: 'Night study' } },
  { id: 'star-deck', label: { zh: '星空甲板', en: 'Star deck' } },
  { id: 'cafe', label: { zh: '咖啡馆', en: 'Cafe' } },
  { id: 'laboratory', label: { zh: '实验室', en: 'Laboratory' } },
  { id: 'forest-cabin', label: { zh: '林间小屋', en: 'Forest cabin' } }
] as const
export type KunAvatarScene = (typeof KUN_AVATAR_SCENES)[number]['id']
export const KUN_AVATAR_SMALL_HEADWEAR: readonly string[] = ['wizard-hat', 'beanie', 'headphones', 'hard-hat']
export const KUN_AVATAR_RARITIES: readonly KunAvatarRarity[] = ['common', 'rare', 'epic', 'legendary']
export const KUN_AVATAR_RARITY_LABELS: Record<KunAvatarRarity, KunAvatarLabel> = {
  common: { zh: '普通', en: 'Common' }, rare: { zh: '稀有', en: 'Rare' },
  epic: { zh: '史诗', en: 'Epic' }, legendary: { zh: '传说', en: 'Legendary' }
}

export function kunAvatarScene(bg: string): KunAvatarScene | undefined {
  return KUN_AVATAR_SCENES.find(({ id }) => bg === `scene:${id}`)?.id
}

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
  /** Hex color, transparent, or a registered scene:<id> background. */
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

/** Random looks only reach into the allowed part of the wardrobe when a filter is given. */
export function randomKunAvatarParts(random: () => number = Math.random,
  allowed?: (category: KunAvatarAccessoryCategory, id: string) => boolean): KunAvatarParts {
  const pick = <Value>(choices: readonly Value[]): Value =>
    choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))]!
  let parts = normalizeKunAvatarParts({ color: pick(KUN_AVATAR_CATALOG.color).id,
    face: pick(KUN_AVATAR_CATALOG.face).id })
  for (const category of KUN_AVATAR_ACCESSORY_CATEGORIES) {
    const ids = KUN_AVATAR_CATALOG[category].map((part) => part.id).filter((id) => !allowed || allowed(category, id))
    const id = pick([undefined, ...ids])
    parts = updateKunAvatarPart(parts, category, id).parts
  }
  return parts
}

export function canonicalKunAvatarKey(parts: KunAvatarParts): string {
  const normalized = normalizeKunAvatarParts(parts)
  return JSON.stringify([normalized.color, normalized.face, normalized.headwear ?? null,
    normalized.glasses ?? null, normalized.outfit ?? null, normalized.prop ?? null, normalized.bg])
}

export function kunAvatarRarity(parts: KunAvatarParts): KunAvatarRarity {
  return KUN_AVATAR_ACCESSORY_CATEGORIES.reduce<KunAvatarRarity>((rarity, category) => {
    const next = KUN_AVATAR_CATALOG[category].find(({ id }) => id === parts[category])?.rarity ?? 'common'
    return KUN_AVATAR_RARITIES.indexOf(next) > KUN_AVATAR_RARITIES.indexOf(rarity) ? next : rarity
  }, 'common')
}

/** Portrait: the whole square picture, as the editor shows it. Face: the compact crop. */
export type KunAvatarFraming = 'portrait' | 'face'
export type KunAvatarRenderOptions = { size?: number; effects?: boolean; framing?: KunAvatarFraming }

/** Every avatar is the same square picture; only avatars smaller than 28 CSS px zoom to the face. */
export const KUN_AVATAR_FACE_FRAMING_BELOW = 28
export function kunAvatarFraming(size: number): KunAvatarFraming {
  return size < KUN_AVATAR_FACE_FRAMING_BELOW ? 'face' : 'portrait'
}

/** Stable layer keys shared with asset QA; size means CSS pixels, independently of DPR. */
export function kunAvatarLayerKeys(parts: KunAvatarParts, options: KunAvatarRenderOptions = {}): string[] {
  const headwear = KUN_AVATAR_CATALOG.headwear.find((part) => part.id === parts.headwear)
  const outfit = KUN_AVATAR_CATALOG.outfit.find((part) => part.id === parts.outfit)
  const crest = headwear?.crest ?? 'normal'
  const framing = options.framing ?? (options.size === undefined ? 'portrait' : kunAvatarFraming(options.size))
  // Only the face crop hides props and needs the lowered hats; small portraits keep the whole look.
  const compact = framing === 'face'
  const simplified = options.size !== undefined && options.size <= 48
  const small = options.size !== undefined && options.size <= 34
  const scene = kunAvatarScene(parts.bg)
  const rarity = kunAvatarRarity(parts)
  const effects = options.effects && (options.size ?? 0) >= 96 && (rarity === 'epic' || rarity === 'legendary')
  return [
    scene ? `scene/${scene}${simplified ? '.small' : ''}` : '',
    effects ? `fx/${rarity}.back` : '',
    outfit?.hasBack ? `outfit/${outfit.id}.back` : '',
    headwear?.hasBack ? `headwear/${headwear.id}.back` : '',
    crest === 'hidden' ? '' : `crest/${crest === 'tucked' ? 'tucked-' : ''}${parts.color}`,
    `base/${parts.color}`, `face/${parts.face}`,
    parts.outfit ? `outfit/${parts.outfit}` : '',
    parts.glasses ? `glasses/${parts.glasses}${small ? '.small' : ''}` : '',
    parts.headwear ? `headwear/${parts.headwear}${compact && KUN_AVATAR_SMALL_HEADWEAR.includes(parts.headwear) ? '.small' : ''}` : '',
    !compact && parts.prop ? `prop/${parts.prop}` : '',
    !compact && parts.prop ? `wing/${parts.color}` : '',
    effects ? `fx/${rarity}` : ''
  ].filter(Boolean)
}
