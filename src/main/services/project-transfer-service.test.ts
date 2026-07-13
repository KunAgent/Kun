import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
  dialog: { showOpenDialog: vi.fn() }
}))

import {
  exportProjectDirectory,
  importProjectDirectory
} from './project-transfer-service'

type DialogResult = { canceled: boolean; filePaths: string[] }

function chooseDirectories(...paths: string[]) {
  let index = 0
  return vi.fn(async (): Promise<DialogResult> => ({
    canceled: false,
    filePaths: [paths[index++] ?? paths.at(-1) ?? '']
  }))
}

describe('project transfer', () => {
  it('exports a project atomically and excludes managed worktrees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-project-transfer-'))
    const source = join(root, 'source')
    const destinationParent = join(root, 'destination')
    await mkdir(join(source, '.kun', 'worktrees', 'pool-0'), { recursive: true })
    await mkdir(destinationParent, { recursive: true })
    await writeFile(join(source, 'README.md'), 'hello', 'utf8')
    await writeFile(join(source, '.kun', 'worktrees', 'pool-0', 'ignored.txt'), 'ignored', 'utf8')

    const result = await exportProjectDirectory({
      sourceRoot: source,
      chooseDirectory: chooseDirectories(destinationParent)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await readFile(join(result.path, 'README.md'), 'utf8')).toBe('hello')
    await expect(stat(join(result.path, '.kun', 'worktrees'))).rejects.toThrow()
    expect(result.copiedFiles).toBe(1)
    expect(result.skippedPaths).toContain('.kun/worktrees')
  })

  it('imports into a new sibling directory and never copies into the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-project-transfer-'))
    const source = join(root, 'source')
    const destinationParent = join(root, 'destination')
    await mkdir(source, { recursive: true })
    await mkdir(destinationParent, { recursive: true })
    await writeFile(join(source, 'notes.txt'), 'portable', 'utf8')

    const result = await importProjectDirectory({
      chooseDirectory: chooseDirectories(source, destinationParent)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await readFile(join(result.path, 'notes.txt'), 'utf8')).toBe('portable')
    expect(result.path).not.toBe(source)
  })

  it('rejects a destination nested under the source project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-project-transfer-'))
    const source = join(root, 'source')
    const nested = join(source, 'nested')
    await mkdir(nested, { recursive: true })
    await writeFile(join(source, 'notes.txt'), 'do not recurse', 'utf8')

    const result = await exportProjectDirectory({
      sourceRoot: source,
      chooseDirectory: chooseDirectories(nested)
    })

    expect(result).toEqual({
      ok: false,
      message: 'Choose a destination outside the source project.'
    })
  })
})
