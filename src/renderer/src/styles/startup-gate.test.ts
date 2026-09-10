import { describe, expect, it } from 'vitest'
import { readStylesheetBundle } from '../testing/stylesheet-bundle'

describe('Kun startup styles', () => {
  it('animates a single breathing logo as the only loading motion', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).toContain('@keyframes kun-startup-breathe')
    expect(css).toMatch(/\.kun-startup__logo\s*{[\s\S]*?animation: kun-startup-breathe 2\.6s/)
    expect(css).not.toContain('kun-startup__progress')
    expect(css).not.toContain('kun-startup__artwork')
  })

  it('pauses the logo for recovery and reduced-motion users', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).toMatch(/\.kun-startup__logo\[data-motion='paused'\]\s*{[\s\S]*?animation: none;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kun-startup__logo\s*{[\s\S]*?animation: none;/)
  })
})
