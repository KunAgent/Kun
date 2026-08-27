import type { DarkUiColorsPatchV1, DarkUiColorsV1 } from './app-settings-types'

export const DEFAULT_DARK_UI_COLORS: Readonly<DarkUiColorsV1> = Object.freeze({
  background: '#181818',
  border: '#272727',
  panel: '#2c2c2c'
})

const SIX_DIGIT_HEX_COLOR = /^#[0-9a-f]{6}$/i

export function normalizeDarkUiHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return SIX_DIGIT_HEX_COLOR.test(normalized) ? normalized : fallback
}

export function normalizeDarkUiColors(
  value?: DarkUiColorsPatchV1 | null
): DarkUiColorsV1 {
  return {
    background: normalizeDarkUiHexColor(value?.background, DEFAULT_DARK_UI_COLORS.background),
    border: normalizeDarkUiHexColor(value?.border, DEFAULT_DARK_UI_COLORS.border),
    panel: normalizeDarkUiHexColor(value?.panel, DEFAULT_DARK_UI_COLORS.panel)
  }
}

export function mergeDarkUiColors(
  current?: DarkUiColorsPatchV1 | null,
  patch?: DarkUiColorsPatchV1
): DarkUiColorsV1 {
  if (!patch) return normalizeDarkUiColors(current)
  return normalizeDarkUiColors({ ...current, ...patch })
}
