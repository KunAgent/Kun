import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readStylesheetBundle } from '../testing/stylesheet-bundle'

describe('Kun startup styles', () => {
  it('fills the viewport at every desktop zoom and leaves mobile viewport units unscaled', async () => {
    const css = await readStylesheetBundle(new URL('./startup-gate.css', import.meta.url))

    expect(css).toMatch(/\.kun-startup,\s*\.kun-startup__fill\s*\{[^}]*min-height:\s*calc\(100vh\s*\/\s*var\(--ds-ui-scale,\s*1\)\)/)
    expect(css).toMatch(/html\[data-remote-surface='mobile'\][^{]*\{[^}]*min-height:\s*100vh/)
    expect(css).toMatch(/\.kun-startup,\s*\.kun-startup__fill\s*\{[^}]*box-sizing:\s*border-box/)
    expect(css).toMatch(/\.kun-startup__content\s*\{[^}]*transform:\s*scale\(calc\(1\s*\/\s*var\(--ds-ui-scale,\s*1\)\)\)/)
    expect(css).toMatch(/html\[data-remote-surface='mobile'\]\s+\.kun-startup__content\s*\{[^}]*transform:\s*none/)
  })

  it('provides an accessible first-paint shell before the renderer script runs', async () => {
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
    expect(html).toMatch(/<div id="root">\s*<main class="kun-initial-startup" role="status"/)
    // Resolve as a browser at the dev-server root would: ../ cannot escape its root.
    const logoSrc = html.match(/<img src="([^"]+)"/)?.[1]
    expect(logoSrc).toBeTruthy()
    const logoPath = new URL(logoSrc!, 'http://localhost/index.html').pathname
    const logo = await readFile(new URL(`../..${logoPath}`, import.meta.url))
    expect(logo.subarray(1, 4).toString()).toBe('PNG')
    expect(html.indexOf('class="kun-initial-startup"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
    expect(html).toContain('prefers-reduced-motion: reduce')
  })

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
