import { describe, expect, it } from 'vitest'
import {
  defaultTerminalColors,
  normalizeTerminalColors,
  resolveTerminalTheme
} from './app-settings-terminal'

describe('normalizeTerminalColors hex validation', () => {
  it('defaults to native colors so shell ANSI colors are shown', () => {
    expect(defaultTerminalColors().colorMode).toBe('native')
    expect(normalizeTerminalColors(undefined).colorMode).toBe('native')
  })

  it('migrates the old persisted default custom palette to native mode', () => {
    const result = normalizeTerminalColors({
      ...defaultTerminalColors(),
      colorMode: 'custom'
    })
    expect(result.colorMode).toBe('native')
  })

  it('keeps user-edited custom colors as custom mode', () => {
    const result = normalizeTerminalColors({
      ...defaultTerminalColors(),
      colorMode: 'custom',
      background: '#101828'
    })
    expect(result.colorMode).toBe('custom')
    expect(result.background).toBe('#101828')
  })

  it('accepts #rgb, #rrggbb, and #rrggbbaa forms', () => {
    const result = normalizeTerminalColors({
      colorMode: 'custom',
      foreground: '#fff',
      background: '#101828',
      selectionBackground: '#264f78aa'
    })
    expect(result.foreground).toBe('#fff')
    expect(result.background).toBe('#101828')
    // 8-digit (alpha) form must survive instead of being dropped to the default.
    expect(result.selectionBackground).toBe('#264f78aa')
  })

  it('rejects malformed hex and falls back to defaults', () => {
    const defaults = defaultTerminalColors()
    const result = normalizeTerminalColors({
      colorMode: 'custom',
      // 5 digits is not a valid form; must fall back.
      foreground: '#12345',
      // trailing non-hex char.
      red: '#gg0000'
    })
    expect(result.foreground).toBe(defaults.foreground)
    expect(result.red).toBe(defaults.red)
  })
})

describe('resolveTerminalTheme native colors', () => {
  it('keeps the built-in ANSI palette in native mode', () => {
    const colors = normalizeTerminalColors({ colorMode: 'native' })
    const theme = resolveTerminalTheme(colors, 'dark', 'rgb(21, 29, 49)')
    expect(theme.extendedAnsi).toBeUndefined()
    expect(theme.red).toBe('#ff6b6b')
    expect(theme.green).toBe('#7ee787')
    expect(theme.background).toBe('rgb(21, 29, 49)')
  })

  it('uses the previous light ANSI palette in native light mode', () => {
    const colors = normalizeTerminalColors({ colorMode: 'native' })
    const theme = resolveTerminalTheme(colors, 'light', 'rgb(243, 245, 252)')
    expect(theme.extendedAnsi).toBeUndefined()
    expect(theme.red).toBe('#cf222e')
    expect(theme.green).toBe('#1a7f37')
    expect(theme.foreground).toBe('#1f2328')
  })
})

describe('resolveTerminalTheme monochrome neutralization', () => {
  it('maps the 256-color extended palette (16-255) to the foreground in mono mode', () => {
    const colors = normalizeTerminalColors({ colorMode: 'none' })
    const theme = resolveTerminalTheme(colors, 'dark', 'rgb(21, 29, 49)')
    expect(theme.extendedAnsi).toBeDefined()
    expect(theme.extendedAnsi).toHaveLength(240)
    // Every extended slot is the foreground so 8-bit color stays monochrome.
    const unique = new Set(theme.extendedAnsi)
    expect(unique.size).toBe(1)
    expect(theme.extendedAnsi?.[0]).toBe(theme.foreground)
    // Base 16 ANSI colors are also collapsed to the foreground.
    expect(theme.red).toBe(theme.foreground)
    expect(theme.brightGreen).toBe(theme.foreground)
  })

  it('leaves the extended palette untouched in custom mode', () => {
    const colors = normalizeTerminalColors({ colorMode: 'custom', red: '#ff0000' })
    const theme = resolveTerminalTheme(colors, 'dark', 'rgb(21, 29, 49)')
    expect(theme.extendedAnsi).toBeUndefined()
    expect(theme.red).toBe('#ff0000')
  })
})
