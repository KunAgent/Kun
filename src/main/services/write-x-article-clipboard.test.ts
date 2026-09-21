import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { X_ARTICLE_TITLE_MISSING } from '../../shared/write-export'
import {
  X_ARTICLE_CHAR_LIMIT,
  buildWriteXArticleClipboardFragment,
  resolveXArticleClipboardWrite,
  sanitizeWriteXArticleMarkdown
} from './write-x-article-clipboard'

describe('sanitizeWriteXArticleMarkdown', () => {
  it('flattens tables to bold header rows', () => {
    const result = sanitizeWriteXArticleMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(result.text).toBe('**A**  **B**\n1  2')
    expect(result.simplified).toBe(true)
  })

  it('unwraps fenced code to plain text', () => {
    const result = sanitizeWriteXArticleMarkdown('Intro\n\n```js\nconst x = 1\n```\n\nOutro')
    expect(result.text).toBe('Intro\n\nconst x = 1\n\nOutro')
    expect(result.simplified).toBe(true)
  })

  it('unwraps inline code and task lists', () => {
    const result = sanitizeWriteXArticleMarkdown('- [x] Ship `release`\n- [ ] Follow up')
    expect(result.text).toBe('- Ship release\n- Follow up')
    expect(result.simplified).toBe(true)
  })
})

describe('buildWriteXArticleClipboardFragment', () => {
  it('turns single newlines into separate paragraphs and strips markdown from text', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/draft.md',
      content: '# Title\n\n第一段\n第二段'
    })

    expect(fragment.title).toBe('Title')
    expect(fragment.html).not.toContain('<h1>')
    expect(fragment.html).toContain('<p>第一段</p>\n<p>第二段</p>')
    expect(fragment.text).toBe('第一段\n\n第二段')
    expect(fragment.text).not.toContain('#')
    expect(fragment.html).toContain('<!--StartFragment-->')
  })

  it('renders markdown in the X Articles HTML subset', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-x-article-'))
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath,
      content: [
        '# Title',
        '',
        '## Section',
        '',
        '#### Deep',
        '',
        '**Bold** and ~~gone~~ and `code`',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '```js',
        'const x = 1',
        '```',
        '',
        '![Cover](./cover.png)',
        '',
        '![Loop](./loop.gif)',
        '',
        'https://x.com/kun/status/1234567890'
      ].join('\n')
    })

    expect(fragment.title).toBe('Title')
    expect(fragment.simplified).toBe(true)
    expect(fragment.overLimit).toBe(false)
    expect(fragment.html).not.toContain('<article')
    expect(fragment.html).not.toContain('<h1>')
    expect(fragment.html).not.toContain('<strong>')
    expect(fragment.html).toContain('<h2>Section</h2>')
    expect(fragment.html).toContain('<h3>Deep</h3>')
    expect(fragment.html).toContain('<b>Bold</b>')
    expect(fragment.html).toContain('<s>gone</s>')
    expect(fragment.html).not.toContain('<table>')
    expect(fragment.html).not.toContain('<pre>')
    expect(fragment.html).not.toContain('<code>')
    expect(fragment.html).toContain('<b>A</b>')
    expect(fragment.html).toContain(`src="${pathToFileURL(imagePath).href}"`)
    expect(fragment.html).not.toMatch(/<img\b[^>]*loop\.gif/i)
    expect(fragment.html).toContain('📷 Loop')
    expect(fragment.html).toContain('href="https://x.com/kun/status/1234567890"')
    expect(fragment.text).not.toContain('#')
    expect(fragment.text).not.toContain('**')
    expect(fragment.text).toContain('const x = 1')
    expect(fragment.text).toContain('📷 Loop')
  })

  it('renders plain text files as separate paragraphs', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/notes.txt',
      content: 'plain text\nline two\n\nnext block'
    })

    expect(fragment.title).toBe('')
    expect(fragment.html).toContain('<p>plain text</p>\n<p>line two</p>\n<p>next block</p>')
    expect(fragment.html).not.toContain('<pre>')
    expect(fragment.html).not.toContain('<article')
    expect(fragment.text).toBe('plain text\n\nline two\n\nnext block')
  })

  it('flags bodies over the X Articles character limit', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/long.md',
      content: `# Title\n\n${'a'.repeat(X_ARTICLE_CHAR_LIMIT)}`
    })
    expect(fragment.overLimit).toBe(true)
    expect(fragment.text.length).toBeGreaterThanOrEqual(X_ARTICLE_CHAR_LIMIT)
  })
})

describe('resolveXArticleClipboardWrite', () => {
  it('writes only the extracted title for x-articles-title', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/draft.md',
      content: '# Hello title\n\nBody paragraph'
    })
    const written = resolveXArticleClipboardWrite(fragment, 'x-articles-title')
    expect(written).toMatchObject({ ok: true, text: 'Hello title', title: 'Hello title' })
    if (!written.ok) return
    expect(written.html).toContain('<p>Hello title</p>')
    expect(written.html).not.toContain('Body paragraph')
  })

  it('fails title copy when the document has no H1', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/draft.md',
      content: '## Only a section\n\nBody'
    })
    expect(resolveXArticleClipboardWrite(fragment, 'x-articles-title')).toEqual({
      ok: false,
      message: X_ARTICLE_TITLE_MISSING
    })
  })
})
