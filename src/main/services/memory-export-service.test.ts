import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { exportMemoryMarkdown } from './memory-export-service'

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn()
  }
}))

describe('exportMemoryMarkdown', () => {
  let tempDir = ''

  beforeEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = mkdtempSync(join(tmpdir(), 'kun-memory-export-'))
    vi.mocked(dialog.showSaveDialog).mockReset()
  })

  it('writes markdown to the selected path and appends the md extension', async () => {
    const target = join(tempDir, 'memory-export')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: target
    })

    const result = await exportMemoryMarkdown({
      markdown: '# Memory\n',
      defaultFileName: 'profile.md'
    })

    expect(result).toMatchObject({ ok: true, path: `${target}.md` })
    await expect(readFile(`${target}.md`, 'utf8')).resolves.toBe('# Memory\n')
  })

  it('returns a canceled result when the user closes the save dialog', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: ''
    })

    await expect(exportMemoryMarkdown({
      markdown: '# Memory\n',
      defaultFileName: 'profile.md'
    })).resolves.toEqual({ ok: false, canceled: true })
  })
})

describe('project-only export boundary', () => {
  it('rejects a mismatched project before opening a destination dialog', async () => {
    const markdown = '```kun-project-knowledge\n' + JSON.stringify({ format: 'kun-project-knowledge', version: 1,
      project: '/other', records: [{ id: 'p1', content: 'Project fact', type: 'fact', authority: 'reference', tags: [] }] }) + '\n```'
    vi.mocked(dialog.showSaveDialog).mockClear()
    const result = await exportMemoryMarkdown({ markdown, projectKnowledge: { project: '/approved', approvedIds: ['p1'] } })
    expect(result).toMatchObject({ ok: false, canceled: false })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
