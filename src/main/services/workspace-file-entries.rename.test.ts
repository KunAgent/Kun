import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkspaceRenameFileSystem, type RenameTestFileSystem } from './workspace-rename-fs-test-support'

const fsMock = vi.hoisted(() => ({
  driver: undefined as RenameTestFileSystem | undefined,
  rename: vi.fn()
}))
vi.mock('electron', () => ({ BrowserWindow: class {}, clipboard: {}, dialog: {} }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    access: (path: string) => fsMock.driver!.access(path),
    realpath: (path: string) => fsMock.driver!.realpath(path),
    stat: (path: string) => fsMock.driver!.stat(path),
    lstat: (path: string) => fsMock.driver!.lstat(path),
    readdir: (path: string) => fsMock.driver!.readdir(path),
    rename: fsMock.rename
  }
})
import { renameWorkspaceEntry } from './workspace-file-entries'

const nativeFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const ROOT = resolve('/workspace')
const OUTSIDE = resolve('/outside')
let fixture: WorkspaceRenameFileSystem
const temporaryDirectories: string[] = []
function install(caseInsensitive = true): void {
  fixture = new WorkspaceRenameFileSystem(caseInsensitive)
  fixture.directory(ROOT)
  fixture.directory(OUTSIDE)
  fsMock.driver = fixture
  fsMock.rename.mockReset().mockImplementation((source: string, target: string) => fsMock.driver!.rename(source, target))
}
beforeEach(() => install())
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => nativeFs.rm(path, { recursive: true, force: true })))
})

describe('workspace entry rename on case-preserving, case-insensitive filesystems', () => {
  it.each(['file', 'directory'] as const)('performs a case-only %s rename and returns the requested spelling', async (kind) => {
    const source = join(ROOT, kind === 'file' ? 'notes.md' : 'notes')
    const name = kind === 'file' ? 'Notes.md' : 'Notes'
    if (kind === 'file') fixture.file(source, 'latest draft')
    else {
      fixture.directory(source)
      fixture.file(join(source, 'child.md'), 'latest draft')
    }
    // This is the old bug's precondition: canonicalizing the target erases its requested case.
    expect(await fixture.realpath(join(ROOT, name))).toBe(source)
    const result = await renameWorkspaceEntry({ workspaceRoot: ROOT, path: source, newName: name })
    expect(result).toMatchObject({ ok: true, previousPath: source, path: join(ROOT, name) })
    expect(fsMock.rename).toHaveBeenCalledExactlyOnceWith(source, join(ROOT, name))
    expect(await fixture.readdir(ROOT)).toEqual([name])
    expect(fixture.content(kind === 'file' ? join(ROOT, name) : join(ROOT, name, 'child.md'))).toBe('latest draft')
    expect(fixture.entries.has(source)).toBe(false)
  })

  it('uses the stored source spelling even when the input source is another case alias', async () => {
    fixture.file(join(ROOT, 'notes.md'))
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'NOTES.md', newName: 'Notes.md' }))
      .toMatchObject({ ok: true, previousPath: join(ROOT, 'notes.md'), path: join(ROOT, 'Notes.md') })
    expect(fsMock.rename).toHaveBeenCalledExactlyOnceWith(join(ROOT, 'notes.md'), join(ROOT, 'Notes.md'))
  })

  it.each(['file', 'directory'] as const)('keeps an identical %s spelling a no-op', async (kind) => {
    const source = join(ROOT, 'notes')
    if (kind === 'file') fixture.file(source)
    else fixture.directory(source)
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: source, newName: 'notes' }))
      .toMatchObject({ ok: true, previousPath: source, path: source })
    expect(fsMock.rename).not.toHaveBeenCalled()
  })

  it.each(['file', 'directory'] as const)('rejects an occupied %s target without overwriting it', async (kind) => {
    fixture.file(join(ROOT, 'notes.md'), 'draft')
    if (kind === 'file') fixture.file(join(ROOT, 'other'), 'keep me')
    else {
      fixture.directory(join(ROOT, 'other'))
      fixture.file(join(ROOT, 'other/child.md'), 'keep me')
    }
    const before = [...fixture.entries]
    const result = await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'notes.md', newName: 'OTHER' })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('already exists') })
    expect(fsMock.rename).not.toHaveBeenCalled()
    expect([...fixture.entries]).toEqual(before)
  })

  it.each(['source', 'missing'] as const)('refuses a target symlink to %s instead of following or replacing it', async (target) => {
    fixture.file(join(ROOT, 'notes.md'), 'draft')
    fixture.symlink(join(ROOT, 'alias.md'), target === 'source' ? join(ROOT, 'notes.md') : join(ROOT, 'missing.md'))
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'notes.md', newName: 'alias.md' }))
      .toMatchObject({ ok: false })
    expect(fsMock.rename).not.toHaveBeenCalled()
    expect((await fixture.lstat(join(ROOT, 'alias.md'))).isSymbolicLink()).toBe(true)
  })

  it('keeps a symlink parent escape outside the sandbox rejected', async () => {
    fixture.file(join(OUTSIDE, 'notes.md'), 'private')
    fixture.symlink(join(ROOT, 'linked'), OUTSIDE)
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'linked/notes.md', newName: 'Notes.md' }))
      .toMatchObject({ ok: false, message: expect.stringContaining('within the selected workspace') })
    expect(fsMock.rename).not.toHaveBeenCalled()
    expect(fixture.content(join(OUTSIDE, 'notes.md'))).toBe('private')
  })

  it('reports native rename failure without moving or staging the original', async () => {
    fixture.file(join(ROOT, 'notes.md'), 'keep me')
    const before = [...fixture.entries]
    fixture.failRename = true
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'notes.md', newName: 'Notes.md' }))
      .toMatchObject({ ok: false, message: 'Rename denied' })
    expect(fsMock.rename).toHaveBeenCalledOnce()
    expect([...fixture.entries]).toEqual(before)
  })
})

describe('workspace entry rename on case-sensitive filesystems', () => {
  beforeEach(() => install(false))
  it('renames a missing differently-cased target normally', async () => {
    fixture.file(join(ROOT, 'notes.md'), 'draft')
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'notes.md', newName: 'Notes.md' }))
      .toMatchObject({ ok: true, path: join(ROOT, 'Notes.md') })
    expect(fsMock.rename).toHaveBeenCalledExactlyOnceWith(join(ROOT, 'notes.md'), join(ROOT, 'Notes.md'))
    expect(fixture.entries.has(join(ROOT, 'notes.md'))).toBe(false)
    expect(fixture.content(join(ROOT, 'Notes.md'))).toBe('draft')
  })
  it.each([false, true])('rejects a distinct case-variant entry even with matching inode (hardlink=%s)', async (hardlink) => {
    fixture.file(join(ROOT, 'notes.md'), 'source')
    if (hardlink) fixture.hardlink(join(ROOT, 'Notes.md'), join(ROOT, 'notes.md'))
    else fixture.file(join(ROOT, 'Notes.md'), 'other')
    const before = [...fixture.entries]
    expect(await renameWorkspaceEntry({ workspaceRoot: ROOT, path: 'notes.md', newName: 'Notes.md' }))
      .toMatchObject({ ok: false, message: expect.stringContaining('already exists') })
    expect(fsMock.rename).not.toHaveBeenCalled()
    expect([...fixture.entries]).toEqual(before)
  })
})

describe('workspace entry native filesystem rename', () => {
  async function nativeWorkspace(): Promise<string> {
    const root = await nativeFs.realpath(await nativeFs.mkdtemp(join(tmpdir(), 'kun-entry-rename-')))
    temporaryDirectories.push(root)
    fsMock.driver = {
      access: (path) => nativeFs.access(path), realpath: (path) => nativeFs.realpath(path),
      stat: (path) => nativeFs.stat(path), lstat: (path) => nativeFs.lstat(path),
      readdir: (path) => nativeFs.readdir(path), rename: (source, target) => nativeFs.rename(source, target)
    }
    return root
  }
  it.each(['file', 'directory'] as const)('changes the actual %s entry spelling and preserves content', async (kind) => {
    const root = await nativeWorkspace()
    const source = join(root, 'notes')
    if (kind === 'file') await nativeFs.writeFile(source, 'draft')
    else {
      await nativeFs.mkdir(source)
      await nativeFs.writeFile(join(source, 'child.md'), 'draft')
    }
    expect(await renameWorkspaceEntry({ workspaceRoot: root, path: source, newName: 'Notes' }))
      .toMatchObject({ ok: true, previousPath: source, path: join(root, 'Notes') })
    expect(fsMock.rename).toHaveBeenCalledExactlyOnceWith(source, join(root, 'Notes'))
    expect(await nativeFs.readdir(root)).toEqual(['Notes'])
    expect(await nativeFs.readFile(kind === 'file' ? join(root, 'Notes') : join(root, 'Notes/child.md'), 'utf8')).toBe('draft')
  })
})
