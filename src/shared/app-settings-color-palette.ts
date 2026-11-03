import { DEFAULT_DARK_UI_COLORS, normalizeDarkUiHexColor } from './app-settings-dark-ui'
import type { DarkUiColorsPatchV1 } from './app-settings-types'

/** Whole-UI color schemes offered on Settings -> Appearance. `custom` reads user colors. */
export const COLOR_PALETTE_IDS = [
  'kun',
  'sky',
  'parchment',
  'mint',
  'sakura',
  'dusk',
  'ember',
  'graphite',
  'custom'
] as const

export type ColorPaletteId = (typeof COLOR_PALETTE_IDS)[number]

export type CustomLightPaletteV1 = {
  background: string
  panel: string
  border: string
  accent: string
}

/**
 * The custom palette's dark half keeps using `darkUiColors` for background,
 * border and panel; only the accent lives here.
 */
export type ColorPaletteSettingsV1 = {
  id: ColorPaletteId
  /** When a mascot appearance pack (iKun or a UI plugin) is active, let its own colors win. */
  uiPackFirst: boolean
  customLight: CustomLightPaletteV1
  customDarkAccent: string
}

export type ColorPaletteSettingsPatchV1 = {
  id?: ColorPaletteId
  uiPackFirst?: boolean
  customLight?: Partial<CustomLightPaletteV1>
  customDarkAccent?: string
}

export const DEFAULT_CUSTOM_LIGHT_PALETTE: Readonly<CustomLightPaletteV1> = Object.freeze({
  background: '#fcfcfd',
  panel: '#f5f6f8',
  border: '#e7e9ee',
  accent: '#5b78ff'
})

export const DEFAULT_CUSTOM_DARK_ACCENT = '#78a3ea'

export function isColorPaletteId(value: unknown): value is ColorPaletteId {
  return typeof value === 'string' && (COLOR_PALETTE_IDS as readonly string[]).includes(value)
}

function hasCustomDarkUiColors(darkUiColors?: DarkUiColorsPatchV1 | null): boolean {
  if (!darkUiColors) return false
  return (['background', 'border', 'panel'] as const).some((key) => {
    const value = darkUiColors[key]
    return value !== undefined && normalizeDarkUiHexColor(value, DEFAULT_DARK_UI_COLORS[key]) !== DEFAULT_DARK_UI_COLORS[key]
  })
}

/**
 * Legacy snapshots have no palette. Users who already tuned the dark UI colors
 * start on `custom` so their dark theme keeps looking the same.
 */
export function normalizeColorPaletteSettings(
  value?: ColorPaletteSettingsPatchV1 | null,
  darkUiColors?: DarkUiColorsPatchV1 | null
): ColorPaletteSettingsV1 {
  const fallbackId: ColorPaletteId = hasCustomDarkUiColors(darkUiColors) ? 'custom' : 'kun'
  const light = value?.customLight
  return {
    id: isColorPaletteId(value?.id) ? value.id : fallbackId,
    uiPackFirst: value?.uiPackFirst !== false,
    customLight: {
      background: normalizeDarkUiHexColor(light?.background, DEFAULT_CUSTOM_LIGHT_PALETTE.background),
      panel: normalizeDarkUiHexColor(light?.panel, DEFAULT_CUSTOM_LIGHT_PALETTE.panel),
      border: normalizeDarkUiHexColor(light?.border, DEFAULT_CUSTOM_LIGHT_PALETTE.border),
      accent: normalizeDarkUiHexColor(light?.accent, DEFAULT_CUSTOM_LIGHT_PALETTE.accent)
    },
    customDarkAccent: normalizeDarkUiHexColor(value?.customDarkAccent, DEFAULT_CUSTOM_DARK_ACCENT)
  }
}

export function mergeColorPaletteSettings(
  current: ColorPaletteSettingsPatchV1 | null | undefined,
  patch: ColorPaletteSettingsPatchV1 | undefined,
  darkUiColors?: DarkUiColorsPatchV1 | null
): ColorPaletteSettingsV1 {
  if (!patch) return normalizeColorPaletteSettings(current, darkUiColors)
  return normalizeColorPaletteSettings({
    ...current,
    ...patch,
    customLight: { ...current?.customLight, ...patch.customLight }
  }, darkUiColors)
}
