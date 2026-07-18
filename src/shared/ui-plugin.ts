/**
 * UI 插件(形象工坊)规范 v1。
 *
 * 一个 UI 插件 = 一个文件夹:manifest.json + 若干图片。
 * 纯声明式 —— 不允许任何 JS / HTML / 自定义 CSS 执行;
 * 图片由主进程读取并校验,主题 token 仅允许 --ds-* 白名单。
 * 主题样式只能由宿主生成,再由主进程通过短生命周期 CDP 会话注入;
 * 插件本身不能提供或执行 CSS / JS。
 */

export const UI_PLUGIN_MANIFEST_FILENAME = 'manifest.json'

/** 形象槽位:缺失的槽位回退默认 Kun 美术(允许"半皮肤") */
export const UI_PLUGIN_FIGURE_SLOTS = [
  'portrait',
  'swim',
  'surf',
  'greet',
  'sleep',
  'sit',
  'run',
  'toggleIcon'
] as const

export type UiPluginFigureSlot = (typeof UI_PLUGIN_FIGURE_SLOTS)[number]

/**
 * 人物主题舞台只接受宿主枚举。插件不能提供选择器、CSS 或任意布局字符串。
 */
export const UI_PLUGIN_CHARACTER_ANCHORS = ['top-right', 'right', 'bottom-right'] as const
export type UiPluginCharacterAnchor = (typeof UI_PLUGIN_CHARACTER_ANCHORS)[number]

export const UI_PLUGIN_CHARACTER_SIZES = ['medium', 'large', 'hero'] as const
export type UiPluginCharacterSize = (typeof UI_PLUGIN_CHARACTER_SIZES)[number]

export const UI_PLUGIN_CHARACTER_FRAMES = [
  'soft-card',
  'paper',
  'crystal',
  'hologram',
  'backstage',
  'portal',
  'polaroid',
  'ticket',
  'seal'
] as const
export type UiPluginCharacterFrame = (typeof UI_PLUGIN_CHARACTER_FRAMES)[number]

export const UI_PLUGIN_CHARACTER_MOTIONS = ['none', 'breathe', 'float'] as const
export type UiPluginCharacterMotion = (typeof UI_PLUGIN_CHARACTER_MOTIONS)[number]

export const UI_PLUGIN_CONTENT_RESERVES = ['none', 'narrow', 'wide'] as const
export type UiPluginContentReserve = (typeof UI_PLUGIN_CONTENT_RESERVES)[number]

export const UI_PLUGIN_READABILITY_SCRIMS = ['none', 'opposite-character', 'full'] as const
export type UiPluginReadabilityScrim = (typeof UI_PLUGIN_READABILITY_SCRIMS)[number]

export const UI_PLUGIN_READABILITY_STRENGTHS = ['soft', 'medium', 'strong'] as const
export type UiPluginReadabilityStrength = (typeof UI_PLUGIN_READABILITY_STRENGTHS)[number]

export const UI_PLUGIN_SURFACE_MATERIALS = [
  'solid',
  'translucent',
  'glass',
  'strong-glass'
] as const
export type UiPluginSurfaceMaterial = (typeof UI_PLUGIN_SURFACE_MATERIALS)[number]

export type UiPluginPresentation = {
  character: {
    anchor: UiPluginCharacterAnchor
    size: UiPluginCharacterSize
    offsetX: number
    offsetY: number
    opacity: number
    frame: UiPluginCharacterFrame
    motion: UiPluginCharacterMotion
    contentReserve: UiPluginContentReserve
  }
  readability: {
    scrim: UiPluginReadabilityScrim
    strength: UiPluginReadabilityStrength
  }
  surfaces: {
    sidebar: UiPluginSurfaceMaterial
    topbar: UiPluginSurfaceMaterial
    composer: UiPluginSurfaceMaterial
    cards: UiPluginSurfaceMaterial
  }
}

/**
 * UI Plugin scene v1.6 is an additive, host-rendered scene description.
 * `presentation` remains the v1.5 fallback; older hosts can ignore this
 * top-level object without accepting plugin markup, CSS, or executable code.
 */
export const UI_PLUGIN_SCENE_API_VERSION = '1.6' as const

export const UI_PLUGIN_SCENE_LAYOUTS = [
  'rail-right',
  'rail-left',
  'card-right',
  'card-left',
  'backdrop-right',
  'backdrop-center'
] as const
export type UiPluginSceneLayout = (typeof UI_PLUGIN_SCENE_LAYOUTS)[number]

export const UI_PLUGIN_SCENE_CHARACTER_SCALES = ['compact', 'standard', 'hero'] as const
export type UiPluginSceneCharacterScale = (typeof UI_PLUGIN_SCENE_CHARACTER_SCALES)[number]

export const UI_PLUGIN_SCENE_CHARACTER_MASKS = [
  'none',
  'soft-card',
  'circle',
  'arch',
  'diamond',
  'hologram',
  'portal',
  'polaroid',
  'ticket'
] as const
export type UiPluginSceneCharacterMask = (typeof UI_PLUGIN_SCENE_CHARACTER_MASKS)[number]

export const UI_PLUGIN_SCENE_CHARACTER_MOTIONS = ['none', 'breathe', 'float', 'sway'] as const
export type UiPluginSceneCharacterMotion = (typeof UI_PLUGIN_SCENE_CHARACTER_MOTIONS)[number]

export const UI_PLUGIN_SCENE_ARTWORK_SLOTS = [
  'backdrop',
  'ambient',
  'frame',
  'foreground',
  'emblem'
] as const
export type UiPluginSceneArtworkSlot = (typeof UI_PLUGIN_SCENE_ARTWORK_SLOTS)[number]

export const UI_PLUGIN_SCENE_ARTWORK_SIZES = ['small', 'medium', 'large', 'full'] as const
export type UiPluginSceneArtworkSize = (typeof UI_PLUGIN_SCENE_ARTWORK_SIZES)[number]

export const UI_PLUGIN_SCENE_ARTWORK_BLENDS = ['normal', 'screen', 'soft-light'] as const
export type UiPluginSceneArtworkBlend = (typeof UI_PLUGIN_SCENE_ARTWORK_BLENDS)[number]

export const UI_PLUGIN_SCENE_ARTWORK_MOTIONS = [
  'none',
  'float',
  'drift-x',
  'drift-y',
  'pulse',
  'orbit',
  'twinkle',
  'scan'
] as const
export type UiPluginSceneArtworkMotion = (typeof UI_PLUGIN_SCENE_ARTWORK_MOTIONS)[number]

export const UI_PLUGIN_SCENE_MOTION_SPEEDS = ['slow', 'normal', 'fast'] as const
export type UiPluginSceneMotionSpeed = (typeof UI_PLUGIN_SCENE_MOTION_SPEEDS)[number]

export const UI_PLUGIN_SCENE_MOTION_PHASES = ['a', 'b', 'c'] as const
export type UiPluginSceneMotionPhase = (typeof UI_PLUGIN_SCENE_MOTION_PHASES)[number]

export const UI_PLUGIN_SCENE_CHROME_RECIPES = [
  'inherit',
  'soft',
  'editorial',
  'paper',
  'crystal',
  'hologram',
  'backstage',
  'portal',
  'polaroid',
  'ticket',
  'seal',
  'botanical',
  'fortune-ledger',
  'dream-gate',
  'washi',
  'scrapbook',
  'aurora',
  'synth',
  'midnight-pass',
  'nautical',
  'dimension-lab',
  'starlight'
] as const
export type UiPluginSceneChromeRecipe = (typeof UI_PLUGIN_SCENE_CHROME_RECIPES)[number]

export type UiPluginSceneMotion<TPreset extends string> = {
  preset: TPreset
  speed: UiPluginSceneMotionSpeed
  phase: UiPluginSceneMotionPhase
}

export type UiPluginSceneArtworkLayer = {
  path: string
  darkPath?: string
  anchor: UiPluginBackgroundPosition
  size: UiPluginSceneArtworkSize
  fit: UiPluginBackgroundFit
  offsetX: number
  offsetY: number
  opacity: number
  blend: UiPluginSceneArtworkBlend
  motion: UiPluginSceneMotion<UiPluginSceneArtworkMotion>
}

export type UiPluginSceneV16 = {
  apiVersion: typeof UI_PLUGIN_SCENE_API_VERSION
  layout: UiPluginSceneLayout
  character: {
    scale: UiPluginSceneCharacterScale
    fit: UiPluginBackgroundFit
    focalPoint: UiPluginBackgroundPosition
    mask: UiPluginSceneCharacterMask
    offsetX: number
    offsetY: number
    opacity: number
    flipX: boolean
    motion: UiPluginSceneMotion<UiPluginSceneCharacterMotion>
  }
  artwork: Partial<Record<UiPluginSceneArtworkSlot, UiPluginSceneArtworkLayer>>
  chrome: {
    sidebar: UiPluginSceneChromeRecipe
    topbar: UiPluginSceneChromeRecipe
    composer: UiPluginSceneChromeRecipe
    cards: UiPluginSceneChromeRecipe
  }
}

/** 可换肤的应用表面:整窗、侧栏和主舞台 */
export const UI_PLUGIN_BACKGROUND_SLOTS = ['app', 'sidebar', 'stage'] as const

export type UiPluginBackgroundSlot = (typeof UI_PLUGIN_BACKGROUND_SLOTS)[number]

export const UI_PLUGIN_BACKGROUND_THEMES = ['light', 'dark'] as const

export type UiPluginBackgroundTheme = (typeof UI_PLUGIN_BACKGROUND_THEMES)[number]

export const UI_PLUGIN_BACKGROUND_FITS = ['cover', 'contain'] as const

export type UiPluginBackgroundFit = (typeof UI_PLUGIN_BACKGROUND_FITS)[number]

export const UI_PLUGIN_BACKGROUND_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
] as const

export type UiPluginBackgroundPosition = (typeof UI_PLUGIN_BACKGROUND_POSITIONS)[number]

export type UiPluginBackgroundLayer = {
  /** 插件目录内的相对图片路径 */
  path: string
  fit: UiPluginBackgroundFit
  position: UiPluginBackgroundPosition
  opacity: number
}

export type UiPluginBackgrounds = Partial<
  Record<
    UiPluginBackgroundTheme,
    Partial<Record<UiPluginBackgroundSlot, UiPluginBackgroundLayer>>
  >
>

export const UI_PLUGIN_LABEL_KEYS = [
  'working',
  'workingSprint',
  'workingDive',
  'workingSurf'
] as const

export type UiPluginLabelKey = (typeof UI_PLUGIN_LABEL_KEYS)[number]

export type UiPluginLabelLocale = 'zh' | 'en'

export type UiPluginManifestV1 = {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /** 槽位 → 插件目录内的相对图片路径 */
  figures: Partial<Record<UiPluginFigureSlot, string>>
  /** 可选:按明暗主题和应用表面声明背景层 */
  backgrounds?: UiPluginBackgrounds
  /** 可选:由宿主固定组件渲染的人物主题舞台 */
  presentation?: UiPluginPresentation
  /** 可选:UI Plugin v1.6 固定图层人物场景;presentation 仍是旧宿主 fallback */
  scene?: UiPluginSceneV16
  /** 可选:进行中状态文案(按语言、按泳姿键) */
  labels?: Partial<Record<UiPluginLabelLocale, Partial<Record<UiPluginLabelKey, string>>>>
  /** 可选:主题 token 覆盖(仅 --ds-*) */
  tokens?: {
    light?: Record<string, string>
    dark?: Record<string, string>
  }
  features?: {
    /** 是否启用主会话两侧的出没彩蛋 */
    cameos?: boolean
  }
}

export type UiPluginListItem = {
  manifest: UiPluginManifestV1
  /** 列表预览 data URL:形象槽位优先,否则仅回退到满足严格预览预算的小型背景 */
  previewDataUrl: string | null
}

export type UiPluginRuntimeFigures = Partial<Record<UiPluginFigureSlot, string>>

/**
 * 主进程验证、读取后提供给渲染层的背景资源。
 *
 * 新运行时把同一路径的 data URL 只放入 assets 一次，避免 IPC 在多个槽位复用图片时
 * 重复序列化大字符串。light/dark 保留为旧运行时 shape 的兼容读取入口。
 */
export type UiPluginRuntimeBackgrounds = {
  assets?: Record<string, string>
  light?: Partial<Record<UiPluginBackgroundSlot, string>>
  dark?: Partial<Record<UiPluginBackgroundSlot, string>>
}

/** 主进程验证后的 v1.6 scene 图片，按 manifest 相对路径去重。 */
export type UiPluginRuntimeSceneAssets = {
  assets?: Record<string, string>
}

export type UiPluginValidationResult =
  | { ok: true; manifest: UiPluginManifestV1 }
  | { ok: false; errors: string[] }

export const UI_PLUGIN_LIMITS = {
  manifestBytes: 64 * 1024,
  figureBytes: 2 * 1024 * 1024,
  totalFigureBytes: 24 * 1024 * 1024,
  figureMaxDimension: 4096,
  figureMaxPixels: 12_000_000,
  totalFigurePixels: 48_000_000,
  portraitPreviewBytes: 96 * 1024,
  portraitPreviewMaxDimension: 256,
  backgroundBytes: 8 * 1024 * 1024,
  totalBackgroundBytes: 32 * 1024 * 1024,
  totalAssetBytes: 48 * 1024 * 1024,
  backgroundMaxDimension: 8192,
  backgroundMaxPixels: 24_000_000,
  totalBackgroundPixels: 64_000_000,
  sceneAssetBytes: 4 * 1024 * 1024,
  totalSceneAssetBytes: 16 * 1024 * 1024,
  sceneAssetMaxDimension: 4096,
  sceneAssetMaxPixels: 12_000_000,
  totalSceneAssetPixels: 40_000_000,
  tokenEntries: 60,
  labelChars: 24
} as const

const UI_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/
/**
 * 与内置模式、DOM 属性值保留字互斥。
 * 注意:'ikun' 不在保留字里 —— 内置的 iKun 模式本身就是一个预装 UI 插件
 * (见 src/main/ui-plugin-bundled.ts),id 为 'ikun' 时额外点亮
 * data-ikun-mode 的手工 CSS 机制。
 */
const UI_PLUGIN_RESERVED_IDS = new Set(['default', 'kun', 'on', 'off', 'none'])

/** 预装示例插件(iKun)的 id:激活时会同时启用 data-ikun-mode 手工动画机制 */
export const UI_PLUGIN_BUNDLED_IKUN_ID = 'ikun'
const UI_PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.-]{0,40})?$/
const UI_PLUGIN_ASSET_PATH_PATTERN = /^[\w][\w./-]{0,200}$/
const UI_PLUGIN_FIGURE_EXTENSIONS = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif'])
const UI_PLUGIN_BACKGROUND_EXTENSIONS = new Set(['png', 'webp', 'jpg', 'jpeg'])
const UI_PLUGIN_TOKEN_NAME_PATTERN = /^--ds-[a-z][a-z0-9-]{0,60}$/
/** 颜色/渐变等安全值:禁分号、花括号、url()、反斜杠 */
const UI_PLUGIN_TOKEN_VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/-]{1,120}$/

function isSafeUiPluginAssetPath(value: string, extensions: ReadonlySet<string>): boolean {
  if (!UI_PLUGIN_ASSET_PATH_PATTERN.test(value)) return false
  if (value.includes('\\')) return false
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false
  }
  const extension = segments[segments.length - 1]?.split('.').pop()?.toLowerCase() ?? ''
  return extensions.has(extension)
}

export function isSafeUiPluginFigurePath(value: string): boolean {
  return isSafeUiPluginAssetPath(value, UI_PLUGIN_FIGURE_EXTENSIONS)
}

export function isSafeUiPluginBackgroundPath(value: string): boolean {
  return isSafeUiPluginAssetPath(value, UI_PLUGIN_BACKGROUND_EXTENSIONS)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

export const UI_PLUGIN_BACKGROUND_DEFAULT_OPACITY: Readonly<
  Record<UiPluginBackgroundSlot, number>
> = {
  app: 0.22,
  sidebar: 0.18,
  stage: 0.32
}

function normalizeUiPluginBackgroundLayer(
  raw: unknown,
  theme: UiPluginBackgroundTheme,
  slot: UiPluginBackgroundSlot,
  errors: string[]
): UiPluginBackgroundLayer | null {
  const prefix = `backgrounds.${theme}.${slot}`
  if (typeof raw === 'string') {
    const path = raw.trim()
    if (!isSafeUiPluginBackgroundPath(path)) {
      errors.push(`${prefix} 的图片路径不合法(需为插件内相对路径,png/webp/jpg/jpeg)`)
      return null
    }
    return {
      path,
      fit: 'cover',
      position: 'center',
      opacity: UI_PLUGIN_BACKGROUND_DEFAULT_OPACITY[slot]
    }
  }

  if (!isPlainObject(raw)) {
    errors.push(`${prefix} 需为图片路径字符串或背景层对象`)
    return null
  }

  let valid = true
  const allowedKeys = new Set(['path', 'fit', 'position', 'opacity'])
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${prefix} 不支持键 "${key}"`)
      valid = false
    }
  }

  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!isSafeUiPluginBackgroundPath(path)) {
    errors.push(`${prefix}.path 不合法(需为插件内相对路径,png/webp/jpg/jpeg)`)
    valid = false
  }

  let fit: UiPluginBackgroundFit = 'cover'
  if (raw.fit !== undefined) {
    if (!(UI_PLUGIN_BACKGROUND_FITS as readonly unknown[]).includes(raw.fit)) {
      errors.push(`${prefix}.fit 仅支持 cover 或 contain`)
      valid = false
    } else {
      fit = raw.fit as UiPluginBackgroundFit
    }
  }

  let position: UiPluginBackgroundPosition = 'center'
  if (raw.position !== undefined) {
    if (!(UI_PLUGIN_BACKGROUND_POSITIONS as readonly unknown[]).includes(raw.position)) {
      errors.push(`${prefix}.position 不是支持的九宫格位置`)
      valid = false
    } else {
      position = raw.position as UiPluginBackgroundPosition
    }
  }

  let opacity = UI_PLUGIN_BACKGROUND_DEFAULT_OPACITY[slot]
  if (raw.opacity !== undefined) {
    if (typeof raw.opacity !== 'number' || !Number.isFinite(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) {
      errors.push(`${prefix}.opacity 需为 0-1 的有限数字`)
      valid = false
    } else {
      opacity = raw.opacity
    }
  }

  return valid ? { path, fit, position, opacity } : null
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowedKeys: readonly string[],
  prefix: string,
  errors: string[]
): boolean {
  let valid = true
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push(`${prefix} 不支持键 "${key}"`)
      valid = false
    }
  }
  return valid
}

function readRequiredEnum<T extends string>(
  raw: unknown,
  values: readonly T[],
  path: string,
  errors: string[]
): T | null {
  if (typeof raw !== 'string' || !values.includes(raw as T)) {
    errors.push(`${path} 仅支持 ${values.join('、')}`)
    return null
  }
  return raw as T
}

function readRequiredInteger(
  raw: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[]
): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    errors.push(`${path} 需为 ${min} 到 ${max} 的整数`)
    return null
  }
  return raw
}

function readRequiredUnitNumber(
  raw: unknown,
  path: string,
  errors: string[]
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    errors.push(`${path} 需为 0-1 的有限数字`)
    return null
  }
  return raw
}

function normalizeUiPluginPresentation(
  raw: unknown,
  errors: string[]
): UiPluginPresentation | null {
  if (!isPlainObject(raw)) {
    errors.push('presentation 需为对象')
    return null
  }

  let valid = rejectUnknownKeys(raw, ['character', 'readability', 'surfaces'], 'presentation', errors)
  const character = raw.character
  const readability = raw.readability
  const surfaces = raw.surfaces

  if (!isPlainObject(character)) {
    errors.push('presentation.character 需为对象')
    valid = false
  }
  if (!isPlainObject(readability)) {
    errors.push('presentation.readability 需为对象')
    valid = false
  }
  if (!isPlainObject(surfaces)) {
    errors.push('presentation.surfaces 需为对象')
    valid = false
  }
  if (!isPlainObject(character) || !isPlainObject(readability) || !isPlainObject(surfaces)) {
    return null
  }

  valid =
    rejectUnknownKeys(
      character,
      ['anchor', 'size', 'offsetX', 'offsetY', 'opacity', 'frame', 'motion', 'contentReserve'],
      'presentation.character',
      errors
    ) && valid
  valid =
    rejectUnknownKeys(readability, ['scrim', 'strength'], 'presentation.readability', errors) &&
    valid
  valid =
    rejectUnknownKeys(
      surfaces,
      ['sidebar', 'topbar', 'composer', 'cards'],
      'presentation.surfaces',
      errors
    ) && valid

  const anchor = readRequiredEnum(
    character.anchor,
    UI_PLUGIN_CHARACTER_ANCHORS,
    'presentation.character.anchor',
    errors
  )
  const size = readRequiredEnum(
    character.size,
    UI_PLUGIN_CHARACTER_SIZES,
    'presentation.character.size',
    errors
  )
  const offsetX = readRequiredInteger(
    character.offsetX,
    -12,
    12,
    'presentation.character.offsetX',
    errors
  )
  const offsetY = readRequiredInteger(
    character.offsetY,
    -12,
    12,
    'presentation.character.offsetY',
    errors
  )
  const opacity = readRequiredUnitNumber(
    character.opacity,
    'presentation.character.opacity',
    errors
  )
  const frame = readRequiredEnum(
    character.frame,
    UI_PLUGIN_CHARACTER_FRAMES,
    'presentation.character.frame',
    errors
  )
  const motion = readRequiredEnum(
    character.motion,
    UI_PLUGIN_CHARACTER_MOTIONS,
    'presentation.character.motion',
    errors
  )
  const contentReserve = readRequiredEnum(
    character.contentReserve,
    UI_PLUGIN_CONTENT_RESERVES,
    'presentation.character.contentReserve',
    errors
  )
  const scrim = readRequiredEnum(
    readability.scrim,
    UI_PLUGIN_READABILITY_SCRIMS,
    'presentation.readability.scrim',
    errors
  )
  const strength = readRequiredEnum(
    readability.strength,
    UI_PLUGIN_READABILITY_STRENGTHS,
    'presentation.readability.strength',
    errors
  )
  const sidebar = readRequiredEnum(
    surfaces.sidebar,
    UI_PLUGIN_SURFACE_MATERIALS,
    'presentation.surfaces.sidebar',
    errors
  )
  const topbar = readRequiredEnum(
    surfaces.topbar,
    UI_PLUGIN_SURFACE_MATERIALS,
    'presentation.surfaces.topbar',
    errors
  )
  const composer = readRequiredEnum(
    surfaces.composer,
    UI_PLUGIN_SURFACE_MATERIALS,
    'presentation.surfaces.composer',
    errors
  )
  const cards = readRequiredEnum(
    surfaces.cards,
    UI_PLUGIN_SURFACE_MATERIALS,
    'presentation.surfaces.cards',
    errors
  )

  if (
    !valid ||
    anchor === null ||
    size === null ||
    offsetX === null ||
    offsetY === null ||
    opacity === null ||
    frame === null ||
    motion === null ||
    contentReserve === null ||
    scrim === null ||
    strength === null ||
    sidebar === null ||
    topbar === null ||
    composer === null ||
    cards === null
  ) {
    return null
  }

  return {
    character: { anchor, size, offsetX, offsetY, opacity, frame, motion, contentReserve },
    readability: { scrim, strength },
    surfaces: { sidebar, topbar, composer, cards }
  }
}

function normalizeUiPluginSceneMotion<TPreset extends string>(
  raw: unknown,
  presets: readonly TPreset[],
  path: string,
  errors: string[]
): UiPluginSceneMotion<TPreset> | null {
  if (!isPlainObject(raw)) {
    errors.push(`${path} 需为对象`)
    return null
  }
  let valid = rejectUnknownKeys(raw, ['preset', 'speed', 'phase'], path, errors)
  const preset = readRequiredEnum(raw.preset, presets, `${path}.preset`, errors)
  const speed = readRequiredEnum(raw.speed, UI_PLUGIN_SCENE_MOTION_SPEEDS, `${path}.speed`, errors)
  const phase = readRequiredEnum(raw.phase, UI_PLUGIN_SCENE_MOTION_PHASES, `${path}.phase`, errors)
  valid = valid && preset !== null && speed !== null && phase !== null
  return valid && preset && speed && phase ? { preset, speed, phase } : null
}

function normalizeUiPluginSceneArtworkLayer(
  raw: unknown,
  slot: UiPluginSceneArtworkSlot,
  errors: string[]
): UiPluginSceneArtworkLayer | null {
  const prefix = `scene.artwork.${slot}`
  if (!isPlainObject(raw)) {
    errors.push(`${prefix} 需为对象`)
    return null
  }
  let valid = rejectUnknownKeys(
    raw,
    [
      'path',
      'darkPath',
      'anchor',
      'size',
      'fit',
      'offsetX',
      'offsetY',
      'opacity',
      'blend',
      'motion'
    ],
    prefix,
    errors
  )

  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  if (!isSafeUiPluginBackgroundPath(path)) {
    errors.push(`${prefix}.path 不合法(需为插件内静态 png/webp/jpg/jpeg 相对路径)`)
    valid = false
  }
  let darkPath: string | undefined
  if (raw.darkPath !== undefined) {
    darkPath = typeof raw.darkPath === 'string' ? raw.darkPath.trim() : ''
    if (!isSafeUiPluginBackgroundPath(darkPath)) {
      errors.push(`${prefix}.darkPath 不合法(需为插件内静态 png/webp/jpg/jpeg 相对路径)`)
      valid = false
    }
  }

  const anchor = readRequiredEnum(
    raw.anchor,
    UI_PLUGIN_BACKGROUND_POSITIONS,
    `${prefix}.anchor`,
    errors
  )
  const size = readRequiredEnum(raw.size, UI_PLUGIN_SCENE_ARTWORK_SIZES, `${prefix}.size`, errors)
  const fit = readRequiredEnum(raw.fit, UI_PLUGIN_BACKGROUND_FITS, `${prefix}.fit`, errors)
  const offsetX = readRequiredInteger(raw.offsetX, -12, 12, `${prefix}.offsetX`, errors)
  const offsetY = readRequiredInteger(raw.offsetY, -12, 12, `${prefix}.offsetY`, errors)
  const opacity = readRequiredUnitNumber(raw.opacity, `${prefix}.opacity`, errors)
  const blend = readRequiredEnum(
    raw.blend,
    UI_PLUGIN_SCENE_ARTWORK_BLENDS,
    `${prefix}.blend`,
    errors
  )
  if (blend && blend !== 'normal' && slot !== 'backdrop' && slot !== 'ambient') {
    errors.push(`${prefix}.blend 仅 backdrop/ambient 可使用 screen 或 soft-light`)
    valid = false
  }
  const motion = normalizeUiPluginSceneMotion(
    raw.motion,
    UI_PLUGIN_SCENE_ARTWORK_MOTIONS,
    `${prefix}.motion`,
    errors
  )

  if (
    !valid ||
    !path ||
    anchor === null ||
    size === null ||
    fit === null ||
    offsetX === null ||
    offsetY === null ||
    opacity === null ||
    blend === null ||
    motion === null
  ) {
    return null
  }

  return {
    path,
    ...(darkPath ? { darkPath } : {}),
    anchor,
    size,
    fit,
    offsetX,
    offsetY,
    opacity,
    blend,
    motion
  }
}

function normalizeUiPluginScene(raw: unknown, errors: string[]): UiPluginSceneV16 | null {
  if (!isPlainObject(raw)) {
    errors.push('scene 需为对象')
    return null
  }
  let valid = rejectUnknownKeys(
    raw,
    ['apiVersion', 'layout', 'character', 'artwork', 'chrome'],
    'scene',
    errors
  )
  if (raw.apiVersion !== UI_PLUGIN_SCENE_API_VERSION) {
    errors.push(`scene.apiVersion 仅支持 ${UI_PLUGIN_SCENE_API_VERSION}`)
    valid = false
  }
  const layout = readRequiredEnum(raw.layout, UI_PLUGIN_SCENE_LAYOUTS, 'scene.layout', errors)

  const character = raw.character
  if (!isPlainObject(character)) {
    errors.push('scene.character 需为对象')
    valid = false
  }
  const artwork = raw.artwork
  if (!isPlainObject(artwork)) {
    errors.push('scene.artwork 需为对象')
    valid = false
  }
  const chrome = raw.chrome
  if (!isPlainObject(chrome)) {
    errors.push('scene.chrome 需为对象')
    valid = false
  }
  if (!isPlainObject(character) || !isPlainObject(artwork) || !isPlainObject(chrome)) {
    return null
  }

  valid = rejectUnknownKeys(
    character,
    [
      'scale',
      'fit',
      'focalPoint',
      'mask',
      'offsetX',
      'offsetY',
      'opacity',
      'flipX',
      'motion'
    ],
    'scene.character',
    errors
  ) && valid
  const scale = readRequiredEnum(
    character.scale,
    UI_PLUGIN_SCENE_CHARACTER_SCALES,
    'scene.character.scale',
    errors
  )
  const fit = readRequiredEnum(
    character.fit,
    UI_PLUGIN_BACKGROUND_FITS,
    'scene.character.fit',
    errors
  )
  const focalPoint = readRequiredEnum(
    character.focalPoint,
    UI_PLUGIN_BACKGROUND_POSITIONS,
    'scene.character.focalPoint',
    errors
  )
  const mask = readRequiredEnum(
    character.mask,
    UI_PLUGIN_SCENE_CHARACTER_MASKS,
    'scene.character.mask',
    errors
  )
  const offsetX = readRequiredInteger(
    character.offsetX,
    -12,
    12,
    'scene.character.offsetX',
    errors
  )
  const offsetY = readRequiredInteger(
    character.offsetY,
    -12,
    12,
    'scene.character.offsetY',
    errors
  )
  const opacity = readRequiredUnitNumber(
    character.opacity,
    'scene.character.opacity',
    errors
  )
  const flipX = character.flipX
  if (typeof flipX !== 'boolean') {
    errors.push('scene.character.flipX 需为 boolean')
    valid = false
  }
  const characterMotion = normalizeUiPluginSceneMotion(
    character.motion,
    UI_PLUGIN_SCENE_CHARACTER_MOTIONS,
    'scene.character.motion',
    errors
  )

  valid = rejectUnknownKeys(
    artwork,
    UI_PLUGIN_SCENE_ARTWORK_SLOTS,
    'scene.artwork',
    errors
  ) && valid
  const normalizedArtwork: UiPluginSceneV16['artwork'] = {}
  for (const [slot, layerRaw] of Object.entries(artwork)) {
    if (!(UI_PLUGIN_SCENE_ARTWORK_SLOTS as readonly string[]).includes(slot)) continue
    const layer = normalizeUiPluginSceneArtworkLayer(
      layerRaw,
      slot as UiPluginSceneArtworkSlot,
      errors
    )
    if (layer) normalizedArtwork[slot as UiPluginSceneArtworkSlot] = layer
  }
  if (Object.keys(normalizedArtwork).length === 0) {
    errors.push('scene.artwork 至少需要声明一个专属图片槽位')
    valid = false
  }

  valid = rejectUnknownKeys(
    chrome,
    ['sidebar', 'topbar', 'composer', 'cards'],
    'scene.chrome',
    errors
  ) && valid
  const sidebar = readRequiredEnum(
    chrome.sidebar,
    UI_PLUGIN_SCENE_CHROME_RECIPES,
    'scene.chrome.sidebar',
    errors
  )
  const topbar = readRequiredEnum(
    chrome.topbar,
    UI_PLUGIN_SCENE_CHROME_RECIPES,
    'scene.chrome.topbar',
    errors
  )
  const composer = readRequiredEnum(
    chrome.composer,
    UI_PLUGIN_SCENE_CHROME_RECIPES,
    'scene.chrome.composer',
    errors
  )
  const cards = readRequiredEnum(
    chrome.cards,
    UI_PLUGIN_SCENE_CHROME_RECIPES,
    'scene.chrome.cards',
    errors
  )

  if (
    !valid ||
    layout === null ||
    scale === null ||
    fit === null ||
    focalPoint === null ||
    mask === null ||
    offsetX === null ||
    offsetY === null ||
    opacity === null ||
    typeof flipX !== 'boolean' ||
    characterMotion === null ||
    sidebar === null ||
    topbar === null ||
    composer === null ||
    cards === null
  ) {
    return null
  }

  return {
    apiVersion: UI_PLUGIN_SCENE_API_VERSION,
    layout,
    character: {
      scale,
      fit,
      focalPoint,
      mask,
      offsetX,
      offsetY,
      opacity,
      flipX,
      motion: characterMotion
    },
    artwork: normalizedArtwork,
    chrome: { sidebar, topbar, composer, cards }
  }
}

export function normalizeUiPluginManifest(raw: unknown): UiPluginValidationResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest.json 必须是 JSON 对象'] }
  }

  const id = readTrimmedString(raw.id, 40)
  if (!id || !UI_PLUGIN_ID_PATTERN.test(id)) {
    errors.push('id 需为 2-40 位小写字母/数字/连字符,且以字母或数字开头')
  } else if (UI_PLUGIN_RESERVED_IDS.has(id)) {
    errors.push(`id "${id}" 是保留字`)
  }

  const name = readTrimmedString(raw.name, 60)
  if (!name) errors.push('name 必填(≤60 字符)')

  const version = readTrimmedString(raw.version, 60)
  if (!version || !UI_PLUGIN_VERSION_PATTERN.test(version)) {
    errors.push('version 需为语义化版本号,如 1.0.0')
  }

  const author = readTrimmedString(raw.author, 80) ?? undefined
  if (raw.author !== undefined && author === undefined) errors.push('author 过长(≤80 字符)')
  const description = readTrimmedString(raw.description, 240) ?? undefined
  if (raw.description !== undefined && description === undefined) {
    errors.push('description 过长(≤240 字符)')
  }

  const figures: Partial<Record<UiPluginFigureSlot, string>> = {}
  if (raw.figures !== undefined && !isPlainObject(raw.figures)) {
    errors.push('figures 需为形象槽位对象')
  } else if (isPlainObject(raw.figures)) {
    for (const [slot, value] of Object.entries(raw.figures)) {
      if (!(UI_PLUGIN_FIGURE_SLOTS as readonly string[]).includes(slot)) {
        errors.push(`未知形象槽位 "${slot}"`)
        continue
      }
      if (typeof value !== 'string' || !isSafeUiPluginFigurePath(value.trim())) {
        errors.push(`槽位 "${slot}" 的图片路径不合法(需为插件内相对路径,png/webp/jpg/gif)`)
        continue
      }
      figures[slot as UiPluginFigureSlot] = value.trim()
    }
  }

  const backgrounds: UiPluginBackgrounds = {}
  if (raw.backgrounds !== undefined) {
    if (!isPlainObject(raw.backgrounds)) {
      errors.push('backgrounds 需为对象,如 { "light": { "app": "img/bg.png" } }')
    } else {
      for (const [theme, entries] of Object.entries(raw.backgrounds)) {
        if (!(UI_PLUGIN_BACKGROUND_THEMES as readonly string[]).includes(theme)) {
          errors.push(`backgrounds 不支持主题 "${theme}"`)
          continue
        }
        if (!isPlainObject(entries)) {
          errors.push(`backgrounds.${theme} 需为对象`)
          continue
        }
        const normalized: Partial<Record<UiPluginBackgroundSlot, UiPluginBackgroundLayer>> = {}
        for (const [slot, layerRaw] of Object.entries(entries)) {
          if (!(UI_PLUGIN_BACKGROUND_SLOTS as readonly string[]).includes(slot)) {
            errors.push(`backgrounds.${theme} 不支持槽位 "${slot}"`)
            continue
          }
          const layer = normalizeUiPluginBackgroundLayer(
            layerRaw,
            theme as UiPluginBackgroundTheme,
            slot as UiPluginBackgroundSlot,
            errors
          )
          if (layer) normalized[slot as UiPluginBackgroundSlot] = layer
        }
        if (Object.keys(normalized).length > 0) {
          backgrounds[theme as UiPluginBackgroundTheme] = normalized
        }
      }
    }
  }

  const backgroundCount = Object.values(backgrounds).reduce(
    (count, theme) => count + Object.keys(theme ?? {}).length,
    0
  )
  if (Object.keys(figures).length === 0 && backgroundCount === 0) {
    errors.push('figures 与 backgrounds 至少需要声明一个合法图片资源')
  }

  let presentation: UiPluginManifestV1['presentation']
  if (raw.presentation !== undefined) {
    presentation = normalizeUiPluginPresentation(raw.presentation, errors) ?? undefined
    if (!figures.portrait) {
      errors.push('presentation 需要同时声明 figures.portrait 人物图片')
    }
  }

  let scene: UiPluginManifestV1['scene']
  if (raw.scene !== undefined) {
    scene = normalizeUiPluginScene(raw.scene, errors) ?? undefined
    if (!figures.portrait) {
      errors.push('scene 需要同时声明 figures.portrait 人物图片')
    }
    if (!presentation) {
      errors.push('scene 需要同时声明 presentation 作为 v1.5 fallback')
    }
  }

  let labels: UiPluginManifestV1['labels']
  if (raw.labels !== undefined) {
    if (!isPlainObject(raw.labels)) {
      errors.push('labels 需为对象,如 { "zh": { "working": "巡航中…" } }')
    } else {
      labels = {}
      for (const [locale, entries] of Object.entries(raw.labels)) {
        if (locale !== 'zh' && locale !== 'en') {
          errors.push(`labels 不支持语言 "${locale}"`)
          continue
        }
        if (!isPlainObject(entries)) {
          errors.push(`labels.${locale} 需为对象`)
          continue
        }
        const normalized: Partial<Record<UiPluginLabelKey, string>> = {}
        for (const [key, text] of Object.entries(entries)) {
          if (!(UI_PLUGIN_LABEL_KEYS as readonly string[]).includes(key)) {
            errors.push(`labels.${locale} 不支持键 "${key}"`)
            continue
          }
          const label = readTrimmedString(text, UI_PLUGIN_LIMITS.labelChars)
          if (!label) {
            errors.push(`labels.${locale}.${key} 需为 1-${UI_PLUGIN_LIMITS.labelChars} 字符文本`)
            continue
          }
          normalized[key as UiPluginLabelKey] = label
        }
        labels[locale] = normalized
      }
    }
  }

  let tokens: UiPluginManifestV1['tokens']
  if (raw.tokens !== undefined) {
    if (!isPlainObject(raw.tokens)) {
      errors.push('tokens 需为对象,如 { "light": { "--ds-accent": "#8a63e8" } }')
    } else {
      tokens = {}
      let tokenCount = 0
      for (const [theme, entries] of Object.entries(raw.tokens)) {
        if (theme !== 'light' && theme !== 'dark') {
          errors.push(`tokens 不支持主题 "${theme}"`)
          continue
        }
        if (!isPlainObject(entries)) {
          errors.push(`tokens.${theme} 需为对象`)
          continue
        }
        const normalized: Record<string, string> = {}
        for (const [tokenName, tokenValue] of Object.entries(entries)) {
          tokenCount += 1
          if (tokenCount > UI_PLUGIN_LIMITS.tokenEntries) {
            errors.push(`tokens 数量超过上限 ${UI_PLUGIN_LIMITS.tokenEntries}`)
            break
          }
          if (!UI_PLUGIN_TOKEN_NAME_PATTERN.test(tokenName)) {
            errors.push(`token "${tokenName}" 不在 --ds-* 白名单内`)
            continue
          }
          if (
            typeof tokenValue !== 'string' ||
            /url\s*\(/i.test(tokenValue) ||
            !UI_PLUGIN_TOKEN_VALUE_PATTERN.test(tokenValue.trim())
          ) {
            errors.push(`token "${tokenName}" 的值包含不允许的字符`)
            continue
          }
          normalized[tokenName] = tokenValue.trim()
        }
        tokens[theme] = normalized
      }
    }
  }

  let features: UiPluginManifestV1['features']
  if (raw.features !== undefined) {
    if (!isPlainObject(raw.features)) {
      errors.push('features 需为对象')
    } else {
      features = { cameos: raw.features.cameos === true }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    manifest: {
      id: id as string,
      name: name as string,
      version: version as string,
      ...(author ? { author } : {}),
      ...(description ? { description } : {}),
      figures,
      ...(Object.keys(backgrounds).length > 0 ? { backgrounds } : {}),
      ...(presentation ? { presentation } : {}),
      ...(scene ? { scene } : {}),
      ...(labels && Object.keys(labels).length > 0 ? { labels } : {}),
      ...(tokens && Object.keys(tokens).length > 0 ? { tokens } : {}),
      ...(features ? { features } : {})
    }
  }
}

/**
 * 这些容器会在 dark 下的嵌套作用域里整体重声明 palette token
 * (base-shell.css 的 `[data-theme='dark'] .ds-workbench-shell`),从而遮蔽
 * 注入在 <html> 上的插件 token —— 这正是对话区(Workbench)在 dark 下不吃
 * 插件配色的根因。对应 iKun 既有的
 * `[data-theme='dark'][data-ikun-mode='on'] .ds-workbench-shell` 处理。
 * '' = <html> 根自身;日后若有新容器整体重声明 token,在此追加后缀即可。
 */
const TOKEN_SCOPE_ROOTS = ['', ' .ds-workbench-shell'] as const

/** 把单一锚点扩成「根 + 各重声明子作用域」的逗号选择器列表 */
function scopedSelector(base: string): string {
  return TOKEN_SCOPE_ROOTS.map((suffix) => `${base}${suffix}`).join(',\n')
}

/**
 * 生成插件 token 的样式文本。选择器锚定 html[data-ui-plugin='<id>'],
 * light 块用 :not([data-theme='dark']) 守卫,避免在暗色下错误覆盖。
 * 选择器同时覆盖 .ds-workbench-shell 子作用域,确保对话区(dark 下会就地
 * 重声明 palette token)也能采纳插件 token。
 */
export function buildUiPluginTokenCss(manifest: UiPluginManifestV1): string {
  const blocks: string[] = []
  const lightEntries = Object.entries(manifest.tokens?.light ?? {})
  const darkEntries = Object.entries(manifest.tokens?.dark ?? {})
  if (lightEntries.length > 0) {
    const body = lightEntries.map(([key, value]) => `  ${key}: ${value};`).join('\n')
    const selector = scopedSelector(`html[data-ui-plugin='${manifest.id}']:not([data-theme='dark'])`)
    blocks.push(`${selector} {\n${body}\n}`)
  }
  if (darkEntries.length > 0) {
    const body = darkEntries.map(([key, value]) => `  ${key}: ${value};`).join('\n')
    const selector = scopedSelector(`html[data-ui-plugin='${manifest.id}'][data-theme='dark']`)
    blocks.push(`${selector} {\n${body}\n}`)
  }
  return blocks.join('\n\n')
}

/**
 * 只把已经归一化的数值布局参数变成宿主私有变量。枚举值始终由渲染层受控
 * data 属性和固定 CSS 消费，插件不能借此注入声明、选择器或 URL。
 */
export function buildUiPluginPresentationCss(manifest: UiPluginManifestV1): string {
  const presentation = manifest.presentation
  if (
    !presentation ||
    !UI_PLUGIN_ID_PATTERN.test(manifest.id) ||
    !Number.isInteger(presentation.character.offsetX) ||
    presentation.character.offsetX < -12 ||
    presentation.character.offsetX > 12 ||
    !Number.isInteger(presentation.character.offsetY) ||
    presentation.character.offsetY < -12 ||
    presentation.character.offsetY > 12 ||
    !Number.isFinite(presentation.character.opacity) ||
    presentation.character.opacity < 0 ||
    presentation.character.opacity > 1
  ) {
    return ''
  }

  return (
    `html[data-ui-plugin='${manifest.id}'] {\n` +
    `  --kun-ui-plugin-character-offset-x: ${presentation.character.offsetX}%;\n` +
    `  --kun-ui-plugin-character-offset-y: ${presentation.character.offsetY}%;\n` +
    `  --kun-ui-plugin-character-opacity: ${formatCssNumber(presentation.character.opacity)};\n` +
    `}`
  )
}

/**
 * Emits only bounded numeric variables for scene v1.6. Enum choices remain
 * host-owned data attributes/classes and scene image data stays out of CDP CSS.
 */
export function buildUiPluginSceneCss(manifest: UiPluginManifestV1): string {
  const scene = manifest.scene
  if (
    !scene ||
    !UI_PLUGIN_ID_PATTERN.test(manifest.id) ||
    scene.apiVersion !== UI_PLUGIN_SCENE_API_VERSION ||
    !Number.isInteger(scene.character.offsetX) ||
    scene.character.offsetX < -12 ||
    scene.character.offsetX > 12 ||
    !Number.isInteger(scene.character.offsetY) ||
    scene.character.offsetY < -12 ||
    scene.character.offsetY > 12 ||
    !Number.isFinite(scene.character.opacity) ||
    scene.character.opacity < 0 ||
    scene.character.opacity > 1
  ) {
    return ''
  }

  const declarations = [
    `  --kun-ui-plugin-scene-character-offset-x: ${scene.character.offsetX}%;`,
    `  --kun-ui-plugin-scene-character-offset-y: ${scene.character.offsetY}%;`,
    `  --kun-ui-plugin-scene-character-opacity: ${formatCssNumber(scene.character.opacity)};`
  ]
  for (const slot of UI_PLUGIN_SCENE_ARTWORK_SLOTS) {
    const layer = scene.artwork[slot]
    if (!layer) continue
    if (
      !Number.isInteger(layer.offsetX) ||
      layer.offsetX < -12 ||
      layer.offsetX > 12 ||
      !Number.isInteger(layer.offsetY) ||
      layer.offsetY < -12 ||
      layer.offsetY > 12 ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1
    ) {
      return ''
    }
    declarations.push(
      `  --kun-ui-plugin-scene-${slot}-offset-x: ${layer.offsetX}%;`,
      `  --kun-ui-plugin-scene-${slot}-offset-y: ${layer.offsetY}%;`,
      `  --kun-ui-plugin-scene-${slot}-opacity: ${formatCssNumber(layer.opacity)};`
    )
  }
  return `html[data-ui-plugin='${manifest.id}'] {\n${declarations.join('\n')}\n}`
}

const UI_PLUGIN_BACKGROUND_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/

function isSafeUiPluginBackgroundDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = UI_PLUGIN_BACKGROUND_DATA_URL_PATTERN.exec(value)
  return match !== null && match[1].length > 0 && match[1].length % 4 === 0
}

function runtimeBackgroundDataUrl(
  runtimeBackgrounds: UiPluginRuntimeBackgrounds | null | undefined,
  theme: UiPluginBackgroundTheme,
  slot: UiPluginBackgroundSlot,
  relativePath: string
): string | undefined {
  const assets = runtimeBackgrounds?.assets
  if (assets && Object.prototype.hasOwnProperty.call(assets, relativePath)) {
    return assets[relativePath]
  }
  return runtimeBackgrounds?.[theme]?.[slot]
}

const UI_PLUGIN_BACKGROUND_CSS_POSITION: Readonly<Record<UiPluginBackgroundPosition, string>> = {
  'top-left': 'left top',
  top: 'center top',
  'top-right': 'right top',
  left: 'left center',
  center: 'center center',
  right: 'right center',
  'bottom-left': 'left bottom',
  bottom: 'center bottom',
  'bottom-right': 'right bottom'
}

const UI_PLUGIN_BACKGROUND_HOSTS: Readonly<
  Record<UiPluginBackgroundSlot, { selectors: readonly string[]; baseBackground: string }>
> = {
  app: {
    selectors: ['.ds-workbench-shell', '.ds-settings-surface'],
    baseBackground: 'var(--ds-bg-main)'
  },
  sidebar: {
    selectors: ['.ds-sidebar-shell', '.ds-settings-sidebar'],
    baseBackground: 'var(--ds-sidebar-gradient)'
  },
  stage: {
    selectors: ['.ds-stage-surface', '.ds-settings-stage'],
    baseBackground: 'var(--ds-stage-gradient)'
  }
}

const UI_PLUGIN_APP_CHILD_SURFACES = [
  '.ds-sidebar-shell',
  '.ds-stage-surface',
  '.ds-settings-sidebar',
  '.ds-settings-stage'
] as const

const UI_PLUGIN_STAGE_REVEAL_SURFACES = [
  '.ds-stage-route-host > *',
  '.ds-stage-design-canvas',
  '.ds-stage-design-canvas-fill'
] as const

function uiPluginThemeSelector(id: string, theme: UiPluginBackgroundTheme): string {
  return theme === 'dark'
    ? `html[data-ui-plugin='${id}'][data-theme='dark']`
    : `html[data-ui-plugin='${id}']:not([data-theme='dark'])`
}

function formatCssNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 生成背景层样式。manifest 只提供布局参数,图片来源只能是主进程验证后传入的
 * base64 data URL;因此不会把插件提供的原始路径拼入 CSS。
 *
 * 图片放在各表面的独立 ::after 层并直接使用 layer.opacity。这样可以保留宿主
 * 原有渐变，也不会要求插件 token 中的 --ds-bg-* 必须是 color-mix 可接受的纯色。
 */
export function buildUiPluginBackgroundCss(
  manifest: UiPluginManifestV1,
  runtimeBackgrounds: UiPluginRuntimeBackgrounds | null | undefined
): string {
  if (!UI_PLUGIN_ID_PATTERN.test(manifest.id)) return ''

  const blocks: string[] = []
  const assetVariables = new Map<string, string>()
  const layerVariables = new Map<string, string>()
  for (const theme of UI_PLUGIN_BACKGROUND_THEMES) {
    for (const slot of UI_PLUGIN_BACKGROUND_SLOTS) {
      const layer = manifest.backgrounds?.[theme]?.[slot]
      if (
        !layer ||
        !(UI_PLUGIN_BACKGROUND_FITS as readonly string[]).includes(layer.fit) ||
        !(UI_PLUGIN_BACKGROUND_POSITIONS as readonly string[]).includes(layer.position) ||
        !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 ||
        layer.opacity > 1
      ) {
        continue
      }
      const dataUrl = runtimeBackgroundDataUrl(
        runtimeBackgrounds,
        theme,
        slot,
        layer.path
      )
      if (!isSafeUiPluginBackgroundDataUrl(dataUrl)) continue
      let variable = assetVariables.get(dataUrl)
      if (!variable) {
        variable = `--kun-ui-plugin-background-${assetVariables.size}`
        assetVariables.set(dataUrl, variable)
      }
      layerVariables.set(`${theme}.${slot}`, variable)
    }
  }

  if (assetVariables.size > 0) {
    const declarations = [...assetVariables]
      .map(([dataUrl, variable]) => `  ${variable}: url("${dataUrl}");`)
      .join('\n')
    blocks.push(`html[data-ui-plugin='${manifest.id}'] {\n${declarations}\n}`)
  }

  for (const theme of UI_PLUGIN_BACKGROUND_THEMES) {
    const rootSelector = uiPluginThemeSelector(manifest.id, theme)
    let revealStageRoute = false
    for (const slot of UI_PLUGIN_BACKGROUND_SLOTS) {
      const layer = manifest.backgrounds?.[theme]?.[slot]
      const assetVariable = layerVariables.get(`${theme}.${slot}`)
      if (
        !layer ||
        !(UI_PLUGIN_BACKGROUND_FITS as readonly string[]).includes(layer.fit) ||
        !(UI_PLUGIN_BACKGROUND_POSITIONS as readonly string[]).includes(layer.position) ||
        !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 ||
        layer.opacity > 1 ||
        !assetVariable
      ) {
        continue
      }

      const host = UI_PLUGIN_BACKGROUND_HOSTS[slot]
      const selectors = host.selectors
        .map((selector) => `${rootSelector} ${selector}`)
        .join(',\n')
      const pseudoSelectors = host.selectors
        .map((selector) => `${rootSelector} ${selector}::after`)
        .join(',\n')
      blocks.push(
        `${selectors} {\n` +
          `  position: relative;\n` +
          `  isolation: isolate;\n` +
          `  background: ${host.baseBackground};\n` +
          `}\n\n` +
          `${pseudoSelectors} {\n` +
          `  content: '';\n` +
          `  position: absolute;\n` +
          `  inset: 0;\n` +
          `  z-index: -1;\n` +
          `  pointer-events: none;\n` +
          `  background-image: var(${assetVariable});\n` +
          `  background-size: ${layer.fit};\n` +
          `  background-position: ${UI_PLUGIN_BACKGROUND_CSS_POSITION[layer.position]};\n` +
          `  background-repeat: no-repeat;\n` +
          `  opacity: ${formatCssNumber(layer.opacity)};\n` +
          `}`
      )

      if (slot === 'app') {
        const childSurfaceSelectors = UI_PLUGIN_APP_CHILD_SURFACES
          .map((selector) => `${rootSelector} ${selector}`)
          .join(',\n')
        blocks.push(`${childSurfaceSelectors} {\n  background: transparent;\n}`)
        revealStageRoute = true
      } else if (slot === 'stage') {
        revealStageRoute = true
      }
    }

    if (revealStageRoute) {
      const revealSelectors = UI_PLUGIN_STAGE_REVEAL_SURFACES
        .map((selector) => `${rootSelector} ${selector}`)
        .join(',\n')
      blocks.push(
        `${revealSelectors} {\n` +
          `  background-color: transparent !important;\n` +
          `}`
      )
    }

    if (Object.prototype.hasOwnProperty.call(manifest.tokens?.[theme] ?? {}, '--ds-topbar-bg')) {
      blocks.push(
        `${rootSelector} .ds-topbar-surface {\n` +
          `  background: var(--ds-topbar-bg);\n` +
          `}`
      )
    }
  }
  return blocks.join('\n\n')
}

/** 按槽位回退链取形象:返回第一个有值的槽位 data URL */
export function resolveUiPluginFigure(
  figures: UiPluginRuntimeFigures | null | undefined,
  slots: readonly UiPluginFigureSlot[]
): string | null {
  if (!figures) return null
  for (const slot of slots) {
    const value = figures[slot]
    if (value) return value
  }
  return null
}
