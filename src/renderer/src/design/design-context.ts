import type { DesignSystemPreset } from '@shared/app-settings'

/** Whether the surface is brand-led or product-led. */
export type DesignSurfaceType = 'brand' | 'product'

/**
 * Design intent injected into every design-agent turn. Generalizes the SDD
 * `SddDesignContext` (designType / brandColor / tone) by ADDING a named
 * design-system preset.
 */
export type DesignContext = {
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

/**
 * Built-in design craft discipline — condensed from the open-design craft guides
 * (anti-AI-slop, color, type, layout, motion, a11y, states). Injected into every
 * design turn and DESIGN_SYSTEM.md so output has a quality floor regardless of the
 * preset or brief.
 */
export const DESIGN_CRAFT_LINES: string[] = [
  'Design craft (apply unless the brief explicitly overrides):',
  '- Anti-AI-slop: no cream/sand default backgrounds, no purple→blue gradients, no glassmorphism-on-a-gradient, no center-everything layouts, no emoji as icons.',
  '- Color: one accent + a real neutral ramp; ≥4.5:1 text contrast; avoid pure #000 and gray text on colored fills.',
  '- Typography: a clear hierarchy (2–3 sizes), body line-height ~1.6, tighter headings; one or two families max.',
  '- Layout: a real grid, intentional whitespace, aligned to a baseline; avoid nested cards and uniform 16px-everywhere.',
  '- Motion: subtle and fast (≤200ms), ease-out; honor prefers-reduced-motion.',
  '- Accessibility: visible focus states, labels, hit targets ≥40px, semantic structure.',
  '- States: design empty / loading / error / hover / disabled, not just the happy path.'
]

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
  if (!ctx) return []
  const parts: string[] = []
  if (ctx.designType) parts.push(`- Surface: ${DESIGN_TYPE_LABEL[ctx.designType]}`)
  if (ctx.brandColor) {
    parts.push(
      `- Brand color anchor: ${ctx.brandColor} — compose the palette around this; do not fall back to the purple→blue AI-default gradient.`
    )
  }
  if (ctx.tone?.length) parts.push(`- Tone: ${ctx.tone.join('、')}`)
  if (ctx.designSystemPreset && ctx.designSystemPreset !== 'none') {
    parts.push(`- Design system: ${DESIGN_SYSTEM_LABEL[ctx.designSystemPreset]}`)
  }
  if (ctx.designGuidelines?.trim()) parts.push(`- Additional rules: ${ctx.designGuidelines.trim()}`)
  if (ctx.radius) parts.push(`- Corner radius: ${RADIUS_LABEL[ctx.radius]}`)
  if (ctx.density) parts.push(`- Spacing density: ${DENSITY_LABEL[ctx.density]}`)
  if (ctx.fontStyle) parts.push(`- Type style: ${FONT_LABEL[ctx.fontStyle]}`)
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
  body.push('', '## Craft', '', ...DESIGN_CRAFT_LINES)
  return `${body.join('\n')}\n`
}
