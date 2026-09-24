import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  clipboard: {
    write: vi.fn(),
    writeImage: vi.fn()
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
    createFromBuffer: vi.fn(() => ({ isEmpty: () => false }))
  },
  dialog: {
    showSaveDialog: vi.fn()
  }
}))

import {
  buildWriteClipboardHtmlFragment,
  buildWriteExportFileName,
  buildWriteExportHtmlDocument,
  copyWriteDocumentAsRichText,
  exportWriteDocument
} from './write-export-service'
import { clipboard, dialog, nativeImage } from 'electron'
import { X_ARTICLE_IMAGE_MISSING } from '../../shared/write-export'

describe('write-export-service helpers', () => {
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'ds-gui-write-export-'))
    vi.mocked(clipboard.write).mockReset()
    vi.mocked(clipboard.writeImage).mockReset()
    vi.mocked(nativeImage.createFromPath).mockReset()
    vi.mocked(nativeImage.createFromBuffer).mockReset()
    vi.mocked(nativeImage.createFromPath).mockReturnValue({ isEmpty: () => false } as never)
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue({ isEmpty: () => false } as never)
    vi.mocked(dialog.showSaveDialog).mockReset()
  })

  it('builds export file names with the requested extension', () => {
    expect(buildWriteExportFileName('/tmp/draft.md', 'html')).toBe('draft.html')
    expect(buildWriteExportFileName('/tmp/draft.md', 'pdf')).toBe('draft.pdf')
    expect(buildWriteExportFileName('/tmp/draft.md', 'png')).toBe('draft.png')
    expect(buildWriteExportFileName('/tmp/draft.md', 'doc')).toBe('draft.doc')
    expect(buildWriteExportFileName('/tmp/draft.md', 'docx')).toBe('draft.docx')
  })

  it('renders markdown exports with resolved links and inlined local images', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: '# Heading\n\n![Cover](./cover.png)\n\n[Notes](./notes.md)'
    })

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain(`href="${pathToFileURL(join(workspaceRoot, 'notes.md')).href}"`)
  })

  it('renders clipboard html fragments for markdown content', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteClipboardHtmlFragment({
      sourcePath,
      content: '# Heading\n\n**Bold**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Notes](./notes.md)'
    })

    expect(html).toContain('<article class="markdown-body">')
    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain(`href="${pathToFileURL(join(workspaceRoot, 'notes.md')).href}"`)
  })

  it('renders clipboard math as pure MathML (no KaTeX spans without CSS)', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteClipboardHtmlFragment({
      sourcePath,
      content: 'inline $x^2$ math\n'
    })

    expect(html).toContain('<math')
    expect(html).not.toContain('katex-html')
  })

  it('renders export-document math with KaTeX fallback and bundled CSS', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      title: 'Draft',
      content: 'inline $x^2$ math\n'
    })

    // htmlAndMathml keeps MathML for capable viewers plus the KaTeX HTML
    // span fallback for Linux exports without system math fonts.
    expect(html).toContain('<math')
    expect(html).toContain('katex-html')
    expect(html).toContain('.katex')
    expect(html).toContain('fonts/KaTeX')
  })

  it('renders clipboard html fragments for plain text content', async () => {
    const sourcePath = join(workspaceRoot, 'draft.txt')
    const html = await buildWriteClipboardHtmlFragment({
      sourcePath,
      content: 'plain text\nline two'
    })

    expect(html).toContain('<article class="markdown-body">')
    expect(html).toContain('<pre class="plain-text">plain text\nline two</pre>')
  })

  it('writes html and plain text to the clipboard', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(sourcePath, '# Heading\n\n![Cover](./cover.png)')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await copyWriteDocumentAsRichText({
      path: sourcePath,
      workspaceRoot,
      content: '# Heading\n\n![Cover](./cover.png)'
    })

    expect(result.ok).toBe(true)
    expect(clipboard.write).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('<article class="markdown-body">'),
        text: '# Heading\n\n![Cover](./cover.png)'
      })
    )
    expect(clipboard.write).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('src="data:image/png;base64,')
      })
    )
  })

  it('exports markdown documents as docx files', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const targetPath = join(workspaceRoot, 'draft.docx')
    await writeFile(sourcePath, '# Heading\n\n**Bold** text\n\n- item', 'utf8')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: targetPath
    })

    const result = await exportWriteDocument({
      path: sourcePath,
      workspaceRoot,
      format: 'docx',
      content: '# Heading\n\n**Bold** text\n\n- item'
    })

    expect(result).toMatchObject({
      ok: true,
      path: targetPath,
      format: 'docx'
    })
    const bytes = await readFile(targetPath)
    expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('exports content without requiring a source file', async () => {
    const targetPath = join(workspaceRoot, 'Kun-answer.html')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: targetPath
    })

    const result = await exportWriteDocument({
      title: 'Kun answer',
      workspaceRoot,
      format: 'html',
      content: '# Answer\n\nShareable content'
    })

    expect(result).toMatchObject({
      ok: true,
      path: targetPath,
      format: 'html'
    })
    expect(await readFile(targetPath, 'utf8')).toContain('<h1>Answer</h1>')
  })

  it('copies x-articles clipboard html without tables, code, or gif images', async () => {
    const sourcePath = join(workspaceRoot, 'draft.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(sourcePath, '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n![Cover](./cover.png)\n\n![Loop](./loop.gif)')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await copyWriteDocumentAsRichText({
      path: sourcePath,
      workspaceRoot,
      content: '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n![Cover](./cover.png)\n\n![Loop](./loop.gif)',
      profile: 'x-articles'
    })

    expect(result).toMatchObject({
      ok: true,
      profile: 'x-articles',
      simplified: true,
      overLimit: false
    })
    expect(clipboard.write).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('<!--StartFragment-->'),
        text: expect.stringContaining('A  B')
      })
    )
    const written = vi.mocked(clipboard.write).mock.calls[0]?.[0] as { html: string; text: string }
    expect(written.html).not.toContain('<article')
    expect(written.html).not.toContain('<table>')
    expect(written.html).not.toContain('<pre>')
    expect(written.html).not.toContain('<code>')
    expect(written.html).not.toContain('<strong>')
    expect(written.html).toContain('<b>A</b>')
    expect(written.html).toContain('<p>图片 1</p>')
    expect(written.html).not.toContain('src="data:image/png;base64,')
    expect(written.html).not.toContain('file://')
    expect(written.html).not.toMatch(/<img\b[^>]*loop\.gif/i)
    expect(written.html).toContain('📷 Loop')
    expect(written.text).not.toContain('**')
    expect(result).toMatchObject({ title: 'Heading', imageCount: 1 })
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })

  it('copies x-articles-image with writeImage and no html mix-in', async () => {
    const sourcePath = join(workspaceRoot, 'photos.md')
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(sourcePath, '# Heading\n\n![Cover](./cover.png)', 'utf8')
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await copyWriteDocumentAsRichText({
      path: sourcePath,
      workspaceRoot,
      content: '# Heading\n\n![Cover](./cover.png)',
      profile: 'x-articles-image',
      imageIndex: 0
    })

    expect(result).toMatchObject({
      ok: true,
      profile: 'x-articles-image',
      imageIndex: 0,
      imageCount: 1
    })
    expect(nativeImage.createFromPath).toHaveBeenCalledWith(expect.stringMatching(/cover\.png$/))
    expect(clipboard.writeImage).toHaveBeenCalledOnce()
    expect(clipboard.write).not.toHaveBeenCalled()
  })

  it('fails x-articles-image when there is no local image', async () => {
    const sourcePath = join(workspaceRoot, 'plain.md')
    await writeFile(sourcePath, '# Heading\n\nNo pictures', 'utf8')

    const result = await copyWriteDocumentAsRichText({
      path: sourcePath,
      workspaceRoot,
      content: '# Heading\n\nNo pictures',
      profile: 'x-articles-image',
      imageIndex: 0
    })

    expect(result).toEqual({
      ok: false,
      message: X_ARTICLE_IMAGE_MISSING
    })
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })
})
