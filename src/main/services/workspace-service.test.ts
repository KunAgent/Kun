import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn()
  },
  clipboard: {
    readImage: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import { clipboard, dialog } from 'electron'

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  readWorkspacePdf,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  pickAndSaveWorkspaceImage,
  saveWorkspaceClipboardImage,
  saveWorkspaceImageBytes,
  writeWorkspaceFile
} from './workspace-service'

describe('workspace-service boundary checks', () => {
  let rootDir = ''
  let workspaceRoot = ''
  let outsideFile = ''

  beforeEach(async () => {
    vi.mocked(clipboard.readImage).mockReset()
    vi.mocked(dialog.showOpenDialog).mockReset()
    rootDir = await mkdtemp(join(tmpdir(), 'ds-gui-workspace-'))
    workspaceRoot = join(rootDir, 'workspace')
    outsideFile = join(rootDir, 'outside.txt')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'inside.txt'), 'inside', 'utf8')
    await writeFile(outsideFile, 'outside', 'utf8')
    await rm(join(tmpdir(), 'kun'), { recursive: true, force: true })
  })

  it('allows files inside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe(await realpath(join(workspaceRoot, 'inside.txt')))
    }
  })

  it('does not resolve a presentation-looking directory as a file', async () => {
    await mkdir(join(workspaceRoot, 'not-a-deck.pptx'))

    const result = await resolveWorkspaceFile({
      path: 'not-a-deck.pptx',
      workspaceRoot
    })

    expect(result).toEqual({
      ok: false,
      message: 'Path must point to a regular workspace file.'
    })
  })

  it('returns a presentation symlink canonical target for main-process type policy checks', async () => {
    if (process.platform === 'win32') return
    const payloadPath = join(workspaceRoot, 'payload.exe')
    await writeFile(payloadPath, 'payload', 'utf8')
    await symlink('payload.exe', join(workspaceRoot, 'deck.pptx'))

    const result = await resolveWorkspaceFile({
      path: 'deck.pptx',
      workspaceRoot
    })

    expect(result).toEqual({ ok: true, path: await realpath(payloadPath) })
  })

  it('rejects relative paths that escape the selected workspace', async () => {
    const result = await readWorkspaceFile({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('rejects absolute paths outside the selected workspace', async () => {
    const result = await resolveWorkspaceFile({
      path: outsideFile,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('lists directories and files inside the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'draft.md'), '# draft', 'utf8')
    const result = await listWorkspaceDirectory({ workspaceRoot, path: workspaceRoot })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries.map((entry) => entry.name)).toEqual(['notes', 'inside.txt'])
      expect(result.entries[0].type).toBe('directory')
      expect(result.entries[0].mtimeMs).toBeTypeOf('number')
      expect(result.entries[1]).toMatchObject({
        type: 'file',
        size: 6
      })
      expect(result.entries[1].mtimeMs).toBeTypeOf('number')
    }
  })

  it('creates and saves files within the selected workspace', async () => {
    const createResult = await createWorkspaceFile({
      path: 'notes/new.md',
      workspaceRoot,
      content: '# first draft'
    })

    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const saveResult = await writeWorkspaceFile({
      path: createResult.path,
      workspaceRoot,
      content: '# revised draft'
    })
    expect(saveResult.ok).toBe(true)

    const readResult = await readWorkspaceFile({
      path: createResult.path,
      workspaceRoot
    })
    expect(readResult.ok).toBe(true)
    if (readResult.ok) {
      expect(readResult.content).toBe('# revised draft')
    }
  })

  it('marks oversized files as truncated when loading preview content', async () => {
    const largePath = join(workspaceRoot, 'large.md')
    await writeFile(largePath, 'a'.repeat(1_500_001), 'utf8')

    const result = await readWorkspaceFile({
      path: largePath,
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.truncated).toBe(true)
    expect(result.size).toBe(1_500_001)
    expect(result.content.length).toBeLessThan(result.size)
  })

  it('creates directories inside the selected workspace', async () => {
    const result = await createWorkspaceDirectory({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const listResult = await listWorkspaceDirectory({ workspaceRoot })
    expect(listResult.ok).toBe(true)
    if (listResult.ok) {
      expect(listResult.entries.some((entry) => entry.name === 'notes' && entry.type === 'directory')).toBe(true)
    }
  })

  it('saves pasted clipboard images into the workspace img directory and returns a markdown path', async () => {
    const currentFilePath = join(workspaceRoot, 'notes', 'draft.md')
    await mkdir(join(workspaceRoot, 'notes'), { recursive: true })
    await writeFile(currentFilePath, '# draft', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('fake-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, 'img')))
    expect(result.markdownPath.startsWith('../img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('fake-png-bytes'))
  })

  it('reads clipboard images as PNG base64 and saves a temp file', async () => {
    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('clipboard-png-bytes'),
      getSize: () => ({ width: 12, height: 8 })
    } as Electron.NativeImage)

    const result = await readClipboardImage()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toMatch(/^pasted-image-.+\.png$/)
    expect(dirname(result.localFilePath)).toBe(join(tmpdir(), 'kun'))
    expect(basename(result.localFilePath)).toMatch(/^\d+\.png$/)
    expect(result.mimeType).toBe('image/png')
    expect(result.dataBase64).toBe(Buffer.from('clipboard-png-bytes').toString('base64'))
    expect(result.byteSize).toBe(Buffer.byteLength('clipboard-png-bytes'))
    expect(result.width).toBe(12)
    expect(result.height).toBe(8)
    await expect(readFile(result.localFilePath)).resolves.toEqual(Buffer.from('clipboard-png-bytes'))
  })

  it('saves SDD pasted clipboard images into .kunsdd/img with draft-relative markdown', async () => {
    const currentFilePath = join(workspaceRoot, '.kunsdd', 'draft', 'draft-1', 'requirement.md')
    await mkdir(join(workspaceRoot, '.kunsdd', 'draft', 'draft-1'), { recursive: true })
    await writeFile(currentFilePath, '# requirement', 'utf8')

    vi.mocked(clipboard.readImage).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('sdd-png-bytes')
    } as Electron.NativeImage)

    const result = await saveWorkspaceClipboardImage({
      workspaceRoot,
      currentFilePath,
      imageDirectory: '.kunsdd/img'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await realpath(dirname(result.path))).toBe(await realpath(join(workspaceRoot, '.kunsdd', 'img')))
    expect(result.markdownPath.startsWith('../../img/pasted-image-')).toBe(true)
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from('sdd-png-bytes'))
  })

  it('reads supported workspace images as data URLs', async () => {
    const imagePath = join(workspaceRoot, 'img', 'sample.png')
    await mkdir(join(workspaceRoot, 'img'), { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await readWorkspaceImage({
      path: 'img/sample.png',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.path).toBe(await realpath(imagePath))
    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toBe('data:image/png;base64,iVBORw==')
  })

  it('saves renderer image bytes under an exact safe workspace filename', async () => {
    const bytes = Buffer.from('whiteboard-png')
    const result = await saveWorkspaceImageBytes({
      workspaceRoot,
      imageDirectory: '.deepseekgui-images',
      fileName: 'architecture-a1b2c3.png',
      mimeType: 'image/png',
      dataBase64: bytes.toString('base64')
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workspaceRelativePath).toBe('.deepseekgui-images/architecture-a1b2c3.png')
    await expect(readFile(result.path)).resolves.toEqual(bytes)
  })

  it('rejects unsafe exact filenames for renderer image bytes', async () => {
    const result = await saveWorkspaceImageBytes({
      workspaceRoot,
      fileName: '../escaped.png',
      dataBase64: Buffer.from('not-written').toString('base64')
    })

    expect(result).toEqual({
      ok: false,
      message: 'Image fileName must be a safe PNG or SVG basename.'
    })
    await expect(readFile(join(rootDir, 'escaped.png'))).rejects.toThrow()
  })

  it('saves exact SVG image bytes and rejects mismatched MIME metadata', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
    const result = await saveWorkspaceImageBytes({
      workspaceRoot,
      fileName: 'architecture.svg',
      mimeType: 'image/svg+xml',
      dataBase64: svg.toString('base64')
    })

    expect(result.ok).toBe(true)
    if (result.ok) await expect(readFile(result.path)).resolves.toEqual(svg)
    await expect(saveWorkspaceImageBytes({
      workspaceRoot,
      fileName: 'architecture.svg',
      mimeType: 'image/png',
      dataBase64: svg.toString('base64')
    })).resolves.toEqual({
      ok: false,
      message: 'Image mimeType must match the .svg file extension.'
    })
  })

  it('picks workspace images with both html-relative and workspace-relative paths', async () => {
    const sourceImage = join(rootDir, 'source.png')
    const currentFilePath = join(workspaceRoot, '.kun-design', 'screen-a', 'v1.html')
    await mkdir(dirname(currentFilePath), { recursive: true })
    await writeFile(currentFilePath, '<!doctype html>', 'utf8')
    await writeFile(
      sourceImage,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0x01, 0xe0
      ])
    )
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [sourceImage]
    })

    const result = await pickAndSaveWorkspaceImage({
      workspaceRoot,
      currentFilePath,
      imageDirectory: 'img'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workspaceRelativePath).toMatch(/^img\/image-.+\.png$/)
    expect(result.relativePath).toMatch(/^..\/..\/img\/image-.+\.png$/)
    expect(result.width).toBe(640)
    expect(result.height).toBe(480)
  })

  it('picks workspace images without a current file path for canvas use', async () => {
    const sourceImage = join(rootDir, 'source.gif')
    await writeFile(
      sourceImage,
      Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
        0x40, 0x01, 0xf0, 0x00
      ])
    )
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [sourceImage]
    })

    const result = await pickAndSaveWorkspaceImage({
      workspaceRoot,
      imageDirectory: 'img'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workspaceRelativePath).toMatch(/^img\/image-.+\.gif$/)
    expect(result.relativePath).toBe(result.workspaceRelativePath)
    expect(result.width).toBe(320)
    expect(result.height).toBe(240)
  })

  it('reads supported workspace PDFs as base64 metadata without exposing raw paths', async () => {
    const pdfPath = join(workspaceRoot, 'papers', 'study.pdf')
    const pdfBytes = Buffer.from('%PDF-1.4\n%%EOF')
    await mkdir(join(workspaceRoot, 'papers'), { recursive: true })
    await writeFile(pdfPath, pdfBytes)

    const result = await readWorkspacePdf({
      path: 'papers/study.pdf',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.path).toBe(await realpath(pdfPath))
    expect(result.mimeType).toBe('application/pdf')
    expect(result.dataBase64).toBe(pdfBytes.toString('base64'))
    expect(result.size).toBe(pdfBytes.length)
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('rejects non-PDF files from the PDF reader', async () => {
    const result = await readWorkspacePdf({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('not a PDF')
    }
  })

  it('renames files within the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'renamed.txt'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await readFile(join(workspaceRoot, 'renamed.txt'), 'utf8')).toBe('inside')
  })

  it('rejects rename names that escape the selected workspace', async () => {
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: '../outside.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('path separators')
    }
  })

  it('rejects rename conflicts', async () => {
    await writeFile(join(workspaceRoot, 'existing.txt'), 'existing', 'utf8')
    const result = await renameWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot,
      newName: 'existing.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('already exists')
    }
  })

  it('deletes files within the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: 'inside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    const readResult = await readWorkspaceFile({ path: 'inside.txt', workspaceRoot })
    expect(readResult.ok).toBe(false)
  })

  it('deletes directories within the selected workspace', async () => {
    await mkdir(join(workspaceRoot, 'notes', 'nested'), { recursive: true })
    await writeFile(join(workspaceRoot, 'notes', 'nested', 'draft.md'), '# draft', 'utf8')

    const result = await deleteWorkspaceEntry({
      path: 'notes',
      workspaceRoot
    })

    expect(result.ok).toBe(true)
    await expect(readdir(join(workspaceRoot, 'notes'))).rejects.toThrow()
  })

  it('rejects deleting the workspace root', async () => {
    const result = await deleteWorkspaceEntry({
      path: workspaceRoot,
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('workspace root')
    }
  })

  it('rejects delete paths that escape the selected workspace', async () => {
    const result = await deleteWorkspaceEntry({
      path: '../outside.txt',
      workspaceRoot
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('within the selected workspace')
    }
  })

  it('rejects write/create/rename/delete through a parent symlink outside the workspace', async () => {
    if (process.platform === 'win32') return
    const outsideDir = join(rootDir, 'outside-dir')
    await mkdir(outsideDir)
    await writeFile(join(outsideDir, 'victim.txt'), 'outside', 'utf8')
    await symlink(outsideDir, join(workspaceRoot, 'linked-outside'), 'dir')

    const createResult = await createWorkspaceFile({
      path: 'linked-outside/new.txt', workspaceRoot, content: 'escaped'
    })
    const writeResult = await writeWorkspaceFile({
      path: 'linked-outside/victim.txt', workspaceRoot, content: 'overwritten'
    })
    const renameResult = await renameWorkspaceEntry({
      path: 'linked-outside/victim.txt', workspaceRoot, newName: 'renamed.txt'
    })
    const deleteResult = await deleteWorkspaceEntry({
      path: 'linked-outside/victim.txt', workspaceRoot
    })

    expect(createResult.ok).toBe(false)
    expect(writeResult.ok).toBe(false)
    expect(renameResult.ok).toBe(false)
    expect(deleteResult.ok).toBe(false)
    expect(await readFile(join(outsideDir, 'victim.txt'), 'utf8')).toBe('outside')
    await expect(readFile(join(outsideDir, 'new.txt'), 'utf8')).rejects.toThrow()
  })
})
