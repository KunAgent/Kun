import { describe, expect, it } from 'vitest'
import { loadWhatsNewContent, releaseNotesLanguage } from './whats-new-content'

const note = (version: string, feature: string): string =>
  `# Kun ${version}\n\n${version} 简介。\n\n## ✨ 新功能\n\n- **${feature}**：说明。\n`

const files = {
  '../release/release-v0.3.8.md': async () => note('0.3.8', '八'),
  '../release/release-v0.3.9.md': async () => note('0.3.9', '九'),
  '../release/release-v0.3.10.md': async () => note('0.3.10', '十'),
  '../release/release-v0.3.11.md': async () => note('0.3.11', '十一')
}

describe('loadWhatsNewContent', () => {
  it('loads the current version and the skipped ones between, newest first', async () => {
    const content = await loadWhatsNewContent(
      { version: '0.3.11', previousVersion: '0.3.8', changelogUrl: 'https://example.com/log' },
      'zh',
      files
    )
    expect(content.current?.features[0]?.title).toBe('十一')
    expect(content.older.map((summary) => summary.version)).toEqual(['0.3.10', '0.3.9'])
    expect(content.previousVersion).toBe('0.3.8')
  })

  it('falls back to the feed notes, then to nothing, when no file is bundled', async () => {
    const fromFeed = await loadWhatsNewContent(
      { version: '0.4.0', releaseNotes: '- **新东西**：说明。', changelogUrl: 'https://example.com/log' },
      'zh',
      files
    )
    expect(fromFeed.current?.features).toEqual([{ title: '新东西', body: '说明。' }])

    const missing = await loadWhatsNewContent({ version: '0.4.1', changelogUrl: 'https://example.com/log' }, 'zh', files)
    expect(missing.current).toBeNull()
    expect(missing.older).toEqual([])
  })

  it('bundles the real release notes', async () => {
    const content = await loadWhatsNewContent({ version: '0.3.11', changelogUrl: '' }, 'en')
    expect(content.current?.features.length).toBeGreaterThan(0)
  })

  it('maps UI locales to the two release-note languages', () => {
    expect(releaseNotesLanguage('zh')).toBe('zh')
    expect(releaseNotesLanguage('zh-CN')).toBe('zh')
    expect(releaseNotesLanguage('ja')).toBe('en')
    expect(releaseNotesLanguage(undefined)).toBe('en')
  })
})
