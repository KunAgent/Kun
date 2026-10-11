import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_DARK_ACCENT,
  DEFAULT_CUSTOM_LIGHT_PALETTE,
  mergeColorPaletteSettings,
  normalizeColorPaletteSettings
} from './app-settings-color-palette'

describe('color palette settings', () => {
  it('defaults legacy snapshots to the Kun palette with packs first', () => {
    expect(normalizeColorPaletteSettings(undefined, undefined)).toEqual({
      id: 'kun',
      uiPackFirst: true,
      customLight: { ...DEFAULT_CUSTOM_LIGHT_PALETTE },
      customDarkAccent: DEFAULT_CUSTOM_DARK_ACCENT
    })
  })

  it('moves users with tuned dark UI colors onto the custom palette', () => {
    expect(normalizeColorPaletteSettings(undefined, { background: '#101010' }).id).toBe('custom')
    expect(normalizeColorPaletteSettings(undefined, { background: '#181818' }).id).toBe('kun')
    expect(normalizeColorPaletteSettings({ id: 'sky' }, { background: '#101010' }).id).toBe('sky')
  })

  it('rejects unknown ids and malformed colors', () => {
    const palette = normalizeColorPaletteSettings({
      id: 'neon' as never,
      customLight: { accent: 'red', panel: '#ABCDEF' },
      customDarkAccent: '#12345'
    })
    expect(palette.id).toBe('kun')
    expect(palette.customLight.accent).toBe(DEFAULT_CUSTOM_LIGHT_PALETTE.accent)
    expect(palette.customLight.panel).toBe('#abcdef')
    expect(palette.customDarkAccent).toBe(DEFAULT_CUSTOM_DARK_ACCENT)
  })

  it('merges partial custom colors without dropping the rest', () => {
    const current = normalizeColorPaletteSettings({ id: 'custom', customLight: { background: '#f0f0f0' } })
    const merged = mergeColorPaletteSettings(current, { customLight: { accent: '#ff0000' }, uiPackFirst: false })
    expect(merged.id).toBe('custom')
    expect(merged.uiPackFirst).toBe(false)
    expect(merged.customLight.background).toBe('#f0f0f0')
    expect(merged.customLight.accent).toBe('#ff0000')
  })
})
