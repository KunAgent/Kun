import { describe, expect, it } from 'vitest'
import { readStylesheetBundle } from '../testing/stylesheet-bundle'

describe('Kun loader styles', () => {
  it('rides Kun on the swell: one crest passes per bob, hop and splash share a clock', async () => {
    const css = await readStylesheetBundle(new URL('./kun-loader.css', import.meta.url))

    expect(css).toMatch(/\.kun-loader__sea--front \.kun-loader__wave\s*{[\s\S]*?animation: kun-loader-wave calc\(var\(--kun-loader-crest\) \* 2\)/)
    expect(css).toMatch(/\.kun-loader__bird\s*{[\s\S]*?animation: kun-loader-bob var\(--kun-loader-crest\)/)
    expect(css).toMatch(/\.kun-loader__rider\s*{[\s\S]*?animation: kun-loader-hop 6s/)
    expect(css).toMatch(/\.kun-loader__splash > i\s*{[\s\S]*?animation: kun-loader-splash-left 6s/)
  })

  it('stops all loader motion for reduced-motion users, including the click spin', async () => {
    const css = await readStylesheetBundle(new URL('./kun-loader.css', import.meta.url))

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kun-loader__bird\[data-flip\],[\s\S]*?{\s*animation: none;/
    )
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.kun-loader__splash\s*{\s*display: none;/)
  })
})
