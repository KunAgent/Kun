import { describe, expect, it } from 'vitest'
import { pickHighlights } from '@shared/release-notes-summary'
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

  it.each(['zh', 'en'] as const)('loads bundled 0.4.3 in %s with skipped release history', async (language) => {
    const changelogUrl = 'https://github.com/KunAgent/Kun/compare/v0.4.2...v0.4.3'
    const content = await loadWhatsNewContent(
      { version: 'v0.4.3', previousVersion: '0.4.1', changelogUrl },
      language
    )
    expect(content.current?.version).toBe('0.4.3')
    expect(content.current?.features[0]?.title).toBe(
      language === 'zh' ? '计划执行 Agent 选择' : 'Choose the plan execution Agent'
    )
    expect(content.current?.fixes).toHaveLength(7)
    expect(content.older.map((summary) => summary.version)).toEqual(['0.4.2'])
    expect(content.changelogUrl).toBe(changelogUrl)
  })

  it.each(['zh', 'en'] as const)('loads bundled 0.4.4 in %s with curated update highlights', async (language) => {
    const changelogUrl = 'https://github.com/KunAgent/Kun/compare/v0.4.3...v0.4.4'
    const content = await loadWhatsNewContent(
      { version: 'v0.4.4', previousVersion: '0.4.2', changelogUrl },
      language
    )
    expect(content.current?.version).toBe('0.4.4')
    expect(content.current?.intro).toContain(language === 'zh' ? '0.4.4 让资料' : 'Kun 0.4.4 brings sources')
    expect(content.current?.features).toHaveLength(8)
    expect(content.current?.fixes).toHaveLength(8)
    const highlights = content.current ? pickHighlights(content.current) : null
    expect(highlights?.highlights.map((item) => item.title)).toEqual(language === 'zh'
      ? ['Work 标签页与论文空间', '分区多画板设计', '数据报告与产物预览']
      : ['Work tabs and paper space', 'Sectioned multi-board designs', 'Data reports and artifact previews'])
    expect(highlights?.alsoUpdated).toEqual(language === 'zh'
      ? ['工作台与新版引导', '统一应用连接入口', '个人助理任务工作流（Lab）', '存储管理与清理']
      : ['Workbench and guided tours', 'Unified app connections', 'Personal-assistant task workflows (Lab)', 'Storage management and cleanup'])
    expect(content.older.map((summary) => summary.version)).toEqual(['0.4.3'])
    expect(content.previousVersion).toBe('0.4.2')
    expect(content.changelogUrl).toBe(changelogUrl)
  })

  it.each(['zh', 'en'] as const)('loads bundled 0.4.5 in %s without feed notes or a network request', async (language) => {
    const content = await loadWhatsNewContent(
      { version: 'v0.4.5', previousVersion: 'v0.4.4', changelogUrl: 'https://example.com/0.4.5' },
      language
    )
    expect(content.version).toBe('0.4.5')
    expect(content.current?.intro).toContain(language === 'zh' ? '0.4.5 把 Kun' : 'Kun 0.4.5 brings')
    expect(content.current?.features).toHaveLength(8)
    expect(content.current?.fixes).toHaveLength(6)
    const highlights = content.current ? pickHighlights(content.current) : null
    expect(highlights?.highlights.map((item) => item.title)).toEqual(language === 'zh'
      ? ['桌面伙伴', '手机与桌面远控', 'PDF 标签页与论文助手']
      : ['Desktop companions', 'Phone and desktop control', 'PDF tabs and paper assistant'])
    expect(content.current?.features[7]?.title).toBe(language === 'zh' ? 'Design 预览与缩略图' : 'Design previews and thumbnails')
    expect(content.current?.fixes[0]?.title).toBe(language === 'zh' ? '响应中断' : 'Interrupted responses')
    expect(content.older).toEqual([])
    expect(content.previousVersion).toBe('0.4.4')
    expect(content.changelogUrl).toBe('https://example.com/0.4.5')
  })

  it('keeps 0.4.4 in the history when upgrading to 0.4.5 from 0.4.3', async () => {
    const content = await loadWhatsNewContent(
      { version: '0.4.5', previousVersion: '0.4.3', changelogUrl: '' }, 'zh'
    )
    expect(content.current?.version).toBe('0.4.5')
    expect(content.older.map((summary) => summary.version)).toEqual(['0.4.4'])
  })

  it('maps UI locales to the two release-note languages', () => {
    expect(releaseNotesLanguage('zh')).toBe('zh')
    expect(releaseNotesLanguage('zh-CN')).toBe('zh')
    expect(releaseNotesLanguage('ja')).toBe('en')
    expect(releaseNotesLanguage(undefined)).toBe('en')
  })
})
