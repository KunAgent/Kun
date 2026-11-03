import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareVersions, firstSentence, parseReleaseNotes, pickHighlights } from './release-notes-summary'

const BILINGUAL = `# Kun 0.3.12

0.3.12 在实验室中加入模型主动上下文压缩，并修复 Windows 升级后无法启动的问题。

## ✨ 新功能

- **模型主动上下文压缩**：实验室新增「上下文压缩」。开启后会提示模型处理，并提供 \`compact_context\`。
- **其他**：若干细节。

## 🐛 修复与改进

- **Windows 升级启动**：修复从旧版升级后启动失败 (#1335, #1336)（#1286）。

## 更新方式

通过应用内更新入口下载更新。

---

## English

Kun 0.3.12 adds model-initiated context compression.

- **Model-initiated context compression**: Laboratory gains a Context compression section.
- **More**: small details.
- **Windows upgrade startup**: startup after upgrading works again.

Download the update from Kun and restart to install.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.11...v0.3.12)
`

const GROUPED = `# Kun v0.3.6

v0.3.6 为计划执行带来定时构建。

### 计划定时构建

- 计划面板新增定时构建。
- 定时构建复用原计划会话。

### 用量与成本统计

- 配额面板显示订阅价值估算。
`

describe('parseReleaseNotes', () => {
  it('reads the Chinese half: intro, features and fixes, without the install section', () => {
    expect(parseReleaseNotes(BILINGUAL, 'v0.3.12', 'zh')).toEqual({
      version: '0.3.12',
      intro: '0.3.12 在实验室中加入模型主动上下文压缩，并修复 Windows 升级后无法启动的问题。',
      features: [
        { title: '模型主动上下文压缩', body: '实验室新增「上下文压缩」。开启后会提示模型处理，并提供 compact_context。' },
        { title: '其他', body: '若干细节。' }
      ],
      fixes: [{ title: 'Windows 升级启动', body: '修复从旧版升级后启动失败。' }]
    })
  })

  it('splits a flat English list in the Chinese order when the counts match', () => {
    const summary = parseReleaseNotes(BILINGUAL, '0.3.12', 'en')
    expect(summary?.intro).toBe('Kun 0.3.12 adds model-initiated context compression.')
    expect(summary?.features.map((item) => item.title)).toEqual(['Model-initiated context compression', 'More'])
    expect(summary?.fixes.map((item) => item.title)).toEqual(['Windows upgrade startup'])
  })

  it('turns untitled bullets under ### groups into one item per group', () => {
    const summary = parseReleaseNotes(GROUPED, '0.3.6', 'en')
    expect(summary?.features).toEqual([
      { title: '计划定时构建', body: '计划面板新增定时构建。' },
      { title: '用量与成本统计', body: '配额面板显示订阅价值估算。' }
    ])
  })

  it('files a heading that names features and improvements by its first term', () => {
    const notes = '# Kun 0.4.1\n\n## ✨ 新功能与体验改进\n\n- **专注模式**：新开关。\n\n## 🐛 修复与改进\n\n- **长会话**：不再受阻。\n'
    const summary = parseReleaseNotes(notes, '0.4.1', 'zh')
    expect(summary?.features.map((item) => item.title)).toEqual(['专注模式'])
    expect(summary?.fixes.map((item) => item.title)).toEqual(['长会话'])

    const english = '## English\n\n### Features and improvements\n\n- **Focus mode**: a switch.\n\n### Fixes and improvements\n\n- **Long chats**: unblocked.\n'
    expect(parseReleaseNotes(english, '0.4.1', 'en')?.features.map((item) => item.title)).toEqual(['Focus mode'])
  })

  it('returns null for text with nothing to summarize', () => {
    expect(parseReleaseNotes('# Kun 1.0.0\n\n## 更新方式\n\n- 重启即可。\n', '1.0.0', 'zh')).toBeNull()
  })
})

describe('pickHighlights', () => {
  it('skips catch-all items and caps highlights and chips', () => {
    const features = ['A', '其他', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((title) => ({ title, body: `${title} 的说明。` }))
    const picked = pickHighlights({ version: '1.0.0', intro: '', features, fixes: [] })
    expect(picked.highlights.map((item) => item.title)).toEqual(['A', 'B', 'C'])
    expect(picked.alsoUpdated).toEqual(['D', 'E', 'F', 'G'])
  })

  it('leaves out titles a spotlight already tells and honours a smaller limit', () => {
    const features = ['Code 首页与 Focus 模式', 'A', 'B', 'C'].map((title) => ({ title, body: `${title} 的说明。` }))
    const picked = pickHighlights({ version: '0.4.1', intro: '', features, fixes: [] }, { exclude: /focus/i, limit: 2 })
    expect(picked.highlights.map((item) => item.title)).toEqual(['A', 'B'])
    expect(picked.alsoUpdated).toEqual(['C'])
  })
})

describe('0.4.3 release content', () => {
  const markdown = readFileSync(new URL('../../release/release-v0.4.3.md', import.meta.url), 'utf8')

  it.each([
    { language: 'zh' as const, intro: '0.4.3 让计划执行', titles: ['计划执行 Agent 选择', '任务分派与协作', '账户与会员入口'], chips: ['更轻量的计划工作区', 'MiniMax-M3.1-Flash'], fix: '工具调用稳定性' },
    { language: 'en' as const, intro: 'Kun 0.4.3 makes plan execution', titles: ['Choose the plan execution Agent', 'Task dispatch and collaboration', 'Account and membership access'], chips: ['Lighter plan worktrees', 'MiniMax-M3.1-Flash'], fix: 'Tool-call stability' }
  ])('parses the shipped $language notes for the update panel', ({ language, intro, titles, chips, fix }) => {
    const summary = parseReleaseNotes(markdown, '0.4.3', language)!
    expect(summary.intro.startsWith(intro)).toBe(true)
    expect(summary.features).toHaveLength(5)
    expect(summary.fixes).toHaveLength(7)
    expect(summary.fixes[0].title).toBe(fix)
    const picked = pickHighlights(summary)
    expect(picked.highlights.map((item) => item.title)).toEqual(titles)
    expect(picked.alsoUpdated).toEqual(chips)
    expect(picked.highlights.every((item) => item.body.length > 0 && item.body.length <= 96)).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('Full changelog')
    expect(JSON.stringify(summary)).not.toContain('github.com')
    if (language === 'en') expect(JSON.stringify(summary)).not.toMatch(/[\u4e00-\u9fff]/)
    else expect(summary.intro).not.toContain('Kun 0.4.3 makes')
  })
})

describe('helpers', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.3.10', '0.3.9')).toBe(1)
    expect(compareVersions('v0.3.9', '0.3.9')).toBe(0)
    expect(compareVersions('0.2.40', '0.3.0')).toBe(-1)
  })

  it('keeps short first sentences together and truncates long ones', () => {
    expect(firstSentence('很短。第二句也短。第三句不要。')).toBe('很短。第二句也短。第三句不要。')
    expect(firstSentence('This is long enough to stand alone as one sentence. Second one.')).toBe(
      'This is long enough to stand alone as one sentence.'
    )
    expect(firstSentence('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
  })
})
