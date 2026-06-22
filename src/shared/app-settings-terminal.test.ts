import { describe, expect, it } from 'vitest'
import {
  defaultTerminalColors,
  normalizeTerminalColors,
  resolveTerminalTheme
} from './app-settings-terminal'

describe('normalizeTerminalColors hex validation', () => {
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
