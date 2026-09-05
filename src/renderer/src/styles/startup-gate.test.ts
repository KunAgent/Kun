import { describe, expect, it } from 'vitest'
import { readStylesheetBundle } from '../testing/stylesheet-bundle'

describe('Kun startup motion styles', () => {
  it('pauses all decorative motion for recovery and reduced-motion users', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).toMatch(/\.kun-startup__artwork\[data-motion='paused'\][\s\S]*?animation: none !important;/)
    expect(css).toMatch(/\.kun-startup-artwork__workspace-flow\s*{[\s\S]*?animation: kun-startup-workspace-flow/)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kun-startup__motion\s*{[\s\S]*?animation: none !important;/)
  })

  it('gives every randomized scene a distinct motion profile', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).toContain('animation: kun-startup-character-breathe 3.6s')
    for (const variant of ['wave', 'dash', 'focus', 'cast']) {
      expect(css).toContain(`.kun-startup__artwork[data-variant='${variant}']`)
      expect(css).toContain(`animation: kun-startup-character-${variant}`)
      expect(css).toContain(`[data-startup-variant='${variant}'] .kun-startup__progress-indicator`)
    }
  })

  it('gives every randomized scene a unique animated prop', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    for (const variant of ['signal', 'wave', 'dash', 'focus', 'cast']) {
      expect(css).toContain(`animation: kun-startup-prop-${variant}`)
      expect(css).toContain(`@keyframes kun-startup-prop-${variant}`)
    }
    expect(css).toMatch(/\.kun-startup-artwork__prop-wrap\s*{[\s\S]*?opacity:/)
  })

  it('keeps every looping startup element at a constant size', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))
    const keyframes = [...css.matchAll(/@keyframes (kun-startup-[^{]+)\s*\{([\s\S]*?)\n\}/gu)]

    for (const [, name, body] of keyframes) {
      const scaleTransforms = [...body.matchAll(/scale(?:X|Y)?\(([^)]+)\)/gu)]
        .map((match) => match[0])
      expect(new Set(scaleTransforms).size, `${name} changes scale while loading`)
        .toBeLessThanOrEqual(1)
    }
  })

  it('removes the shared floor pad and presents the focus lotus as a compact signal', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).not.toContain('.kun-startup-artwork__ground-glow')
    expect(css).toMatch(
      /\[data-variant='focus'\] \.kun-startup-artwork__prop-wrap\s*{[\s\S]*?top: 27%;[\s\S]*?right: 45%;[\s\S]*?width: 16%;/
    )
  })
})
