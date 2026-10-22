import { describe, expect, it } from 'vitest'
import { pickHighlights } from '@shared/release-notes-summary'
import { loadWhatsNewContent } from './whats-new-content'
import { SPOTLIGHT_HIGHLIGHT_LIMIT, whatsNewSpotlight } from './whats-new-spotlights'

describe('whatsNewSpotlight', () => {
  it('gives 0.4.1 the Focus mode card and other versions none', () => {
    expect(whatsNewSpotlight('0.4.1')?.id).toBe('focus-mode')
    expect(whatsNewSpotlight('v0.4.1')?.id).toBe('focus-mode')
    expect(whatsNewSpotlight('0.4.0')).toBeNull()
  })

  it('gives 0.4.2 the Artifacts library card', () => {
    expect(whatsNewSpotlight('v0.4.2')?.id).toBe('artifacts')
  })

  it.each(['zh', 'en'] as const)('lets the 0.4.2 card replace only the Artifacts highlight (%s)', async (language) => {
    const content = await loadWhatsNewContent({ version: '0.4.2', previousVersion: '0.4.1', changelogUrl: '' }, language)
    const summary = content.current
    expect(summary?.features).toHaveLength(16)
    expect(summary?.fixes).toHaveLength(11)

    const spotlight = whatsNewSpotlight(content.version)
    const picked = pickHighlights(summary!, { exclude: spotlight?.covers, limit: SPOTLIGHT_HIGHLIGHT_LIMIT })
    const shown = [...picked.highlights.map((item) => item.title), ...picked.alsoUpdated]
    expect(picked.highlights).toHaveLength(2)
    expect(picked.alsoUpdated).toHaveLength(4)
    expect(summary!.features.filter((item) => spotlight!.covers.test(item.title))).toHaveLength(1)
    expect(shown.some((title) => /artifact|产物/i.test(title))).toBe(false)
  })

  it.each(['zh', 'en'] as const)('turns the bundled 0.4.1 notes into a feature release (%s)', async (language) => {
    const content = await loadWhatsNewContent({ version: '0.4.1', previousVersion: '0.4.0', changelogUrl: '' }, language)
    const summary = content.current
    expect(summary?.features).toHaveLength(6)
    expect(summary?.fixes).toHaveLength(6)

    const spotlight = whatsNewSpotlight(content.version)
    const picked = pickHighlights(summary!, { exclude: spotlight?.covers, limit: SPOTLIGHT_HIGHLIGHT_LIMIT })
    expect(picked.highlights).toHaveLength(2)
    expect([...picked.highlights.map((item) => item.title), ...picked.alsoUpdated].some((title) => /focus|专注/i.test(title)))
      .toBe(false)
    expect(picked.alsoUpdated).toHaveLength(3)
  })
})
