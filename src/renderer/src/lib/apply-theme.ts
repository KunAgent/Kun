import {
  documentLanguageForAppLocale,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  normalizeDarkUiColors,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  writeFontStackFor,
  type ChatContentMaxWidthPx,
  type DarkUiColorsPatchV1,
  type UiFontScale,
  type WriteTypographySettingsV1
} from '@shared/app-settings'
import type { AppLocale } from '@shared/app-locales'

export type ThemePreference = 'system' | 'light' | 'dark'
export type { ChatContentMaxWidthPx, UiFontScale }

let removeSystemListener: (() => void) | null = null

function resolvedMode(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Applies `data-theme` on `<html>` for Tailwind `dark:` variants and CSS variables.
 */
export function applyTheme(pref: ThemePreference): void {
  removeSystemListener?.()
  removeSystemListener = null

  const root = document.documentElement
  const apply = (): void => {
    const mode = resolvedMode(pref)
    root.setAttribute('data-theme', mode)
  }

  if (pref === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      apply()
    }
    mq.addEventListener('change', onChange)
    removeSystemListener = (): void => {
      mq.removeEventListener('change', onChange)
    }
  }

  apply()
}

/**
 * Gives the renderer a theme before the workbench store boots. The system
 * preference is an immediate fallback; saved settings replace it as soon as
 * the existing settings IPC responds without delaying the first React render.
 */
export function initializeStartupTheme(
  readSettings?: () => Promise<{ theme: ThemePreference }>
): void {
  applyTheme('system')
  if (!readSettings) return
  void readSettings().then(
    (settings) => applyTheme(settings.theme),
    () => undefined
  )
}

export function applyDarkUiColors(colors?: DarkUiColorsPatchV1 | null): void {
  const normalized = normalizeDarkUiColors(colors)
  const root = document.documentElement.style
  root.setProperty('--kun-dark-ui-background', normalized.background)
  root.setProperty('--kun-dark-ui-border', normalized.border)
  root.setProperty('--kun-dark-ui-panel', normalized.panel)
}

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement
  root.style.setProperty('--ds-ui-scale', String(normalizeUiFontScale(scale)))
}

export function applyChatContentMaxWidth(widthPx: ChatContentMaxWidthPx): void {
  const root = document.documentElement
  root.style.setProperty('--ds-chat-content-max-width', `${normalizeChatContentMaxWidth(widthPx)}px`)
}

export function applyCursorSpotlight(enabled: boolean): void {
  document.documentElement.dataset.cursorSpotlight = enabled ? 'on' : 'off'
}

type Rgb = { r: number; g: number; b: number }

const CURSOR_SPOTLIGHT_RGB_PROPS = [
  '--ds-cursor-spotlight-rgb',
  '--ds-cursor-spotlight-edge-rgb',
  '--ds-cursor-spotlight-dark-rgb',
  '--ds-cursor-spotlight-dark-edge-rgb'
] as const

export function applyCursorSpotlightColor(color: string | null | undefined): void {
  const rootStyle = document.documentElement.style
  const normalized = normalizeHexColor(color)
  if (normalized === DEFAULT_CURSOR_SPOTLIGHT_COLOR) {
    for (const prop of CURSOR_SPOTLIGHT_RGB_PROPS) rootStyle.removeProperty(prop)
    return
  }

  const rgb = parseHexColor(normalized)
  rootStyle.setProperty('--ds-cursor-spotlight-rgb', rgbString(rgb))
  rootStyle.setProperty('--ds-cursor-spotlight-edge-rgb', rgbString(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.16)))
  rootStyle.setProperty('--ds-cursor-spotlight-dark-rgb', rgbString(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.12)))
  rootStyle.setProperty('--ds-cursor-spotlight-dark-edge-rgb', rgbString(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.24)))
}

function normalizeHexColor(value: string | null | undefined): string {
  const color = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_CURSOR_SPOTLIGHT_COLOR
}

function parseHexColor(color: string): Rgb {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  }
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount)
  }
}

function rgbString(rgb: Rgb): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

/**
 * Pushes the Write editor typography onto CSS variables consumed by the rich
 * editor, the CodeMirror live appearance, and the markdown preview. Setting the
 * variables on `<html>` keeps chat surfaces untouched (only `.write-*` and the
 * editor theme read them) and live-updates open editors without a rebuild.
 */
export function applyWriteTypography(typography: WriteTypographySettingsV1): void {
  const root = document.documentElement.style
  root.setProperty('--write-editor-font-family', writeFontStackFor(typography.fontPreset, typography.customFontFamily))
  root.setProperty('--write-editor-font-size', `${typography.fontSizePx}px`)
  root.setProperty('--write-editor-line-height', String(typography.lineHeight))
}

/**
 * Mirrors the active i18n locale onto `<html lang>` so screen readers,
 * browser spellcheck, and CSS `:lang()` selectors match the visible UI.
 */
export function applyDocumentLocale(locale: AppLocale): void {
  const lang = documentLanguageForAppLocale(locale)
  if (document.documentElement.getAttribute('lang') !== lang) {
    document.documentElement.setAttribute('lang', lang)
  }
}
