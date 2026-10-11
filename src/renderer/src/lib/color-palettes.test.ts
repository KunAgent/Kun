import { normalizeColorPaletteSettings } from '@shared/app-settings'
import { COLOR_PALETTE_IDS } from '@shared/app-settings-color-palette'
import { describe, expect, it } from 'vitest'
import { COLOR_PALETTE_PRESETS, accentForeground, buildColorPaletteCss } from './color-palettes'

const palette = (id: string) => normalizeColorPaletteSettings({ id: id as never })

describe('color palettes', () => {
  it('ships a preset for every non-custom palette id', () => {
    expect(COLOR_PALETTE_PRESETS.map((entry) => entry.id)).toEqual(
      COLOR_PALETTE_IDS.filter((id) => id !== 'custom')
    )
  })

  it('scopes preset tokens to the palette, both modes, and the workbench subtree', () => {
    const css = buildColorPaletteCss(palette('sky'))
    expect(css).toContain("html[data-color-palette='sky']")
    expect(css).toContain(":not([data-theme='dark'])")
    expect(css).toContain("[data-theme='dark']")
    expect(css).toContain(' .ds-workbench-shell')
    expect(css).toContain('--ds-accent: #1f6feb')
    expect(css).toContain('--kun-dark-ui-effective-background: #0c1524')
  })

  it('steps aside for appearance packs only while pack-first is on', () => {
    const css = buildColorPaletteCss(palette('mint'))
    expect(css).toContain(":not([data-palette-pack-first='on'][data-ikun-mode='on'])")
    expect(css).toContain(":not([data-palette-pack-first='on'][data-ui-plugin])")
  })

  it('leaves parchment light to its handcrafted stylesheet and Kun light untouched', () => {
    expect(buildColorPaletteCss(palette('parchment'))).not.toContain(":not([data-theme='dark'])")
    const kun = buildColorPaletteCss(palette('kun'))
    expect(kun).not.toContain('--ds-accent')
    expect(kun).toContain('--kun-dark-ui-effective-background: #181818')
  })

  it('keeps custom dark surfaces on the user dark UI colors and only adds the accent', () => {
    const css = buildColorPaletteCss(normalizeColorPaletteSettings({
      id: 'custom',
      customLight: { background: '#f7f8fb', accent: '#2f80ed' },
      customDarkAccent: '#4c9dff'
    }))
    expect(css).toContain('--bg-app: #f7f8fb')
    expect(css).toContain('--ds-accent: #2f80ed')
    expect(css).toContain('--ds-accent: #4c9dff')
    expect(css).not.toContain('--kun-dark-ui-effective-background')
  })

  it('picks a readable foreground for light and dark accents', () => {
    expect(accentForeground('#1f6feb')).toBe('#ffffff')
    expect(accentForeground('#ededed')).toBe('#111111')
    expect(accentForeground('#3fcf9f')).toBe('#111111')
  })
})
