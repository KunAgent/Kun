import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { X_ARTICLE_IMAGE_MISSING } from '../../shared/write-export'

vi.mock('electron', () => ({
  clipboard: {
    write: vi.fn(),
    writeImage: vi.fn()
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false }))
  }
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: () => ({
      toBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])
    })
  }))
}))

import { clipboard, nativeImage } from 'electron'
import {
  X_ARTICLE_CHAR_LIMIT,
  buildWriteXArticleClipboardFragment,
  resolveXArticleImageClipboardWrite,
  sanitizeWriteXArticleMarkdown,
  writeXArticleImageToClipboard
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
    expect(fragment.html).toContain('<p>图片 1</p>')
    expect(fragment.html).not.toContain('data:')
    expect(fragment.html).not.toContain('file://')
    expect(fragment.html).not.toMatch(/<img\b[^>]*cover\.png/i)
    expect(fragment.html).not.toMatch(/<img\b[^>]*loop\.gif/i)
    expect(fragment.html).toContain('📷 Loop')
    expect(fragment.html).toContain('href="https://x.com/kun/status/1234567890"')
    expect(fragment.images).toEqual([{ label: '图片 1', filePath: imagePath }])
    expect(fragment.text).toContain('图片 1')
    expect(fragment.text).not.toContain('#')
    expect(fragment.text).not.toContain('**')
    expect(fragment.text).toContain('const x = 1')
    expect(fragment.text).toContain('📷 Loop')
  })

  it('turns local static images into numbered placeholders and keeps remote https images', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-x-article-img-'))
    const sourcePath = join(workspaceRoot, 'draft.md')
    const coverPath = join(workspaceRoot, 'cover.png')
    const photoPath = join(workspaceRoot, 'photo.jpg')
    await writeFile(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(photoPath, Buffer.from([0xff, 0xd8, 0xff]))

    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath,
      content: [
        '# Title',
        '',
        `![Cover](${pathToFileURL(coverPath).href})`,
        '',
        '![Photo](./photo.jpg)',
        '',
        '![Remote](https://cdn.example.com/hero.webp)'
      ].join('\n')
    })

    expect(fragment.html).toContain('<p>图片 1</p>')
    expect(fragment.html).toContain('<p>图片 2</p>')
    expect(fragment.html).toContain('src="https://cdn.example.com/hero.webp"')
    expect(fragment.html).not.toContain('data:')
    expect(fragment.html).not.toContain('file://')
    expect(fragment.text).toContain('图片 1')
    expect(fragment.text).toContain('图片 2')
    expect(fragment.images).toEqual([
      { label: '图片 1', filePath: coverPath },
      { label: '图片 2', filePath: photoPath }
    ])
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

describe('resolveXArticleImageClipboardWrite', () => {
  it('selects the local image by index', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-x-article-pick-'))
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath,
      content: '# Title\n\n![Cover](./cover.png)'
    })
    expect(resolveXArticleImageClipboardWrite(fragment, 0)).toEqual({
      ok: true,
      filePath: imagePath,
      label: '图片 1',
      imageIndex: 0,
      imageCount: 1
    })
  })

  it('fails when the document has no copyable local images', () => {
    const fragment = buildWriteXArticleClipboardFragment({
      sourcePath: '/tmp/draft.md',
      content: '# Title\n\nNo pictures'
    })
    expect(resolveXArticleImageClipboardWrite(fragment, 0)).toEqual({
      ok: false,
      message: X_ARTICLE_IMAGE_MISSING
    })
  })
})

describe('writeXArticleImageToClipboard', () => {
  beforeEach(() => {
    vi.mocked(clipboard.write).mockReset()
    vi.mocked(clipboard.writeImage).mockReset()
    vi.mocked(nativeImage.createFromPath).mockReset()
    vi.mocked(nativeImage.createFromBuffer).mockReset()
    vi.mocked(nativeImage.createFromPath).mockReturnValue({ isEmpty: () => false } as never)
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ isEmpty: () => false } as never)
  })

  it('writes a native image and does not mix html onto the clipboard', async () => {
    await writeXArticleImageToClipboard('/tmp/cover.png')
    expect(nativeImage.createFromPath).toHaveBeenCalledWith('/tmp/cover.png')
    expect(clipboard.writeImage).toHaveBeenCalledOnce()
    expect(clipboard.write).not.toHaveBeenCalled()
  })

  it('falls back to sharp when nativeImage cannot read the file', async () => {
    vi.mocked(nativeImage.createFromPath).mockReturnValue({ isEmpty: () => true } as never)
    await writeXArticleImageToClipboard('/tmp/cover.webp')
    expect(nativeImage.createFromBuffer).toHaveBeenCalledOnce()
    expect(clipboard.writeImage).toHaveBeenCalledOnce()
  })
})
