import {
  DEFAULT_DARK_UI_COLORS,
  normalizeColorPaletteSettings,
  normalizeDarkUiColors,
  type ColorPaletteId,
  type ColorPaletteSettingsPatchV1,
  type ColorPaletteSettingsV1,
  type DarkUiColorsPatchV1
} from '@shared/app-settings'
import { scopedSelector } from '@shared/ui-plugin-css'
import { readBrowserStorageItem, removeBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

/** Source colors of one palette in one mode. Every other token is derived from these. */
export type PaletteSwatch = {
  bg: string
  side: string
  card: string
  sub: string
  border: string
  text: string
  muted: string
  accent: string
  soft: string
  bubble: string
  bubbleFg: string
}

export type PresetColorPaletteId = Exclude<ColorPaletteId, 'custom'>

export type ColorPalettePreset = {
  id: PresetColorPaletteId
  light: PaletteSwatch
  dark: PaletteSwatch
}

function swatch(values: readonly string[]): PaletteSwatch {
  const [bg, side, card, sub, border, text, muted, accent, soft, bubble, bubbleFg] = values
  return { bg, side, card, sub, border, text, muted, accent, soft, bubble, bubbleFg }
}

function preset(id: PresetColorPaletteId, light: readonly string[], dark: readonly string[]): ColorPalettePreset {
  return { id, light: swatch(light), dark: swatch(dark) }
}

// Column order: bg, sidebar, card, subtle, border, text, muted, accent, accent-soft, user bubble, bubble text.
export const COLOR_PALETTE_PRESETS: readonly ColorPalettePreset[] = [
  preset('kun',
    ['#fcfcfd', '#f5f6f8', '#ffffff', '#f4f6f9', '#e7e9ee', '#20242d', '#687083', '#5b78ff', '#eef2ff', '#f5f7fb', '#20242d'],
    ['#181818', '#181818', '#2c2c2c', '#2e2e2e', '#272727', '#d4d4d4', '#bfc1c4', '#78a3ea', '#353b46', '#2c2c2c', '#d4d4d4']),
  preset('sky',
    ['#f6f9ff', '#eaf1fd', '#ffffff', '#eef4fe', '#d5e3f7', '#0f2a4a', '#56708f', '#1f6feb', '#e2edff', '#dceaff', '#0f3a78'],
    ['#0c1524', '#08101c', '#13213a', '#1a2b47', '#223554', '#e4eeff', '#8fa6c7', '#5aa2ff', '#1a3152', '#1b3358', '#d6e7ff']),
  preset('parchment',
    ['#faf9f6', '#f5f4ef', '#fffdf8', '#eeede5', '#e2ddd2', '#1d011d', '#6e6060', '#0f7887', '#dcefef', '#efe3ec', '#6e3a66'],
    ['#1a1714', '#15120f', '#24201b', '#2e2822', '#3a3229', '#efe7da', '#ab9f8e', '#4fb3c0', '#1f3436', '#3a2836', '#f0d6ea']),
  preset('mint',
    ['#f6fbf9', '#e9f4ef', '#ffffff', '#edf6f2', '#d3e7de', '#12302a', '#557067', '#0e8a6a', '#dcf2ea', '#dff1e9', '#0b5a45'],
    ['#0e1916', '#0a1411', '#152520', '#1c2f29', '#24392f', '#e1f2eb', '#8aaa9e', '#3fcf9f', '#173a2f', '#1d3a30', '#cff3e4']),
  preset('sakura',
    ['#fff8f9', '#fceef1', '#ffffff', '#fdf2f4', '#f1d7dd', '#3a1d25', '#85606a', '#d23f74', '#fde4ec', '#fbe3ea', '#8c2350'],
    ['#1b1215', '#160e11', '#261a1f', '#31232a', '#3d2a32', '#f6e5ea', '#b9949f', '#ff7aa6', '#45222f', '#43232f', '#ffd9e5']),
  preset('dusk',
    ['#faf8ff', '#f1edfc', '#ffffff', '#f3f0fd', '#e1daf5', '#241d3d', '#6c6390', '#6e56cf', '#ece7fd', '#ebe5fc', '#4b3699'],
    ['#14121d', '#100e18', '#1e1b2c', '#282438', '#322c47', '#ece8ff', '#a49cc4', '#a58cff', '#2d2650', '#2e2650', '#e4dcff']),
  preset('ember',
    ['#fdf8f1', '#f6eee1', '#fffcf7', '#f7efe3', '#ebdcc5', '#2d2116', '#7a6650', '#c4620a', '#fcebd6', '#f8e8d4', '#8a4608'],
    ['#17120d', '#120e0a', '#221a13', '#2c2219', '#3b2e21', '#f7ecdc', '#b8a48a', '#f59a3c', '#3d2914', '#3c2a18', '#ffe3c2']),
  preset('graphite',
    ['#fafafa', '#f2f2f2', '#ffffff', '#f2f2f2', '#e3e3e3', '#161616', '#6b6b6b', '#161616', '#ececec', '#efefef', '#161616'],
    ['#101010', '#0b0b0b', '#1a1a1a', '#232323', '#2c2c2c', '#ededed', '#9a9a9a', '#ededed', '#2a2a2a', '#262626', '#ededed'])
]

export function findColorPalettePreset(id: ColorPaletteId): ColorPalettePreset | null {
  return COLOR_PALETTE_PRESETS.find((entry) => entry.id === id) ?? null
}

/** Hex-only swatches for the custom palette, used by previews in Settings. */
export function customPaletteSwatches(
  palette: ColorPaletteSettingsV1,
  darkUiColors?: DarkUiColorsPatchV1 | null
): { light: PaletteSwatch; dark: PaletteSwatch } {
  const light = palette.customLight
  const dark = normalizeDarkUiColors(darkUiColors)
  return {
    light: {
      bg: light.background, side: light.panel, card: '#ffffff', sub: light.panel, border: light.border,
      text: '#20242d', muted: '#687083', accent: light.accent, soft: light.panel, bubble: light.panel, bubbleFg: '#20242d'
    },
    dark: {
      bg: dark.background, side: dark.background, card: dark.panel, sub: dark.panel, border: dark.border,
      text: '#d4d4d4', muted: '#bfc1c4', accent: palette.customDarkAccent, soft: dark.panel, bubble: dark.panel, bubbleFg: '#d4d4d4'
    }
  }
}

type Rgb = { r: number; g: number; b: number }

function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function luminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** White or near-black, whichever reads better on the accent. */
export function accentForeground(accent: string): string {
  const rgb = parseHex(accent)
  if (!rgb) return '#ffffff'
  const l = luminance(rgb)
  const onWhite = 1.05 / (l + 0.05)
  const onDark = (l + 0.05) / 0.0573
  return onDark > onWhite ? '#111111' : '#ffffff'
}

function mixRgb(from: Rgb, to: Rgb, amount: number): string {
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * amount)
  return `${mix(from.r, to.r)} ${mix(from.g, to.g)} ${mix(from.b, to.b)}`
}

function spotlightTokens(accent: string): string[] {
  const rgb = parseHex(accent)
  if (!rgb) return []
  const white = { r: 255, g: 255, b: 255 }
  return [
    `--ds-cursor-spotlight-rgb: ${mixRgb(rgb, white, 0.42)}`,
    `--ds-cursor-spotlight-edge-rgb: ${mixRgb(rgb, white, 0.2)}`,
    `--ds-cursor-spotlight-dark-rgb: ${mixRgb(rgb, white, 0.12)}`,
    `--ds-cursor-spotlight-dark-edge-rgb: ${mixRgb(rgb, white, 0.36)}`
  ]
}

function accentTokens(accent: string, soft: string, selectionPercent: number): string[] {
  return [
    `--ds-accent: ${accent}`,
    `--ds-accent-soft: ${soft}`,
    `--ds-focus-ring: ${accent}`,
    `--ds-control: ${accent}`,
    `--ds-control-foreground: ${accentForeground(accent)}`,
    `--ds-selection: color-mix(in srgb, ${accent} ${selectionPercent}%, transparent)`,
    ...spotlightTokens(accent)
  ]
}

function lightTokens(c: PaletteSwatch): string[] {
  return [
    `--bg-app: ${c.bg}`,
    `--bg-canvas: ${c.bg}`,
    `--bg-sidebar: ${c.side}`,
    `--surface-1: ${c.card}`,
    `--surface-2: ${c.card}`,
    `--surface-3: ${c.card}`,
    `--border-soft: ${c.border}`,
    `--border-strong: color-mix(in srgb, ${c.border} 82%, ${c.text})`,
    `--text-primary: ${c.text}`,
    `--text-secondary: ${c.muted}`,
    `--text-tertiary: color-mix(in srgb, ${c.muted} 72%, ${c.bg})`,
    `--text-placeholder: color-mix(in srgb, ${c.muted} 66%, ${c.bg})`,
    `--ds-surface-subtle: ${c.sub}`,
    `--ds-surface-hover: color-mix(in srgb, ${c.sub} 90%, ${c.accent})`,
    `--ds-border-muted: color-mix(in srgb, ${c.border} 60%, ${c.bg})`,
    `--ds-bubble-user: ${c.bubble}`,
    `--ds-bubble-user-fg: ${c.bubbleFg}`,
    ...accentTokens(c.accent, c.soft, 22),
    `--ds-sidebar-row-hover: color-mix(in srgb, ${c.side} 93%, ${c.text})`,
    `--ds-sidebar-row-active: ${c.soft}`,
    `--ds-sidebar-row-ring: color-mix(in srgb, ${c.accent} 22%, ${c.border})`,
    `--ds-sidebar-field-bg: color-mix(in srgb, ${c.side} 94%, ${c.text})`,
    `--ds-sidebar-field-focus: ${c.card}`,
    `--ds-sidebar-divider: ${c.border}`,
    `--ds-card-soft: ${c.card}`,
    `--ds-card-strong: ${c.card}`,
    `--ds-card-muted: ${c.sub}`,
    `--ds-card-ghost: ${c.bg}`,
    `--ds-card-hover: ${c.card}`,
    `--ds-chip-bg: ${c.card}`,
    `--ds-chip-muted-bg: ${c.sub}`,
    `--ds-chip-hover: ${c.card}`,
    `--ds-chip-border: ${c.border}`,
    `--ds-chip-active: color-mix(in srgb, ${c.sub} 86%, ${c.accent})`,
    `--ds-kbd-bg: ${c.sub}`,
    `--ds-table-head-bg: ${c.sub}`,
    `--ds-scrollbar-thumb: color-mix(in srgb, ${c.text} 22%, transparent)`,
    `--ds-scrollbar-thumb-hover: color-mix(in srgb, ${c.text} 34%, transparent)`
  ]
}

function darkTokens(c: PaletteSwatch): string[] {
  return [
    `--kun-dark-ui-effective-background: ${c.bg}`,
    `--kun-dark-ui-effective-border: ${c.border}`,
    `--kun-dark-ui-effective-panel: ${c.card}`,
    `--bg-sidebar: ${c.side}`,
    `--text-primary: ${c.text}`,
    `--text-secondary: ${c.muted}`,
    `--text-tertiary: color-mix(in srgb, ${c.muted} 76%, ${c.bg})`,
    `--text-placeholder: color-mix(in srgb, ${c.muted} 70%, ${c.bg})`,
    `--ds-bubble-user: ${c.bubble}`,
    `--ds-bubble-user-fg: ${c.bubbleFg}`,
    ...accentTokens(c.accent, c.soft, 30),
    `--ds-scrollbar-thumb: color-mix(in srgb, ${c.text} 22%, transparent)`,
    `--ds-scrollbar-thumb-hover: color-mix(in srgb, ${c.text} 34%, transparent)`
  ]
}

/**
 * With "pack first" on, an active iKun or UI plugin appearance pack keeps its
 * own colors, so every palette rule steps aside while one of them is lit.
 */
const PACK_FIRST_GATE =
  ":not([data-palette-pack-first='on'][data-ikun-mode='on'])" +
  ":not([data-palette-pack-first='on'][data-ui-plugin])"

function rule(selector: string, declarations: string[]): string {
  if (declarations.length === 0) return ''
  return `${scopedSelector(selector)} {\n${declarations.map((line) => `  ${line};`).join('\n')}\n}`
}

export function buildColorPaletteCss(palette: ColorPaletteSettingsV1): string {
  const base = `html[data-color-palette='${palette.id}']${PACK_FIRST_GATE}`
  const light = `${base}:not([data-theme='dark'])`
  const dark = `${base}[data-theme='dark']`
  if (palette.id === 'kun') {
    // Kun ignores the custom dark colors; those belong to the custom palette now.
    return rule(dark, [
      `--kun-dark-ui-effective-background: ${DEFAULT_DARK_UI_COLORS.background}`,
      `--kun-dark-ui-effective-border: ${DEFAULT_DARK_UI_COLORS.border}`,
      `--kun-dark-ui-effective-panel: ${DEFAULT_DARK_UI_COLORS.panel}`
    ])
  }
  if (palette.id === 'custom') {
    const custom = palette.customLight
    const card = `color-mix(in srgb, ${custom.background} 30%, #ffffff)`
    const lightSwatch: PaletteSwatch = {
      bg: custom.background,
      side: custom.panel,
      card,
      sub: `color-mix(in srgb, ${custom.panel} 70%, ${card})`,
      border: custom.border,
      text: '#20242d',
      muted: '#687083',
      accent: custom.accent,
      soft: `color-mix(in srgb, ${custom.accent} 13%, ${card})`,
      bubble: `color-mix(in srgb, ${custom.accent} 8%, ${custom.panel})`,
      bubbleFg: '#20242d'
    }
    const darkAccent = palette.customDarkAccent
    return [
      rule(light, lightTokens(lightSwatch)),
      rule(dark, accentTokens(
        darkAccent,
        `color-mix(in srgb, ${darkAccent} 20%, var(--kun-dark-ui-effective-panel))`,
        30
      ))
    ].filter(Boolean).join('\n\n')
  }
  const entry = findColorPalettePreset(palette.id)
  if (!entry) return ''
  // Parchment light keeps its handcrafted material layer in tokens-window-workspace.css.
  const lightRule = palette.id === 'parchment' ? '' : rule(light, lightTokens(entry.light))
  return [lightRule, rule(dark, darkTokens(entry.dark))].filter(Boolean).join('\n\n')
}

const STYLE_ELEMENT_ID = 'kun-color-palette'
/** Last applied palette, so startup paints it before the settings IPC answers. */
const PALETTE_CACHE_KEY = 'kun.colorPalette.v1'
/** Set when the old Kun 形象 Retroma mode is migrated; consumed once settings load. */
export const LEGACY_RETROMA_PALETTE_KEY = 'kun.legacyRetromaPalette'

export function applyColorPalette(
  value?: ColorPaletteSettingsPatchV1 | null,
  darkUiColors?: DarkUiColorsPatchV1 | null
): void {
  if (typeof document === 'undefined') return
  const palette = normalizeColorPaletteSettings(value, darkUiColors)
  const root = document.documentElement
  root.setAttribute('data-color-palette', palette.id)
  root.setAttribute('data-palette-pack-first', palette.uiPackFirst ? 'on' : 'off')
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ELEMENT_ID
    document.head.appendChild(style)
  }
  const css = buildColorPaletteCss(palette)
  if (style.textContent !== css) style.textContent = css
  writeBrowserStorageItem(PALETTE_CACHE_KEY, JSON.stringify(palette))
}

export function applyCachedColorPalette(): void {
  const raw = readBrowserStorageItem(PALETTE_CACHE_KEY)
  if (!raw) return
  try {
    applyColorPalette(JSON.parse(raw) as ColorPaletteSettingsPatchV1)
  } catch {
    removeBrowserStorageItem(PALETTE_CACHE_KEY)
  }
}

/**
 * Retroma used to be a Kun 形象 mode. Users who had it on land on the
 * parchment palette once, unless they already picked another palette.
 */
export function migrateLegacyRetromaPalette(
  palette: ColorPaletteSettingsV1 | undefined,
  save: (patch: { colorPalette: ColorPaletteSettingsPatchV1 }) => Promise<unknown>
): ColorPaletteSettingsV1 | undefined {
  if (readBrowserStorageItem(LEGACY_RETROMA_PALETTE_KEY) !== '1') return palette
  removeBrowserStorageItem(LEGACY_RETROMA_PALETTE_KEY)
  if (palette && palette.id !== 'kun') return palette
  void save({ colorPalette: { id: 'parchment' } }).catch(() => undefined)
  return { ...normalizeColorPaletteSettings(palette), id: 'parchment' }
}
