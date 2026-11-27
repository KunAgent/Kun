export type KuroCatSpotPart = 'head' | 'body' | 'leftArm' | 'rightArm'

export interface KuroCatSpot {
  part: KuroCatSpotPart
  x: number
  y: number
  rx: number
  ry: number
  rotation?: number
  color: string
  opacity?: number
}

export type KuroCatPattern = 'solid' | 'bicolor' | 'tuxedo' | 'tabby' | 'calico' | 'siamese'
export type KuroCatFaceShape = 'round' | 'square' | 'wide' | 'fox' | 'oval'
export type KuroCatEarShape = 'cat' | 'round' | 'tall' | 'small' | 'wide' | 'folded' | 'floppy'
export type KuroCatPupilShape = 'oval' | 'round' | 'slit' | 'dot' | 'star'
export type KuroCatNoseShape = 'cat' | 'round' | 'wide' | 'small' | 'none'
export type KuroCatMouthShape = 'w' | 'smile' | 'flat' | 'open' | 'blep' | 'none'
export type KuroCatEyebrowStyle = 'none' | 'soft' | 'thick' | 'angry' | 'worried'
export type KuroCatCollarColor = 'none' | 'red' | 'blue' | 'pink' | 'green' | 'gold' | 'purple' | 'black'
export type KuroCatKeyboardLayout = '65' | '108'
export type KuroCatKeyboardOrientation = 'cat' | 'viewer'
export type KuroCatTailKeyMode = 'smart' | 'custom' | 'edge' | 'off'
export type KuroCatHeadphoneMode = 'off' | 'auto' | 'on'

export interface KuroCatContourResolved {
  faceShape: KuroCatFaceShape
  headWidth: number
  jawSquareness: number
  earShape: KuroCatEarShape
  earScale: number
  earSpacing: number
  earTilt: number
  eyeSquint: number
  eyeScale: number
  eyeAspect: number
  eyeSpacing: number
  eyeOffsetY: number
  eyeTilt: number
  pupilShape: KuroCatPupilShape
  pupilScale: number
  noseShape: KuroCatNoseShape
  noseScale: number
  noseOffsetY: number
  mouthShape: KuroCatMouthShape
  mouthScale: number
  mouthOffsetY: number
  whiskerLength: number
  eyebrowStyle: KuroCatEyebrowStyle
  blushAlways: boolean
  blushScale: number
  bodyChubbiness: number
}

export interface KuroCatSkinConfig {
  id: string
  name: string
  emoji?: string
  builtin?: boolean

  furColor: string
  furSecondaryColor?: string
  outlineColor?: string
  legLineColor?: string

  pattern?: KuroCatPattern
  maskColor?: string
  foreheadBridgeColor?: string
  flankColor?: string
  bellyBibColor?: string
  stripeColor?: string
  calicoPatchColor?: string

  earOuterColor?: string
  earTipColor?: string
  earInnerColor?: string
  earTuftColor?: string

  tailColor?: string
  tailTipColor?: string
  tailFluffy?: boolean
  tailStripes?: boolean

  eyeColorTop: string
  eyeColorBottom?: string
  rightEyeColorTop?: string
  rightEyeColorBottom?: string
  pupilColor?: string
  eyeCatchlight?: boolean
  eyeRimColor?: string
  squintColor?: string
  squintGlowColor?: string
  noseColor?: string
  mouthColor?: string
  blushColor?: string
  whiskerColor?: string

  armColor?: string
  pawColor?: string
  pawOutlineColor?: string
  armCreaseColor?: string

  accentColor?: string
  accentSideColor?: string

  faceShape?: KuroCatFaceShape
  headWidth?: number
  jawSquareness?: number
  earShape?: KuroCatEarShape
  earScale?: number
  earSpacing?: number
  earTilt?: number
  eyeSquint?: number
  eyeScale?: number
  eyeAspect?: number
  eyeSpacing?: number
  eyeOffsetY?: number
  eyeTilt?: number
  pupilShape?: KuroCatPupilShape
  pupilScale?: number
  noseShape?: KuroCatNoseShape
  noseScale?: number
  noseOffsetY?: number
  mouthShape?: KuroCatMouthShape
  mouthScale?: number
  mouthOffsetY?: number
  whiskerLength?: number
  eyebrowStyle?: KuroCatEyebrowStyle
  eyebrowColor?: string
  blushAlways?: boolean
  blushScale?: number
  bodyChubbiness?: number

  spots?: KuroCatSpot[]
}

export interface ResolvedKuroCatSkin {
  id: string
  name: string
  isDarkBase: boolean
  furColor: string
  furSecondaryColor: string
  outlineColor: string | null
  legLineColor: string
  pattern: KuroCatPattern
  maskColor: string | null
  foreheadBridgeColor: string | null
  flankColor: string | null
  bellyBibColor: string | null
  stripeColor: string | null
  calicoPatchColor: string | null
  earOuterColor: string
  earTipColor: string | null
  earInnerColor: string | null
  earTuftColor: string | null
  tailColor: string
  tailTipColor: string
  tailFluffy: boolean
  tailStripes: boolean
  eyeColorTop: string
  eyeColorBottom: string
  rightEyeColorTop: string
  rightEyeColorBottom: string
  pupilColor: string
  eyeCatchlight: boolean
  eyeRimColor: string | null
  squintColor: string
  squintGlowColor: string | null
  noseColor: string | null
  mouthColor: string | null
  blushColor: string | null
  whiskerColor: string
  eyebrowColor: string
  armColor: string
  pawColor: string
  pawOutlineColor: string | null
  armCreaseColor: string | null
  accentColor: string
  accentSideColor: string
  contour: KuroCatContourResolved
  spots: KuroCatSpot[]
}

export interface KuroCatUserPrefs {
  catBreed?: string
  keyboardLayout: KuroCatKeyboardLayout
  keyboardOrientation: KuroCatKeyboardOrientation
  tailKeyMode: KuroCatTailKeyMode
  tailKeyIds: string[]
  showKeyBubbles: boolean
  collarColor: KuroCatCollarColor
  headphoneMode: KuroCatHeadphoneMode
  opacity: number
}

export const DEFAULT_KUROCAT_TAIL_KEY_IDS = ['enter', 'space', 'bs', 'esc'] as const

export function defaultKuroCatUserPrefs(): KuroCatUserPrefs {
  return {
    keyboardLayout: '65',
    keyboardOrientation: 'cat',
    tailKeyMode: 'smart',
    tailKeyIds: [...DEFAULT_KUROCAT_TAIL_KEY_IDS],
    showKeyBubbles: true,
    collarColor: 'none',
    headphoneMode: 'auto',
    opacity: 1
  }
}

export { BUILTIN_KUROCAT_SKINS } from './pets-kurocat-presets'

const clampNum = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function isValidKuroCatColor(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const s = raw.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return true
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i.test(s)) {
    return s.length <= 48
  }
  return false
}

export function sanitizeKuroCatId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned || 'custom-cat'
}

function normalizeFaceShape(raw: unknown): KuroCatFaceShape {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'square' || s === 'box' || s === 'tibetan-fox' || s === 'fox-square') return 'square'
  if (s === 'wide' || s === 'tiger' || s === 'broad' || s === 'bear') return 'wide'
  if (s === 'fox' || s === 'pointed' || s === 'slim' || s === 'v') return 'fox'
  if (s === 'oval' || s === 'tall' || s === 'long') return 'oval'
  return 'round'
}

function normalizeEarShape(raw: unknown): KuroCatEarShape {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'round' || s === 'bear' || s === 'panda') return 'round'
  if (s === 'tall' || s === 'bunny' || s === 'corgi') return 'tall'
  if (s === 'small' || s === 'otter') return 'small'
  if (s === 'wide' || s === 'fennec') return 'wide'
  if (s === 'folded' || s === 'fold') return 'folded'
  if (s === 'floppy' || s === 'dog' || s === 'puppy' || s === 'lop') return 'floppy'
  return 'cat'
}

function normalizePupilShape(raw: unknown): KuroCatPupilShape {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'round' || s === 'slit' || s === 'dot' || s === 'star') return s
  return 'oval'
}

function normalizeNoseShape(raw: unknown): KuroCatNoseShape {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'round' || s === 'wide' || s === 'small' || s === 'none') return s
  return 'cat'
}

function normalizeMouthShape(raw: unknown): KuroCatMouthShape {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'smile' || s === 'flat' || s === 'open' || s === 'blep' || s === 'none') return s
  return 'w'
}

function normalizeEyebrowStyle(raw: unknown): KuroCatEyebrowStyle {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'soft' || s === 'thick' || s === 'angry' || s === 'worried') return s
  return 'none'
}

function normalizePattern(raw: unknown): KuroCatPattern {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'bicolor' || s === 'tuxedo' || s === 'tabby' || s === 'calico' || s === 'siamese') return s
  return 'solid'
}

export function resolveKuroCatContour(raw?: Partial<KuroCatSkinConfig> | null): KuroCatContourResolved {
  const faceShape = normalizeFaceShape(raw?.faceShape)
  const earShape = normalizeEarShape(raw?.earShape)
  const pupilShape = normalizePupilShape(raw?.pupilShape)
  const noseShape = normalizeNoseShape(raw?.noseShape)
  const mouthShape = normalizeMouthShape(raw?.mouthShape)
  const eyebrowStyle = normalizeEyebrowStyle(raw?.eyebrowStyle)

  const numOr = (val: unknown, lo: number, hi: number, fallback: number): number =>
    typeof val === 'number' && Number.isFinite(val) ? clampNum(val, lo, hi) : fallback

  const defaultHeadWidth = faceShape === 'square' ? 1.14
    : faceShape === 'wide' ? 1.12
    : faceShape === 'fox' ? 0.98
    : faceShape === 'oval' ? 0.93 : 1.0
  const defaultJawSquareness = faceShape === 'square' ? 0.88 : faceShape === 'wide' ? 0.36 : 0.0

  return {
    faceShape,
    headWidth: numOr(raw?.headWidth, 0.78, 1.32, defaultHeadWidth),
    jawSquareness: numOr(raw?.jawSquareness, 0.0, 1.0, defaultJawSquareness),
    earShape,
    earScale: numOr(raw?.earScale, 0.55, 1.55, 1.0),
    earSpacing: numOr(raw?.earSpacing, 0.70, 1.35, 1.0),
    earTilt: numOr(raw?.earTilt, -0.45, 0.65, 0.0),
    eyeSquint: numOr(raw?.eyeSquint, 0.0, 0.75, 0.0),
    eyeScale: numOr(raw?.eyeScale, 0.55, 1.45, 1.0),
    eyeAspect: numOr(raw?.eyeAspect, 0.60, 1.40, 1.0),
    eyeSpacing: numOr(raw?.eyeSpacing, 0.72, 1.35, 1.0),
    eyeOffsetY: numOr(raw?.eyeOffsetY, -1.0, 1.0, 0.0),
    eyeTilt: numOr(raw?.eyeTilt, -0.50, 0.50, 0.0),
    pupilShape,
    pupilScale: numOr(raw?.pupilScale, 0.40, 1.45, 1.0),
    noseShape,
    noseScale: numOr(raw?.noseScale, 0.50, 1.80, 1.0),
    noseOffsetY: numOr(raw?.noseOffsetY, -1.0, 1.0, 0.0),
    mouthShape,
    mouthScale: numOr(raw?.mouthScale, 0.55, 1.70, 1.0),
    mouthOffsetY: numOr(raw?.mouthOffsetY, -1.0, 1.0, 0.0),
    whiskerLength: numOr(raw?.whiskerLength, 0.0, 1.60, 1.0),
    eyebrowStyle,
    blushAlways: Boolean(raw?.blushAlways),
    blushScale: numOr(raw?.blushScale, 0.50, 1.60, 1.0),
    bodyChubbiness: numOr(raw?.bodyChubbiness, 0.80, 1.25, 1.0)
  }
}

export function parseHexLuminance(hex: string): number {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return 0.5
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function isLightKuroCatColor(hex: string): boolean {
  return parseHexLuminance(hex) > 0.48
}

export function resolveKuroCatSkin(raw: KuroCatSkinConfig): ResolvedKuroCatSkin {
  const fur = raw.furColor || '#f2a452'
  const darkBase = !isLightKuroCatColor(fur)
  const pattern: KuroCatPattern = raw.pattern || 'solid'
  const defaultOutline = darkBase ? null : '#524840'
  const outlineColor = raw.outlineColor !== undefined ? (raw.outlineColor || null) : defaultOutline
  const pawColor = raw.pawColor || (pattern === 'tuxedo' ? '#faf9f5' : fur)
  const armColor = raw.armColor || fur
  const pawIsLight = isLightKuroCatColor(pawColor)

  return {
    id: raw.id,
    name: raw.name || raw.id,
    isDarkBase: darkBase,
    furColor: fur,
    furSecondaryColor: raw.furSecondaryColor || fur,
    outlineColor,
    legLineColor: raw.legLineColor || (darkBase ? 'rgba(214, 218, 224, 0.62)' : 'rgba(82, 72, 64, 0.62)'),
    pattern,
    maskColor: raw.maskColor || (pattern === 'siamese' ? '#4a382c' : pattern === 'bicolor' ? '#9e8e7f' : null),
    foreheadBridgeColor: raw.foreheadBridgeColor || null,
    flankColor: raw.flankColor || null,
    bellyBibColor: raw.bellyBibColor || (pattern === 'tuxedo' ? '#faf9f5' : null),
    stripeColor: raw.stripeColor || (pattern === 'tabby' ? '#9e5318' : null),
    calicoPatchColor: raw.calicoPatchColor || (pattern === 'calico' ? '#3a3533' : null),
    earOuterColor: raw.earOuterColor || raw.maskColor || fur,
    earTipColor: raw.earTipColor || null,
    earInnerColor: raw.earInnerColor || (darkBase ? null : '#efc4c8'),
    earTuftColor: raw.earTuftColor || null,
    tailColor: raw.tailColor || raw.earOuterColor || raw.maskColor || fur,
    tailTipColor: raw.tailTipColor || raw.earTipColor || raw.tailColor || fur,
    tailFluffy: Boolean(raw.tailFluffy),
    tailStripes: Boolean(raw.tailStripes || pattern === 'tabby'),
    eyeColorTop: raw.eyeColorTop || '#5a94d6',
    eyeColorBottom: raw.eyeColorBottom || raw.eyeColorTop || '#a3d2f2',
    rightEyeColorTop: raw.rightEyeColorTop || raw.eyeColorTop || '#5a94d6',
    rightEyeColorBottom: raw.rightEyeColorBottom || raw.rightEyeColorTop || raw.eyeColorBottom || raw.eyeColorTop || '#a3d2f2',
    pupilColor: raw.pupilColor || '#10141e',
    eyeCatchlight: raw.eyeCatchlight ?? !darkBase,
    eyeRimColor: raw.eyeRimColor || (darkBase ? null : 'rgba(42, 46, 58, 0.78)'),
    squintColor: raw.squintColor || (darkBase ? raw.eyeColorTop || '#d4f044' : '#2c2928'),
    squintGlowColor: raw.squintGlowColor || null,
    noseColor: raw.noseColor !== undefined ? (raw.noseColor || null) : (darkBase ? null : '#ee8e9e'),
    mouthColor: raw.mouthColor || (darkBase ? null : 'rgba(72, 68, 76, 0.78)'),
    blushColor: raw.blushColor || (darkBase ? null : '#f492a6'),
    whiskerColor: raw.whiskerColor || (darkBase ? 'rgba(210, 214, 220, 0.56)' : 'rgba(84, 76, 70, 0.56)'),
    eyebrowColor: raw.eyebrowColor || (darkBase ? '#e8e2d4' : outlineColor || '#4a3d35'),
    armColor,
    pawColor,
    pawOutlineColor: raw.pawOutlineColor !== undefined ? (raw.pawOutlineColor || null) : (pawIsLight ? outlineColor || '#524840' : null),
    armCreaseColor: raw.armCreaseColor !== undefined ? (raw.armCreaseColor || null) : (!pawIsLight ? 'rgba(216, 218, 222, 0.62)' : null),
    accentColor: raw.accentColor || '#d2f244',
    accentSideColor: raw.accentSideColor || '#8cb014',
    contour: resolveKuroCatContour(raw),
    spots: Array.isArray(raw.spots) ? raw.spots : []
  }
}

function pickField(obj: Record<string, unknown>, camel: string, snake: string): unknown {
  return obj[camel] !== undefined ? obj[camel] : obj[snake]
}

function optColor(obj: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const raw = pickField(obj, camel, snake)
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return isValidKuroCatColor(trimmed) ? trimmed : undefined
}

function optNum(obj: Record<string, unknown>, camel: string, snake: string, lo: number, hi: number): number | undefined {
  const raw = pickField(obj, camel, snake)
  return typeof raw === 'number' && Number.isFinite(raw) ? clampNum(raw, lo, hi) : undefined
}

function parseSpot(value: unknown): KuroCatSpot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const c = value as Record<string, unknown>
  const partRaw = typeof c.part === 'string' ? c.part.trim() : ''
  const part: KuroCatSpotPart | null =
    partRaw === 'head' || partRaw === 'body' || partRaw === 'leftArm' || partRaw === 'rightArm'
      ? partRaw
      : partRaw === 'left_arm' ? 'leftArm' : partRaw === 'right_arm' ? 'rightArm' : null
  if (!part || !isValidKuroCatColor(c.color)) return null
  const x = typeof c.x === 'number' && Number.isFinite(c.x) ? clampNum(c.x, -1.2, 1.2) : 0
  const y = typeof c.y === 'number' && Number.isFinite(c.y) ? clampNum(c.y, -1.2, 1.2) : 0
  const normR = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 8
    return clampNum(v <= 1.2 ? v * 48 : v, 2, 48)
  }
  const rx = normR(c.rx)
  const ry = normR(c.ry)
  return {
    part,
    x,
    y,
    rx,
    ry,
    color: c.color.trim(),
    ...(typeof c.rotation === 'number' && Number.isFinite(c.rotation) ? { rotation: clampNum(c.rotation, -Math.PI, Math.PI) } : {}),
    ...(typeof c.opacity === 'number' && Number.isFinite(c.opacity) ? { opacity: clampNum(c.opacity, 0.05, 1) } : {})
  }
}

/** Parse and sanitize a single KuroCat skin/plugin object (supports camelCase & snake_case). */
export function parseKuroCatSkinConfig(value: unknown, fallbackId?: string): KuroCatSkinConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const c = value as Record<string, unknown>
  // Avoid misidentifying standard Kun pet.json manifests without KuroCat skin fields.
  if (typeof c.spritesheetPath === 'string' && pickField(c, 'furColor', 'fur_color') === undefined) return null

  const furColor = optColor(c, 'furColor', 'fur_color') ?? optColor(c, 'coatColor', 'coat_color')
  const eyeColorTop = optColor(c, 'eyeColorTop', 'eye_color_top') ?? optColor(c, 'eyeColor', 'eye_color')
  if (!furColor && !eyeColorTop && typeof c.pattern !== 'string') return null

  const rawId = typeof c.id === 'string' && c.id.trim() ? c.id : (fallbackId ?? '')
  const id = sanitizeKuroCatId(rawId)
  if (!id || id === 'dafeiyu') return null
  const rawName = typeof c.name === 'string' && c.name.trim()
    ? c.name.trim().slice(0, 60)
    : typeof c.displayName === 'string' && c.displayName.trim()
      ? c.displayName.trim().slice(0, 60)
      : id
  const emoji = typeof c.emoji === 'string' && c.emoji.trim() ? c.emoji.trim().slice(0, 12) : undefined

  const rawSpots = Array.isArray(c.spots) ? c.spots : []
  const spots: KuroCatSpot[] = []
  for (const item of rawSpots) {
    if (spots.length >= 16) break
    const parsed = parseSpot(item)
    if (parsed) spots.push(parsed)
  }

  const contour = resolveKuroCatContour({
    faceShape: pickField(c, 'faceShape', 'face_shape') as KuroCatFaceShape | undefined,
    earShape: pickField(c, 'earShape', 'ear_shape') as KuroCatEarShape | undefined,
    pupilShape: pickField(c, 'pupilShape', 'pupil_shape') as KuroCatPupilShape | undefined,
    noseShape: pickField(c, 'noseShape', 'nose_shape') as KuroCatNoseShape | undefined,
    mouthShape: pickField(c, 'mouthShape', 'mouth_shape') as KuroCatMouthShape | undefined,
    eyebrowStyle: pickField(c, 'eyebrowStyle', 'eyebrow_style') as KuroCatEyebrowStyle | undefined
  })

  const setOpt = <K extends keyof KuroCatSkinConfig>(target: KuroCatSkinConfig, key: K, val: KuroCatSkinConfig[K] | undefined): void => {
    if (val !== undefined) target[key] = val
  }

  const out: KuroCatSkinConfig = {
    id,
    name: rawName,
    furColor: furColor ?? '#141314',
    eyeColorTop: eyeColorTop ?? '#d4f044'
  }
  setOpt(out, 'emoji', emoji)
  if (typeof c.builtin === 'boolean') out.builtin = c.builtin
  if (c.pattern !== undefined) out.pattern = normalizePattern(c.pattern)

  const colorFields: Array<[keyof KuroCatSkinConfig, string, string]> = [
    ['furSecondaryColor', 'furSecondaryColor', 'fur_secondary_color'],
    ['outlineColor', 'outlineColor', 'outline_color'],
    ['legLineColor', 'legLineColor', 'leg_line_color'],
    ['maskColor', 'maskColor', 'mask_color'],
    ['foreheadBridgeColor', 'foreheadBridgeColor', 'forehead_bridge_color'],
    ['flankColor', 'flankColor', 'flank_color'],
    ['bellyBibColor', 'bellyBibColor', 'belly_bib_color'],
    ['stripeColor', 'stripeColor', 'stripe_color'],
    ['calicoPatchColor', 'calicoPatchColor', 'calico_patch_color'],
    ['earOuterColor', 'earOuterColor', 'ear_outer_color'],
    ['earTipColor', 'earTipColor', 'ear_tip_color'],
    ['earInnerColor', 'earInnerColor', 'ear_inner_color'],
    ['earTuftColor', 'earTuftColor', 'ear_tuft_color'],
    ['tailColor', 'tailColor', 'tail_color'],
    ['tailTipColor', 'tailTipColor', 'tail_tip_color'],
    ['eyeColorBottom', 'eyeColorBottom', 'eye_color_bottom'],
    ['rightEyeColorTop', 'rightEyeColorTop', 'right_eye_color_top'],
    ['rightEyeColorBottom', 'rightEyeColorBottom', 'right_eye_color_bottom'],
    ['pupilColor', 'pupilColor', 'pupil_color'],
    ['eyeRimColor', 'eyeRimColor', 'eye_rim_color'],
    ['squintColor', 'squintColor', 'squint_color'],
    ['squintGlowColor', 'squintGlowColor', 'squint_glow_color'],
    ['noseColor', 'noseColor', 'nose_color'],
    ['mouthColor', 'mouthColor', 'mouth_color'],
    ['blushColor', 'blushColor', 'blush_color'],
    ['whiskerColor', 'whiskerColor', 'whisker_color'],
    ['eyebrowColor', 'eyebrowColor', 'eyebrow_color'],
    ['armColor', 'armColor', 'arm_color'],
    ['pawColor', 'pawColor', 'paw_color'],
    ['pawOutlineColor', 'pawOutlineColor', 'paw_outline_color'],
    ['armCreaseColor', 'armCreaseColor', 'arm_crease_color'],
    ['accentColor', 'accentColor', 'accent_color'],
    ['accentSideColor', 'accentSideColor', 'accent_side_color']
  ]
  for (const [key, camel, snake] of colorFields) {
    setOpt(out, key, optColor(c, camel, snake) as never)
  }

  const tailFluffy = pickField(c, 'tailFluffy', 'tail_fluffy')
  if (typeof tailFluffy === 'boolean') out.tailFluffy = tailFluffy
  const tailStripes = pickField(c, 'tailStripes', 'tail_stripes')
  if (typeof tailStripes === 'boolean') out.tailStripes = tailStripes
  const eyeCatchlight = pickField(c, 'eyeCatchlight', 'eye_catchlight')
  if (typeof eyeCatchlight === 'boolean') out.eyeCatchlight = eyeCatchlight
  const blushAlways = pickField(c, 'blushAlways', 'blush_always')
  if (typeof blushAlways === 'boolean') out.blushAlways = blushAlways

  if (pickField(c, 'faceShape', 'face_shape') !== undefined) out.faceShape = contour.faceShape
  if (pickField(c, 'earShape', 'ear_shape') !== undefined) out.earShape = contour.earShape
  if (pickField(c, 'pupilShape', 'pupil_shape') !== undefined) out.pupilShape = contour.pupilShape
  if (pickField(c, 'noseShape', 'nose_shape') !== undefined) out.noseShape = contour.noseShape
  if (pickField(c, 'mouthShape', 'mouth_shape') !== undefined) out.mouthShape = contour.mouthShape
  if (pickField(c, 'eyebrowStyle', 'eyebrow_style') !== undefined) out.eyebrowStyle = contour.eyebrowStyle

  const numFields: Array<[keyof KuroCatSkinConfig, string, string, number, number]> = [
    ['headWidth', 'headWidth', 'head_width', 0.78, 1.32],
    ['jawSquareness', 'jawSquareness', 'jaw_squareness', 0.0, 1.0],
    ['earScale', 'earScale', 'ear_scale', 0.55, 1.55],
    ['earSpacing', 'earSpacing', 'ear_spacing', 0.70, 1.35],
    ['earTilt', 'earTilt', 'ear_tilt', -0.45, 0.65],
    ['eyeSquint', 'eyeSquint', 'eye_squint', 0.0, 0.75],
    ['eyeScale', 'eyeScale', 'eye_scale', 0.55, 1.45],
    ['eyeAspect', 'eyeAspect', 'eye_aspect', 0.60, 1.40],
    ['eyeSpacing', 'eyeSpacing', 'eye_spacing', 0.72, 1.35],
    ['eyeOffsetY', 'eyeOffsetY', 'eye_offset_y', -1.0, 1.0],
    ['eyeTilt', 'eyeTilt', 'eye_tilt', -0.50, 0.50],
    ['pupilScale', 'pupilScale', 'pupil_scale', 0.40, 1.45],
    ['noseScale', 'noseScale', 'nose_scale', 0.50, 1.80],
    ['noseOffsetY', 'noseOffsetY', 'nose_offset_y', -1.0, 1.0],
    ['mouthScale', 'mouthScale', 'mouth_scale', 0.55, 1.70],
    ['mouthOffsetY', 'mouthOffsetY', 'mouth_offset_y', -1.0, 1.0],
    ['whiskerLength', 'whiskerLength', 'whisker_length', 0.0, 1.60],
    ['blushScale', 'blushScale', 'blush_scale', 0.50, 1.60],
    ['bodyChubbiness', 'bodyChubbiness', 'body_chubbiness', 0.80, 1.25]
  ]
  for (const [key, camel, snake, lo, hi] of numFields) {
    setOpt(out, key, optNum(c, camel, snake, lo, hi) as never)
  }
  if (out.headWidth === undefined) setOpt(out, 'headWidth', optNum(c, 'faceWidth', 'face_width', 0.78, 1.32))
  if (out.eyeScale === undefined) setOpt(out, 'eyeScale', optNum(c, 'eyeSize', 'eye_size', 0.55, 1.45))
  if (out.maskColor === undefined) setOpt(out, 'maskColor', optColor(c, 'pointColor', 'point_color') ?? optColor(c, 'markingColor', 'marking_color'))
  if (out.bellyBibColor === undefined) setOpt(out, 'bellyBibColor', optColor(c, 'bellyColor', 'belly_color'))
  if (out.stripeColor === undefined) setOpt(out, 'stripeColor', optColor(c, 'markingColor', 'marking_color'))
  if (out.calicoPatchColor === undefined) setOpt(out, 'calicoPatchColor', optColor(c, 'patch2Color', 'patch2_color'))
  if (spots.length > 0) out.spots = spots
  return out
}

/** Extract 1 or more KuroCat skins from a standalone plugin JSON, cats.json array, or wrapper object. */
export function extractKuroCatSkinsFromJson(value: unknown, fallbackId?: string): KuroCatSkinConfig[] {
  if (Array.isArray(value)) {
    const skins: KuroCatSkinConfig[] = []
    for (let i = 0; i < value.length && skins.length < 128; i++) {
      const parsed = parseKuroCatSkinConfig(value[i], fallbackId ? `${fallbackId}-${i + 1}` : undefined)
      if (parsed) skins.push(parsed)
    }
    return skins
  }
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (Array.isArray(record.cats)) return extractKuroCatSkinsFromJson(record.cats, fallbackId)
  if (Array.isArray(record.skins)) return extractKuroCatSkinsFromJson(record.skins, fallbackId)
  if (record.cat && typeof record.cat === 'object') {
    const single = parseKuroCatSkinConfig(record.cat, fallbackId)
    return single ? [single] : []
  }
  if (record.skin && typeof record.skin === 'object') {
    const single = parseKuroCatSkinConfig(record.skin, fallbackId)
    return single ? [single] : []
  }
  const direct = parseKuroCatSkinConfig(record, fallbackId)
  return direct ? [direct] : []
}

export function parseKuroCatUserPrefs(value: unknown): KuroCatUserPrefs {
  const defaults = defaultKuroCatUserPrefs()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const c = value as Record<string, unknown>
  const layoutRaw = pickField(c, 'keyboardLayout', 'keyboard_layout')
  const orientRaw = pickField(c, 'keyboardOrientation', 'keyboard_orientation')
  const tailModeRaw = pickField(c, 'tailKeyMode', 'tail_key_mode')
  const collarRaw = pickField(c, 'collarColor', 'collar_color')
  const hpRaw = pickField(c, 'headphoneMode', 'headphone_mode')
  const bubblesRaw = pickField(c, 'showKeyBubbles', 'show_key_bubbles')
  const breedRaw = pickField(c, 'catBreed', 'cat_breed')
  const tailIdsRaw = pickField(c, 'tailKeyIds', 'tail_key_ids')
  const opacityRaw = c.opacity

  const tailKeyIds: string[] = []
  if (Array.isArray(tailIdsRaw)) {
    for (const item of tailIdsRaw) {
      if (typeof item !== 'string') continue
      const clean = item.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
      if (clean && !tailKeyIds.includes(clean)) tailKeyIds.push(clean)
      if (tailKeyIds.length >= 120) break
    }
  }
  let opacity = 1
  if (typeof opacityRaw === 'number' && Number.isFinite(opacityRaw)) {
    const norm = opacityRaw >= 10 && opacityRaw <= 100 ? opacityRaw / 100 : opacityRaw
    opacity = clampNum(norm, 0.2, 1)
  }

  return {
    ...(typeof breedRaw === 'string' && breedRaw.trim() ? { catBreed: sanitizeKuroCatId(breedRaw) } : {}),
    keyboardLayout: layoutRaw === '108' ? '108' : '65',
    keyboardOrientation: orientRaw === 'viewer' || orientRaw === 'user' ? 'viewer' : 'cat',
    tailKeyMode: tailModeRaw === 'custom' || tailModeRaw === 'edge' || tailModeRaw === 'off' ? tailModeRaw : 'smart',
    tailKeyIds: tailKeyIds.length > 0 ? tailKeyIds : [...DEFAULT_KUROCAT_TAIL_KEY_IDS],
    showKeyBubbles: typeof bubblesRaw === 'boolean' ? bubblesRaw : true,
    collarColor: collarRaw === 'red' || collarRaw === 'blue' || collarRaw === 'pink' || collarRaw === 'green' ||
      collarRaw === 'gold' || collarRaw === 'purple' || collarRaw === 'black' ? collarRaw : 'none',
    headphoneMode: hpRaw === 'on' || hpRaw === 'off' || hpRaw === 'auto' ? hpRaw : 'auto',
    opacity
  }
}

export function isKuroCatPetId(petId: string | null | undefined): boolean {
  if (!petId) return false
  return petId === 'kun:kurocat' || petId.startsWith('kurocat:')
}
