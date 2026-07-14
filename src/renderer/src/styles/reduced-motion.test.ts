import { describe, expect, it } from 'vitest'

describe('reduced motion stylesheet', () => {
  it('provides a global reduced-motion media rule with bounded animation and transition timing', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const css = await readFile(new URL('./reduced-motion.css', import.meta.url), 'utf8')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-duration: 1ms !important')
    expect(css).toContain('transition-duration: 1ms !important')
    expect(css).toContain('scroll-behavior: auto !important')
  })
})
