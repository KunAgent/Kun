import { describe, expect, it } from 'vitest'
import {
  defaultWritePaperModeSettings,
  mergeWritePaperModeSettings,
  normalizeWritePaperModeSettings,
  PAPER_MODE_DEFAULT_ARXIV_CATEGORIES
} from './app-settings-paper-mode'
import { mergeWriteSettings, normalizeWriteSettings } from './app-settings-write'

describe('write.paperMode settings', () => {
  it('defaults to disabled with an empty library list', () => {
    const settings = defaultWritePaperModeSettings()
    expect(settings.enabled).toBe(false)
    expect(settings.libraries).toEqual([])
    expect(settings.activeLibrary).toBe('')
    expect(settings.autoMarkReading).toBe(true)
    expect(settings.translate).toMatchObject({ targetLanguage: 'zh', inheritModel: true })
    expect(settings.discover.arxivCategories).toEqual(PAPER_MODE_DEFAULT_ARXIV_CATEGORIES)
    expect(settings.scholar.onlineReferences).toBe(true)
    expect(settings.reader.paperTone).toBe('white')
  })

  it('normalizes partial input, trimming and deduping libraries', () => {
    const settings = normalizeWritePaperModeSettings({
      enabled: true,
      libraries: [' /a ', '/a', '', '/b', 7 as never],
      activeLibrary: ' /b ',
      translate: { targetLanguage: 'en', inheritModel: false, providerId: 'p', model: 'm' },
      reader: { paperTone: 'sepia' }
    })
    expect(settings).toMatchObject({
      enabled: true,
      libraries: ['/a', '/b'],
      activeLibrary: '/b',
      translate: { targetLanguage: 'en', inheritModel: false, providerId: 'p', model: 'm' },
      reader: { paperTone: 'sepia' }
    })
  })

  it('drops feeds without https urls and caps categories', () => {
    const settings = normalizeWritePaperModeSettings({
      discover: {
        arxivCategories: ['cs.CL', 'not a category!', 'astro-ph.HE'],
        feeds: [
          { id: 'a', url: 'https://example.com/feed.xml', title: 'Feed' },
          { id: 'b', url: 'http://insecure.example.com/feed', title: 'x' },
          { url: 'ftp://nope', title: 'y' }
        ]
      }
    })
    expect(settings.discover.arxivCategories).toEqual(['cs.CL', 'astro-ph.HE'])
    expect(settings.discover.feeds).toEqual([
      { id: 'a', url: 'https://example.com/feed.xml', title: 'Feed' }
    ])
  })

  it('falls back to default categories when the patch list is empty/invalid', () => {
    expect(
      normalizeWritePaperModeSettings({ discover: { arxivCategories: ['!!!'] } })
        .discover.arxivCategories
    ).toEqual(PAPER_MODE_DEFAULT_ARXIV_CATEGORIES)
  })

  it('round-trips through mergeWriteSettings without dropping nested fields', () => {
    const base = normalizeWriteSettings(undefined)
    const merged = mergeWriteSettings(base, {
      paperMode: {
        enabled: true,
        libraries: ['/lib/a'],
        activeLibrary: '/lib/a',
        translate: { model: 'deepseek-v4-pro', providerId: 'deepseek' },
        discover: { feeds: [{ id: 'f1', url: 'https://x.test/rss', title: 'X' }] },
        scholar: { crossrefMailto: 'me@example.com' },
        reader: { paperTone: 'dark' }
      }
    })
    expect(merged.paperMode).toMatchObject({
      enabled: true,
      libraries: ['/lib/a'],
      activeLibrary: '/lib/a',
      autoMarkReading: true,
      translate: { model: 'deepseek-v4-pro', providerId: 'deepseek', inheritModel: true },
      discover: { feeds: [{ id: 'f1', url: 'https://x.test/rss', title: 'X' }] },
      scholar: { crossrefMailto: 'me@example.com', onlineReferences: true },
      reader: { paperTone: 'dark' }
    })
    // A second patch that only touches enabled must keep the nested objects.
    const toggled = mergeWriteSettings(merged, { paperMode: { enabled: false } })
    expect(toggled.paperMode.enabled).toBe(false)
    expect(toggled.paperMode.translate.model).toBe('deepseek-v4-pro')
    expect(toggled.paperMode.reader.paperTone).toBe('dark')
  })

  it('keeps paperMode independent from paperReading', () => {
    const merged = mergeWriteSettings(normalizeWriteSettings(undefined), {
      paperReading: { papersDir: 'refs' }
    })
    expect(merged.paperReading.papersDir).toBe('refs')
    expect(merged.paperMode).toEqual(defaultWritePaperModeSettings())
  })
})
