import { describe, expect, it } from 'vitest'

describe('high contrast stylesheet', () => {
  it('declares forced-colors control and focus rules', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const css = await readFile(new URL('./high-contrast.css', import.meta.url), 'utf8')
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('forced-color-adjust: auto')
    expect(css).toContain('outline: 2px solid Highlight')
    expect(css).toContain('color: GrayText')
  })
})
