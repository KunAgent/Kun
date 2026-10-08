import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/downloads')
  },
  BrowserWindow: class BrowserWindow {},
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn()
  }
}))

vi.mock('./write-export-service', () => ({
  renderMarkdownDocumentToPdf: vi.fn()
}))

import { dialog } from 'electron'
import { renderMarkdownDocumentToPdf } from './write-export-service'
import {
  ensureConversationExportExtension,
  exportConversation,
  exportConversationBatch,
  sanitizeConversationExportFileName
} from './conversation-export-service'

describe('conversation-export-service', () => {
  let tempDir = ''

  beforeEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = await mkdtemp(join(tmpdir(), 'kun-conversation-export-'))
    vi.mocked(dialog.showSaveDialog).mockReset()
    vi.mocked(renderMarkdownDocumentToPdf).mockReset()
  })

  it('writes canonical Markdown and forces the md extension', async () => {
    const selectedPath = join(tempDir, 'thread.txt')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: selectedPath
    })

    const result = await exportConversation({
      title: 'Thread',
      format: 'md',
      markdown: '# Thread\n',
      defaultFileName: 'Thread-2026-07-19'
    }, { downloadsPath: tempDir })

    const targetPath = join(tempDir, 'thread.md')
    expect(result).toMatchObject({ ok: true, path: targetPath, format: 'md' })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('# Thread\n')
  })

  it('renders the same canonical Markdown to PDF', async () => {
    const selectedPath = join(tempDir, 'thread')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: selectedPath
    })
    vi.mocked(renderMarkdownDocumentToPdf).mockResolvedValue(Buffer.from('%PDF-test'))

    const result = await exportConversation({
      title: 'Thread',
      format: 'pdf',
      markdown: '# Thread\n\n## You\n\nHello\n',
      defaultFileName: 'Thread-2026-07-19'
    }, { downloadsPath: tempDir })

    const targetPath = `${selectedPath}.pdf`
    expect(result).toMatchObject({ ok: true, path: targetPath, format: 'pdf' })
    expect(renderMarkdownDocumentToPdf).toHaveBeenCalledWith({
      sourcePath: join(tempDir, 'Thread-2026-07-19.md'),
      content: '# Thread\n\n## You\n\nHello\n',
      title: 'Thread'
    })
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('%PDF-test')
  })

  it('returns cancellation without writing a file', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: ''
    })

    await expect(exportConversation({
      title: 'Thread',
      format: 'md',
      markdown: '# Thread\n',
      defaultFileName: 'Thread-2026-07-19'
    }, { downloadsPath: tempDir })).resolves.toEqual({ ok: false, canceled: true })
  })

  it('sanitizes suggested names and reports write failures', async () => {
    expect(sanitizeConversationExportFileName(' Bad:/Name?.md ')).toBe('Bad--Name-')
    expect(ensureConversationExportExtension('/tmp/thread.txt', 'pdf')).toBe('/tmp/thread.pdf')

    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: join(tempDir, 'missing', 'thread.md')
    })
    const result = await exportConversation({
      title: 'Thread',
      format: 'md',
      markdown: '# Thread\n',
      defaultFileName: 'Bad:/Name?.md'
    }, { downloadsPath: tempDir })

    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: join(tempDir, 'Bad--Name-.md')
    }))
    expect(result).toMatchObject({ ok: false, canceled: false })
  })
  it('writes one file per conversation into a new dated folder with unique names', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [tempDir] })

    const result = await exportConversationBatch({
      format: 'md',
      folderName: 'Kun export 2026-10-08',
      items: [
        { title: 'A', markdown: '# A\n', defaultFileName: 'Same' },
        { title: 'B', markdown: '# B\n', defaultFileName: 'same' }
      ]
    }, { downloadsPath: tempDir })

    const directory = join(tempDir, 'Kun export 2026-10-08')
    expect(result).toMatchObject({ ok: true, directory, written: 2, failed: [] })
    expect((await readdir(directory)).sort()).toEqual(['Same.md', 'same (2).md'])
    await expect(readFile(join(directory, 'same (2).md'), 'utf8')).resolves.toBe('# B\n')
  })

  it('keeps an existing export folder and reports per-item PDF failures', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [tempDir] })
    vi.mocked(renderMarkdownDocumentToPdf)
      .mockResolvedValueOnce(Buffer.from('pdf'))
      .mockResolvedValueOnce(Buffer.from('pdf'))
      .mockRejectedValueOnce(new Error('render failed'))
    const payload = {
      format: 'pdf' as const,
      folderName: 'out',
      items: [
        { title: 'A', markdown: '# A\n', defaultFileName: 'A' },
        { title: 'B', markdown: '# B\n', defaultFileName: 'B' }
      ]
    }

    await exportConversationBatch({ ...payload, items: [payload.items[0]!] }, { downloadsPath: tempDir })
    const result = await exportConversationBatch(payload, { downloadsPath: tempDir })

    expect(result).toMatchObject({
      ok: true,
      directory: join(tempDir, 'out (2)'),
      written: 1,
      failed: [{ title: 'B', message: 'render failed' }]
    })
  })

  it('reports a canceled folder picker without writing', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
    const result = await exportConversationBatch({
      format: 'md',
      folderName: 'out',
      items: [{ title: 'A', markdown: '# A\n', defaultFileName: 'A' }]
    }, { downloadsPath: tempDir })
    expect(result).toEqual({ ok: false, canceled: true })
    expect(await readdir(tempDir)).toEqual([])
  })
})
