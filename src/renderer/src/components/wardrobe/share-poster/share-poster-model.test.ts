import { describe, expect, it } from 'vitest'
import { posterCopy, posterFileName, posterLayout, posterQrContent } from './share-poster-model'
import { posterQrSvg } from './share-poster-render'

describe('invite poster contract', () => {
  it('keeps portrait and square content inside the export with room for the title and card', () => {
    for (const size of ['portrait', 'square'] as const) {
      const p = posterLayout(size)
      expect(p.width).toBe(1080)
      expect(p.height).toBe(size === 'portrait' ? 1440 : 1080)
      expect(p.avatar.size).toBe(size === 'portrait' ? 540 : 378)
      expect(p.titleY + p.titleSize * 2.5).toBeLessThan(p.card.y)
      expect(p.card.y + p.card.height).toBeLessThan(p.brandY - 26)
      expect(p.card.width + p.margin * 2).toBe(p.width)
    }
  })
  it('uses Chinese only for Chinese languages and English for the other five', () => {
    expect(posterCopy('zh-CN').code).toBe('邀请码')
    for (const lang of ['en', 'ja', 'ko', 'ru', 'hi', 'th']) expect(posterCopy(lang).code).toBe('Invite code')
  })
  it('cleans filenames and limits code length', () => {
    expect(posterFileName('../A/B:C?D', 'zh')).toBe('Kun-邀请-ABCD.png')
    expect(posterFileName('', 'en')).toBe('Kun-Invite-Kun.png')
    expect(posterFileName('A'.repeat(100), 'en').length).toBeLessThan(60)
  })
  it('requires a usable server link and preserves it exactly', () => {
    const url = 'https://kun-agent.com/invite/K7QM4XPA'
    expect(posterQrContent('K7QM4XPA', url)).toBe(url)
    for (const [code, link] of [['', url], ['K7QM4XPA', ''], ['K7QM4XPA', 'javascript:alert(1)'], ['K7QM4XPA', 'https://kun-agent.com/invite/OTHER123'], ['K7QM4XPA', 'https://user:secret@kun-agent.com/invite/K7QM4XPA']]) {
      expect(() => posterQrContent(code, link)).toThrow()
    }
  })
  it('uses integer modules and at least four quiet modules for QR rendering', () => {
    const { svg, pixels } = posterQrSvg('https://kun-agent.com/invite/K7QM4XPA', '#111a2f')
    const modules = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1])
    expect(pixels % modules).toBe(0)
    expect(pixels).toBeLessThanOrEqual(223)
    expect(svg).toContain('M4 4')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })
})
