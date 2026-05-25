import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn()
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  writeWorkspaceFile
} from './workspace-service'

describe('workspace-service boundary checks', () => {
  let rootDir = ''
  let workspaceRoot = ''
  let outsideFile = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ds-gui-workspace-'))
    workspaceRoot = join(rootDir, 'workspace')
    outsideFile = join(rootDir, 'outside.txt')
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(join(workspaceRoot, 'inside.txt'), 'inside', 'utf8')
    await writeFile(outsideFile, 'outside', 'utf8')
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
})
