import {
  resolveTerminalTheme as resolveTerminalThemeFromSettings,
  TERMINAL_PRESET_DARK,
  TERMINAL_PRESET_LIGHT,
  type TerminalColorSettingsV1
} from '@shared/app-settings'

import type { TerminalTarget } from './terminal-backend'

export type TerminalTab = {
  id: string
  index: number
  title?: string
  target: TerminalTarget
}

export type TerminalTabContextMenu = {
  tabId: string
  x: number
  y: number
}

export type TerminalTabState = {
  tabs: TerminalTab[]
  activeTabId: string
}

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

// Monospace stack matches the editor's preference and falls back to a
// platform-appropriate default (Menlo on macOS, Consolas on Windows).
export const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
export const TERMINAL_FONT_SIZE = 13
export const TERMINAL_SCROLLBACK = 5000
export const FIT_DEBOUNCE_MS = 80
export const INITIAL_TAB_ID = 'main'
export const MAX_RENDERER_TABS = 8

export function initialTerminalTabState(): TerminalTabState {
  return {
    tabs: [{ id: INITIAL_TAB_ID, index: 1, target: { kind: 'local' } }],
    activeTabId: INITIAL_TAB_ID
  }
}

function resolveThemeMode(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function isTransparentColor(color: string): boolean {
  return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
}

function parseCssColor(color: string): RgbaColor | null {
  if (isTransparentColor(color)) return { r: 0, g: 0, b: 0, a: 0 }
  const match = color.match(/^rgba?\((.+)\)$/)
  if (!match) return null
  const normalized = match[1].replace(/\s*\/\s*/, ', ')
  const parts = normalized.includes(',')
    ? normalized.split(',').map((part) => part.trim())
    : normalized.trim().split(/\s+/)
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part))
  const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
  if (![r, g, b, alpha].every(Number.isFinite)) return null
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
    a: Math.min(1, Math.max(0, alpha))
  }
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  }
}

function toOpaqueRgb(color: RgbaColor): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
}

function resolveTerminalSurfaceColor(container: HTMLElement | null): string {
  const layers: RgbaColor[] = []
  let node: HTMLElement | null = container
  while (node) {
    const color = parseCssColor(getComputedStyle(node).backgroundColor)
    if (color && color.a > 0) layers.push(color)
    if (color && color.a >= 1) break
    node = node.parentElement
  }
  const fallback = parseCssColor(resolveThemeMode() === 'light' ? TERMINAL_PRESET_LIGHT.background : TERMINAL_PRESET_DARK.background) ?? {
    r: 255,
    g: 255,
    b: 255,
    a: 1
  }
  const resolved = layers.reduceRight((background, foreground) => compositeColor(foreground, background), fallback)
  return toOpaqueRgb(resolved)
}

export function resolveTerminalTheme(
  container: HTMLElement | null,
  colors: TerminalColorSettingsV1
) {
  const surfaceColor = resolveTerminalSurfaceColor(container)
  const mode = resolveThemeMode()
  return resolveTerminalThemeFromSettings(colors, mode, surfaceColor)
}
