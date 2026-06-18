import { writeFontStackFor, type WriteTypographySettingsV1 } from '@shared/app-settings'

export type ThemePreference = 'system' | 'light' | 'dark'
export type UiFontScale = 'small' | 'medium' | 'large'

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

export function applyUiFontScale(scale: UiFontScale): void {
  const root = document.documentElement
  const factor =
    scale === 'small'
      ? '0.82'
      : scale === 'large'
        ? '1'
        : '0.88'
  root.style.setProperty('--ds-ui-scale', factor)
}

export function applyCursorSpotlight(enabled: boolean): void {
  document.documentElement.dataset.cursorSpotlight = enabled ? 'on' : 'off'
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
export function applyDocumentLocale(locale: 'en' | 'zh'): void {
  const lang = locale === 'zh' ? 'zh-CN' : 'en'
  if (document.documentElement.getAttribute('lang') !== lang) {
    document.documentElement.setAttribute('lang', lang)
  }
}
