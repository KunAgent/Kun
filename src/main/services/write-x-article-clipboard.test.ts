import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  X_ARTICLE_CHAR_LIMIT,
  buildWriteXArticleClipboardFragment,
  sanitizeWriteXArticleMarkdown
} from './write-x-article-clipboard'

describe('sanitizeWriteXArticleMarkdown', () => {
  it('demotes h4-h6 headings to h3', () => {
    const result = sanitizeWriteXArticleMarkdown('#### Deep\n\n##### Deeper\n\n###### Deepest')
    expect(result.text).toBe('### Deep\n\n### Deeper\n\n### Deepest')
    expect(result.simplified).toBe(true)
  })

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

  it('turns gif, video, and HTML embeds into links', () => {
    const result = sanitizeWriteXArticleMarkdown(
      '![Loop](./loop.gif)\n\n![Clip](./clip.mp4)\n\n![原型](./proto/card.html)'
    )
    expect(result.text).toContain('[Loop](./loop.gif)')
    expect(result.text).toContain('[Clip](./clip.mp4)')
    expect(result.text).toContain('[原型](./proto/card.html)')
    expect(result.text).not.toContain('![')
    expect(result.simplified).toBe(true)
  })

  it('keeps png images and standalone X status URLs', () => {
    const result = sanitizeWriteXArticleMarkdown(
      '![Cover](./cover.png)\n\nhttps://x.com/kun/status/1234567890'
    )
    expect(result.text).toContain('![Cover](./cover.png)')
    expect(result.text).toContain('https://x.com/kun/status/1234567890')
    expect(result.simplified).toBe(false)
  })
})

describe('buildWriteXArticleClipboardFragment', () => {
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

    expect(fragment.simplified).toBe(true)
    expect(fragment.overLimit).toBe(false)
    expect(fragment.html).toContain('<article class="x-article-body">')
    expect(fragment.html).toContain('<h1>Title</h1>')
    expect(fragment.html).toContain('<h3>Deep</h3>')
    expect(fragment.html).toContain('<strong>Bold</strong>')
    expect(fragment.html).toContain('<del>gone</del>')
    expect(fragment.html).not.toContain('<table>')
    expect(fragment.html).not.toContain('<pre>')
    expect(fragment.html).not.toContain('<code>')
    expect(fragment.html).toContain('<strong>A</strong>')
    expect(fragment.html).toContain(`src="${pathToFileURL(imagePath).href}"`)
    expect(fragment.html).not.toMatch(/<img\b[^>]*loop\.gif/i)
    expect(fragment.html).toContain('>Loop</a>')
    expect(fragment.html).toContain('href="https://x.com/kun/status/1234567890"')
    expect(fragment.text).toContain('### Deep')
    expect(fragment.text).toContain('const x = 1')
  })

  it('renders plain text files as paragraphs', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/notes.txt',
      content: 'plain text\nline two\n\nnext block'
    })

    expect(fragment.simplified).toBe(false)
    expect(fragment.html).toContain('<article class="x-article-body">')
    expect(fragment.html).toContain('<p>plain text<br/>line two</p>')
    expect(fragment.html).toContain('<p>next block</p>')
    expect(fragment.html).not.toContain('<pre>')
    expect(fragment.text).toBe('plain text\nline two\n\nnext block')
  })

  it('flags bodies over the X Articles character limit', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/long.md',
      content: `# Title\n\n${'a'.repeat(X_ARTICLE_CHAR_LIMIT)}`
    })
    expect(fragment.overLimit).toBe(true)
    expect(fragment.text.length).toBeGreaterThan(X_ARTICLE_CHAR_LIMIT)
  })
})
