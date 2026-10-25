import type { DesignSystemPreset } from '@shared/app-settings'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES
} from '../../../../kun/src/prompt/design-authoring-rules'

// The authoring rules live in Kun so its Design page mode policy and the
// renderer's inline prompts share one copy.
export { DESIGN_CRAFT_LINES, DESIGN_DELIVERY_LINES, DESIGN_RESIZE_RESPONSIVE_LINES }

/** Whether the surface is brand-led or product-led. */
export type DesignSurfaceType = 'brand' | 'product'

/** The user's intended output surface for the design agent. */
export type DesignTarget = 'web' | 'app'

export const DEFAULT_DESIGN_TARGET: DesignTarget = 'web'

/**
 * Design intent injected into every design-agent turn. Generalizes the SDD
 * `SddDesignContext` (designType / brandColor / tone) by ADDING a named
 * design-system preset.
 */
export type DesignContext = {
  /**
   * User-selected output target. `web` is the default; `app` means mobile-first
   * product/app screens and should bias default artboard sizes to phone frames.
   */
  designTarget?: DesignTarget
  designType?: DesignSurfaceType
  /** Anchor brand color (any CSS color string). */
  brandColor?: string
  /** Free-form tone chips, e.g. 编辑风 / 专业 / 科技感. */
  tone?: string[]
  /** Named design-system preset that seeds tokens/voice; undefined / 'none' = no preset. */
  designSystemPreset?: DesignSystemPreset
  /** Free-form additional design rules (from settings.design.designGuidelines). */
  designGuidelines?: string
  radius?: 'sharp' | 'soft' | 'rounded' | 'pill'
  density?: 'compact' | 'cozy' | 'spacious'
  fontStyle?: 'system' | 'geometric' | 'humanist' | 'serif' | 'mono'
}

/** Suggested tone chips offered in the design-context form. */
export const DESIGN_TONE_OPTIONS = [
  '编辑风',
  '专业',
  '活泼',
  '极简',
  '大胆',
  '温暖',
  '科技感',
  '严肃'
] as const

const DESIGN_TYPE_LABEL: Record<DesignSurfaceType, string> = {
  brand: 'Brand-led (marketing / landing / portfolio — design IS the product)',
  product: 'Product-led (app UI / dashboard / tool — design SERVES the product)'
}

const DESIGN_TARGET_LABEL: Record<DesignTarget, string> = {
  web: 'Web — default to responsive browser/web-page or web-app layouts; create desktop screen frames around 1280x800 unless the brief asks for another breakpoint.',
  app: 'App — default to mobile-first app screens; create phone screen frames around 390x844, use app navigation patterns, and design for touch interactions.'
}

export function normalizeDesignTarget(value: unknown): DesignTarget {
  return value === 'app' ? 'app' : DEFAULT_DESIGN_TARGET
}

export function defaultDevicePresetForDesignTarget(target: unknown): 'desktop' | 'mobile' {
  return normalizeDesignTarget(target) === 'app' ? 'mobile' : 'desktop'
}

export function defaultFrameSizeForDesignTarget(target: unknown): { width: number; height: number } {
  return normalizeDesignTarget(target) === 'app'
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 }
}

export function defaultPreviewNodeSizeForDesignTarget(target: unknown): { width: number; height: number } {
  return normalizeDesignTarget(target) === 'app'
    ? { width: 300, height: 640 }
    : { width: 420, height: 340 }
}

const DESIGN_SYSTEM_LABEL: Record<Exclude<DesignSystemPreset, 'none'>, string> = {
  shadcn: 'shadcn/ui — neutral, modern, restrained; Radix primitives, subtle borders, small radii',
  radix: 'Radix Themes — accessible primitives, balanced neutrals, clear focus states',
  material: 'Material Design — elevation, bold color roles, 4dp grid, ripple feedback',
  ios: 'iOS / Apple HIG — large titles, translucency, generous spacing, SF-style type',
  fluent: 'Fluent (Microsoft) — acrylic depth, clear hierarchy, reveal highlights',
  ant: 'Ant Design — dense enterprise UI, blue accent, compact controls, rich data tables',
  chakra: 'Chakra UI — friendly, rounded, accessible, soft neutrals',
  carbon: 'Carbon (IBM) — data-dense, structured grid, restrained palette, monospaced accents',
  polaris: 'Polaris (Shopify) — commerce admin, calm greens/inks, clear cards and tables',
  bootstrap: 'Bootstrap — familiar utility components, 12-column grid, classic blue',
  geist: 'Geist (Vercel) — minimal, high-contrast black/white, mono accents, tight spacing',
  brutalism: 'Neo-brutalism — raw, thick black borders, hard offset shadows, bold flat color, no gradients',
  editorial: 'Editorial — magazine typography, strong type hierarchy, generous margins, restrained color'
}

/** Short display names for the preset selectors (proper nouns, not translated). */
export const DESIGN_SYSTEM_DISPLAY: Record<DesignSystemPreset, string> = {
  none: 'None',
  shadcn: 'shadcn/ui',
  radix: 'Radix',
  material: 'Material',
  ios: 'iOS / Apple',
  fluent: 'Fluent',
  ant: 'Ant Design',
  chakra: 'Chakra UI',
  carbon: 'Carbon (IBM)',
  polaris: 'Polaris (Shopify)',
  bootstrap: 'Bootstrap',
  geist: 'Geist (Vercel)',
  brutalism: 'Neo-brutalism',
  editorial: 'Editorial'
}




/** Token option lists for the selectors ('' = unset / let the agent decide). */
export const DESIGN_RADIUS_OPTIONS = ['', 'sharp', 'soft', 'rounded', 'pill'] as const
export const DESIGN_DENSITY_OPTIONS = ['', 'compact', 'cozy', 'spacious'] as const
export const DESIGN_FONT_OPTIONS = ['', 'system', 'geometric', 'humanist', 'serif', 'mono'] as const

const RADIUS_LABEL: Record<'sharp' | 'soft' | 'rounded' | 'pill', string> = {
  sharp: 'sharp corners (0–2px)',
  soft: 'soft corners (6–10px)',
  rounded: 'rounded corners (14–20px)',
  pill: 'pill / fully rounded'
}
const DENSITY_LABEL: Record<'compact' | 'cozy' | 'spacious', string> = {
  compact: 'compact, tight spacing',
  cozy: 'cozy, balanced spacing',
  spacious: 'spacious, airy whitespace'
}
const FONT_LABEL: Record<'system' | 'geometric' | 'humanist' | 'serif' | 'mono', string> = {
  system: 'native system UI fonts',
  geometric: 'geometric sans (Inter / Geist style)',
  humanist: 'humanist sans (warmer, readable)',
  serif: 'serif (editorial, high-contrast)',
  mono: 'monospace accents (technical)'
}

/**
 * Render the design context as prompt lines. Returns `[]` when nothing is set,
 * so callers can spread it unconditionally. Mirrors `formatSddDesignContextLines`
 * and keeps the same anti-"AI tell" guardrails.
 */
export function formatDesignContextLines(ctx: DesignContext | undefined): string[] {
  const target = normalizeDesignTarget(ctx?.designTarget)
  const parts: string[] = []
  parts.push(`- Target: ${DESIGN_TARGET_LABEL[target]}`)
  if (ctx?.designType) parts.push(`- Surface: ${DESIGN_TYPE_LABEL[ctx.designType]}`)
  if (ctx?.brandColor) {
    parts.push(
      `- Brand color anchor: ${ctx.brandColor} — compose the palette around this; do not fall back to the purple→blue AI-default gradient.`
    )
  }
  if (ctx?.tone?.length) parts.push(`- Tone: ${ctx.tone.join('、')}`)
  if (ctx?.designSystemPreset && ctx.designSystemPreset !== 'none') {
    parts.push(`- Design system: ${DESIGN_SYSTEM_LABEL[ctx.designSystemPreset]}`)
  }
  if (ctx?.designGuidelines?.trim()) parts.push(`- Additional rules: ${ctx.designGuidelines.trim()}`)
  if (ctx?.radius) parts.push(`- Corner radius: ${RADIUS_LABEL[ctx.radius]}`)
  if (ctx?.density) parts.push(`- Spacing density: ${DENSITY_LABEL[ctx.density]}`)
  if (ctx?.fontStyle) parts.push(`- Type style: ${FONT_LABEL[ctx.fontStyle]}`)
  if (parts.length === 0) return []
  return [
    'Design context (honor it in every visual decision):',
    ...parts,
    '- Avoid generic AI tells: cream/sand default backgrounds, purple→blue gradients, bounce/elastic easing, nested cards, gray text on colored backgrounds. Verify text contrast and provide a prefers-reduced-motion fallback.',
    ''
  ]
}

/**
 * Render the design context as a standalone `DESIGN_SYSTEM.md` body — the
 * shared, persistent source of truth both the design agent and the code agent
 * read from the workspace.
 */
export function formatDesignSystemMarkdown(ctx: DesignContext | undefined): string {
  const body = [
    '# Design system',
    '',
    "Single source of truth for this product's visual language. Honor it in all UI work — the design canvas and the real code alike.",
    ''
  ]
  const lines = formatDesignContextLines(ctx)
  if (lines.length === 0) {
    body.push('_No brand color, tone or design-system preset set yet._')
  } else {
    body.push(...lines)
  }
  body.push(
    '',
    '## Delivery Quality',
    '',
    ...DESIGN_DELIVERY_LINES,
    '',
    '## Resize-Adaptive HTML',
    '',
    ...DESIGN_RESIZE_RESPONSIVE_LINES,
    '',
    '## Craft',
    '',
    ...DESIGN_CRAFT_LINES
  )
  return `${body.join('\n')}\n`
}

/**
 * Map a CSS font-family (or stack) to a DesignContext font style bucket. Matches
 * the FIRST family name and checks specific faces before the generic `serif`
 * fallback (which is stripped of `sans-serif` first, so `Inter, sans-serif` reads
 * as geometric, not serif).
 */
function fontStyleFromFamily(family: string | undefined): DesignContext['fontStyle'] | undefined {
  const first = (family ?? '').toLowerCase().split(',')[0].trim()
  if (!first) return undefined
  if (/mono|consolas|menlo|courier|jetbrains|fira code|source code/.test(first)) return 'mono'
  if (/inter|geist|poppins|futura|montserrat|circular|sf pro|manrope|space grotesk/.test(first)) return 'geometric'
  if (/segoe|roboto|open sans|lato|source sans|helvetica|noto sans|pt sans/.test(first)) return 'humanist'
  if (/system-ui|-apple-system|ui-sans|ui-serif/.test(first)) return 'system'
  const serifProbe = first.replace(/sans[-\s]?serif/g, '')
  if (/serif|georgia|times|charter|garamond|playfair|merriweather|lora/.test(serifProbe)) return 'serif'
  return undefined
}

/**
 * Enrich an unset DesignContext with values inferred from the design's actually
 * extracted tokens: an empty brand color falls back to the realized accent, an
 * empty font style to the realized font family. NEVER overrides an explicit user
 * choice — only fills blanks — so first-turn / unconfigured sessions still match
 * the look already on screen instead of running on defaults.
 */
export function mergeDesignContextWithTokens(
  ctx: DesignContext | undefined,
  tokens: { palette: { primary?: { base: string } }; typeRows: { fontFamily: string }[] } | undefined
): DesignContext | undefined {
  if (!tokens) return ctx
  const merged: DesignContext = { ...(ctx ?? {}) }
  if (!merged.brandColor && tokens.palette.primary?.base) {
    merged.brandColor = tokens.palette.primary.base
  }
  if (!merged.fontStyle) {
    const inferred = fontStyleFromFamily(tokens.typeRows.find((row) => row.fontFamily)?.fontFamily)
    if (inferred) merged.fontStyle = inferred
  }
  return Object.keys(merged).length > 0 ? merged : ctx
}

/**
 * Stable content hash of a published DESIGN_SYSTEM.md body. Lets design mode
 * detect when the shared design system has drifted from what an artifact was
 * implemented against (the code side of bidirectional design↔code drift).
 */
export function hashDesignSystem(content: string): string {
  let hash = 5381
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}
