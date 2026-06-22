import type {
  TerminalColorMode,
  TerminalColorSettingsV1,
  TerminalSettingsPatchV1,
  TerminalSettingsV1
} from './app-settings-types'

export type { TerminalColorMode, TerminalColorSettingsV1, TerminalSettingsPatchV1, TerminalSettingsV1 }

// Accepts #rgb, #rrggbb, and #rrggbbaa (8-digit form carries an alpha byte,
// used by e.g. the default selection background #264f78aa).
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const TERMINAL_ANSI_COLOR_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

const TERMINAL_SURFACE_COLOR_KEYS = [
  'foreground',
  'background',
  'cursor',
  'selectionBackground'
] as const

export const TERMINAL_COLOR_MODES: readonly TerminalColorMode[] = ['none', 'custom']

/**
 * Built-in dark preset for the terminal surface (background, foreground,
 * cursor, selection). Used as the base in 'none' mode and as the default
 * starting point for 'custom' mode.
 */
export const TERMINAL_PRESET_DARK = {
  background: '#151d31',
  foreground: '#e6e9ef',
  cursor: '#e6e9ef',
  selectionBackground: '#264f78aa'
} as const

export const TERMINAL_PRESET_LIGHT = {
  background: '#f3f5fc',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#264f78aa'
} as const

/**
 * Default ANSI 16-color palette for 'custom' mode. Mirrors the previous
 * hardcoded dark theme so switching from 'none' to 'custom' gives a
 * familiar starting point.
 */
export const TERMINAL_DEFAULT_ANSI_COLORS = {
  black: '#000000',
  red: '#ff6b6b',
  green: '#7ee787',
  yellow: '#f0c674',
  blue: '#6cb6ff',
  magenta: '#d2a8ff',
  cyan: '#56d4dd',
  white: '#e6e9ef',
  brightBlack: '#6b7280',
  brightRed: '#ffa198',
  brightGreen: '#9ee787',
  brightYellow: '#f9d57e',
  brightBlue: '#8cb6ff',
  brightMagenta: '#e0b3ff',
  brightCyan: '#7ce4ec',
  brightWhite: '#ffffff'
} as const

export function defaultTerminalColors(): TerminalColorSettingsV1 {
  return {
    colorMode: 'none',
    ...TERMINAL_PRESET_DARK,
    ...TERMINAL_DEFAULT_ANSI_COLORS
  }
}

export function defaultTerminalSettings(): TerminalSettingsV1 {
  return {
    colors: defaultTerminalColors()
  }
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback
}

export function normalizeTerminalColors(
  input: Partial<TerminalColorSettingsV1> | undefined
): TerminalColorSettingsV1 {
  const defaults = defaultTerminalColors()
  const colorMode: TerminalColorMode =
    typeof input?.colorMode === 'string' && (TERMINAL_COLOR_MODES as readonly string[]).includes(input.colorMode)
      ? (input.colorMode as TerminalColorMode)
      : defaults.colorMode

  return {
    colorMode,
    foreground: normalizeColor(input?.foreground, defaults.foreground),
    background: normalizeColor(input?.background, defaults.background),
    cursor: normalizeColor(input?.cursor, defaults.cursor),
    selectionBackground: normalizeColor(input?.selectionBackground, defaults.selectionBackground),
    black: normalizeColor(input?.black, defaults.black),
    red: normalizeColor(input?.red, defaults.red),
    green: normalizeColor(input?.green, defaults.green),
    yellow: normalizeColor(input?.yellow, defaults.yellow),
    blue: normalizeColor(input?.blue, defaults.blue),
    magenta: normalizeColor(input?.magenta, defaults.magenta),
    cyan: normalizeColor(input?.cyan, defaults.cyan),
    white: normalizeColor(input?.white, defaults.white),
    brightBlack: normalizeColor(input?.brightBlack, defaults.brightBlack),
    brightRed: normalizeColor(input?.brightRed, defaults.brightRed),
    brightGreen: normalizeColor(input?.brightGreen, defaults.brightGreen),
    brightYellow: normalizeColor(input?.brightYellow, defaults.brightYellow),
    brightBlue: normalizeColor(input?.brightBlue, defaults.brightBlue),
    brightMagenta: normalizeColor(input?.brightMagenta, defaults.brightMagenta),
    brightCyan: normalizeColor(input?.brightCyan, defaults.brightCyan),
    brightWhite: normalizeColor(input?.brightWhite, defaults.brightWhite)
  }
}

export function normalizeTerminalSettings(
  input: TerminalSettingsPatchV1 | undefined
): TerminalSettingsV1 {
  return {
    colors: normalizeTerminalColors(input?.colors)
  }
}

export function mergeTerminalSettings(
  current: TerminalSettingsV1,
  patch: TerminalSettingsPatchV1 | undefined
): TerminalSettingsV1 {
  if (!patch?.colors) return normalizeTerminalSettings(current)
  const merged: Partial<TerminalColorSettingsV1> = { ...current.colors, ...patch.colors }
  return normalizeTerminalSettings({ colors: merged })
}

/**
 * Resolves the terminal color mode from settings, falling back to 'none'
 * (monochrome) when settings are unavailable.
 */
export function resolveTerminalColorMode(settings: { terminal?: TerminalSettingsV1 } | undefined): TerminalColorMode {
  return settings?.terminal?.colors.colorMode ?? 'none'
}

type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
  /**
   * xterm.js extended palette (ANSI colors 16-255). Only populated in
   * monochrome mode, where every entry is the foreground color so 256-color
   * (ESC[38;5;Nm) sequences are neutralized just like the base 16. Omitted in
   * custom mode so xterm.js keeps its default 256-color palette.
   */
  extendedAnsi?: string[]
}

/**
 * Builds an xterm.js theme object from terminal color settings.
 *
 * - 'none' mode: uses the built-in dark/light preset for surface colors
 *   (background, foreground, cursor, selection) and maps ALL 16 ANSI colors
 *   to the foreground so commands and output are monochrome (no red).
 *   The background is composited against the DOM surface color so the
 *   terminal blends with the app.
 * - 'custom' mode: uses the user-defined colors directly for everything.
 *
 * @param colors   Terminal color settings from app settings
 * @param mode     'dark' or 'light' (from data-theme)
 * @param surfaceColor  Opaque RGB of the DOM surface behind the terminal
 *                      (only used in 'none' mode for background compositing)
 */
export function resolveTerminalTheme(
  colors: TerminalColorSettingsV1,
  mode: 'dark' | 'light',
  surfaceColor: string
): TerminalTheme {
  if (colors.colorMode === 'custom') {
    return {
      background: colors.background,
      foreground: colors.foreground,
      cursor: colors.cursor,
      cursorAccent: colors.background,
      selectionBackground: colors.selectionBackground,
      black: colors.black,
      red: colors.red,
      green: colors.green,
      yellow: colors.yellow,
      blue: colors.blue,
      magenta: colors.magenta,
      cyan: colors.cyan,
      white: colors.white,
      brightBlack: colors.brightBlack,
      brightRed: colors.brightRed,
      brightGreen: colors.brightGreen,
      brightYellow: colors.brightYellow,
      brightBlue: colors.brightBlue,
      brightMagenta: colors.brightMagenta,
      brightCyan: colors.brightCyan,
      brightWhite: colors.brightWhite
    }
  }

  const preset = mode === 'light' ? TERMINAL_PRESET_LIGHT : TERMINAL_PRESET_DARK
  const foreground = preset.foreground

  return {
    background: surfaceColor,
    foreground,
    cursor: preset.cursor,
    cursorAccent: surfaceColor,
    selectionBackground: preset.selectionBackground,
    black: foreground,
    red: foreground,
    green: foreground,
    yellow: foreground,
    blue: foreground,
    magenta: foreground,
    cyan: foreground,
    white: foreground,
    brightBlack: foreground,
    brightRed: foreground,
    brightGreen: foreground,
    brightYellow: foreground,
    brightBlue: foreground,
    brightMagenta: foreground,
    brightCyan: foreground,
    brightWhite: foreground,
    // Neutralize the 256-color palette (indices 16-255) too: 8-bit color
    // sequences (ESC[38;5;Nm) bypass the 16 named ANSI colors above, so map
    // every extended slot to the foreground to keep monochrome truly mono.
    extendedAnsi: Array.from({ length: 240 }, () => foreground)
  }
}
