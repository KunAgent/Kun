import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const luminance = (hex: string, factor = 1) => {
  const rgb = hex.match(/\w\w/g)!.map((part) => Math.min(1, parseInt(part, 16) / 255 * factor))
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
}
describe('new conversation primary actions', () => {
  it('uses the theme control foreground pair and retains accessible interaction states', async () => {
    const css = await readFile(new URL('./room-new-chat-actions.css', import.meta.url), 'utf8')
    expect(css).toContain('background: color-mix(in srgb, var(--ds-control) 75%, black)')
    expect(css).toContain('color: var(--ds-control-foreground)')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain(':focus-visible')
    expect(css).toContain(':disabled')
    expect(css).toContain('prefers-reduced-motion')
    const tokens = await readFile(new URL('../../styles/base-shell/tokens-window-workspace.css', import.meta.url), 'utf8')
    const pairs = [...tokens.matchAll(/--ds-control:\s*(#[0-9a-f]{6});\s*--ds-control-foreground:\s*(#[0-9a-f]{6});/gi)]
    expect(pairs.length).toBeGreaterThanOrEqual(2)
    for (const [, background, foreground] of pairs) {
      for (const brightness of [1, 1.05, .94]) {
        const a = luminance(background, .75 * brightness), b = luminance(foreground, brightness)
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
