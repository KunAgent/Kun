import { posix, win32 } from 'node:path'
import type { Stats } from 'node:fs'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Substitute path syntax, not the guards: these tests execute the production
// modules with Windows paths even when the test host uses a POSIX filesystem.
describe.each([
  { name: 'POSIX', paths: posix, root: '/workspace/project' },
  { name: 'Windows drive', paths: win32, root: 'C:\\workspace\\project' },
  { name: 'Windows UNC', paths: win32, root: '\\\\server\\share\\project' }
])('remote file containment: $name', ({ paths, root }) => {
  afterEach(() => {
    for (const module of ['node:path', 'node:fs/promises', '../code/access.js', '../agents/library/access.js', './project-directory.js'])
      vi.doUnmock(module)
    vi.resetModules()
  })

  const outside = () => [
    paths.dirname(root),
    paths.join(paths.dirname(root), 'outside.txt'),
    root + '-sibling',
    paths.join(root + '-sibling', 'secret.txt'),
    ...(paths === win32 ? [
      'D:\\outside\\secret.txt',
      '\\\\other\\share\\secret.txt',
      '\\\\server\\other-share\\secret.txt'
    ] : [])
  ]

  function filesystem() {
    const info = {
      dev: 1, ino: 2, size: 4, mtimeMs: 3, ctimeMs: 4, mode: 0o100644,
      isFile: () => true, isDirectory: () => false
    } as Stats
    const handle = {
      stat: vi.fn(async () => info),
      read: vi.fn(async (buffer: Buffer) => {
        buffer.write('safe')
        return { bytesRead: 4 }
      }),
      close: vi.fn(async () => {})
    }
    const fs = {
      realpath: vi.fn(async (path: string) => path),
      stat: vi.fn(async (_path: string) => info),
      open: vi.fn(async () => handle),
      opendir: vi.fn()
    }
    vi.resetModules()
    vi.doMock('node:path', () => paths)
    vi.doMock('node:fs/promises', () => fs)
    return { fs, handle, info }
  }

  it('accepts the project root and descendants without rejecting ..name', async () => {
    filesystem()
    const { inside } = await import('./project-content.js')
    for (const candidate of [root, paths.join(root, 'src', 'file.ts'), paths.join(root, '..name', 'file.ts')])
      expect(inside(root, candidate), candidate).toBe(true)
    for (const candidate of outside()) expect(inside(root, candidate), candidate).toBe(false)
    if (paths === win32) {
      expect(inside(root, paths.join(root, 'file.ts').replaceAll('\\', '/'))).toBe(true)
      expect(inside(root, paths.join(root, 'file.ts').toUpperCase())).toBe(true)
    }
  })

  it('rejects project reads whose realpath escapes before opening a file', async () => {
    const { fs, info } = filesystem()
    const { checkedProjectRead, fileRevision } = await import('./project-content.js')
    for (const target of outside()) {
      fs.realpath.mockResolvedValue(target)
      await expect(checkedProjectRead(root, paths.join(root, 'link.txt'), fileRevision(info)))
        .rejects.toThrow('FILE_NOT_ALLOWED')
    }
    expect(fs.open).not.toHaveBeenCalled()
  })

  it('reads valid dot-prefixed project paths and closes a handle after a realpath escape', async () => {
    const { fs, handle, info } = filesystem()
    const { checkedProjectRead, fileRevision } = await import('./project-content.js')
    const path = paths.join(root, '..name', 'file.txt')
    expect((await checkedProjectRead(root, path, fileRevision(info))).data.toString()).toBe('safe')
    fs.realpath.mockResolvedValue(paths.join(root + '-sibling', 'file.txt')).mockResolvedValueOnce(path)
    handle.read.mockClear()
    handle.close.mockClear()
    await expect(checkedProjectRead(root, path, fileRevision(info))).rejects.toThrow('FILE_NOT_ALLOWED')
    expect(handle.read).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('excludes outside and symlink-escaped artifacts from actual code history', async () => {
    const { fs, info } = filesystem()
    vi.doMock('../code/access.js', () => ({ requireCode: async () => ({ id: 'thread', workspace: root }) }))
    vi.doMock('../agents/library/access.js', () => ({}))
    const { RemoteArtifacts } = await import('./artifacts.js')
    const link = paths.join(root, 'link.txt')
    fs.realpath.mockImplementation(async (path) => path === link ? paths.join(root + '-sibling', 'secret.txt') : path)
    fs.stat.mockImplementation(async (path) => path === root
      ? { ...info, isFile: () => false } as Stats : info)
    const artifacts = new RemoteArtifacts({} as ServerRuntime)
    const files = await artifacts.codeHistory({ id: 'thread', turns: [{ items: [{
      id: 'result', kind: 'tool_result', output: { generatedFiles: [
        ...outside(), root, link, paths.join(root, 'src', 'good.txt'), paths.join(root, '..name', 'valid.txt')
      ].map((absolutePath) => ({ absolutePath })) }
    }] }] })
    expect(files.map((file) => file.name)).toEqual(['good.txt', 'valid.txt'])
    expect(files.every((file) => file.available)).toBe(true)
    for (const path of [...outside(), paths.join(root + '-sibling', 'secret.txt')])
      expect(fs.stat).not.toHaveBeenCalledWith(path)
  })

  it('lists ordinary project files beside protected data while excluding private entries', async () => {
    const { fs, info } = filesystem()
    const dataDir = paths.join(paths.dirname(root), 'private-data')
    const protectedFile = paths.join(root, 'protected.txt')
    const entries = ['good.txt', '..name.txt', '.env', 'protected.txt', 'runtime-link', 'outside-link']
    const read = vi.fn(async () => {
      const name = entries.shift()
      return name ? { name, isDirectory: () => false } : null
    })
    const close = vi.fn(async () => {})
    fs.opendir.mockResolvedValue({ read, close })
    fs.realpath.mockImplementation(async (path) => {
      if (path === paths.join(root, 'runtime-link')) return paths.join(dataDir, 'secret.txt')
      if (path === paths.join(root, 'outside-link')) return paths.join(root + '-sibling', 'secret.txt')
      return path
    })
    fs.stat.mockImplementation(async (path) => path === root
      ? { ...info, isFile: () => false, isDirectory: () => true } as Stats : info)
    vi.doMock('./project-directory.js', () => ({ projects: async () => [{ id: 'project', path: root }] }))
    const { RemoteProjectFiles } = await import('./projects.js')
    const files = new RemoteProjectFiles({
      rooms: { deps: { dataDir } }, remoteProtectedPaths: [protectedFile]
    } as unknown as ServerRuntime)
    try {
      const page = await files.page({ accountId: 'owner', deviceId: 'phone', authorizationId: 'grant' },
        { projectId: 'project', limit: 50 })
      expect(page.entries.map((entry) => entry.name)).toEqual(['good.txt', '..name.txt'])
      expect(page.complete).toBe(true)
      expect(fs.opendir).toHaveBeenCalledWith(root)
      expect(close).toHaveBeenCalledOnce()
    } finally { await files.close() }
  })

  it('rejects unauthorized repository reads, including canonical symlink targets', async () => {
    const { fs } = filesystem()
    const { readRoomRepositoryFile } = await import('../../rooms/room-file-content.js')
    for (const target of outside()) {
      // Both direct outside requests and a seemingly internal symlink must fail.
      fs.realpath.mockImplementation(async (path) => path)
      await expect(readRoomRepositoryFile({ canonicalRoot: root }, target, 64)).rejects.toThrow('file_unauthorized')
      fs.realpath.mockResolvedValue(target)
      await expect(readRoomRepositoryFile({ canonicalRoot: root }, 'link.txt', 64)).rejects.toThrow('file_unauthorized')
    }
    expect(fs.open).not.toHaveBeenCalled()
  })

  it('reads ..name repository files and rejects a post-open canonical escape', async () => {
    const { fs, handle } = filesystem()
    const { readRoomRepositoryFile } = await import('../../rooms/room-file-content.js')
    const relativePath = paths.join('..name', 'file.txt')
    expect((await readRoomRepositoryFile({ canonicalRoot: root }, relativePath, 64)).data.toString()).toBe('safe')
    fs.realpath.mockResolvedValue(paths.join(root + '-sibling', 'file.txt'))
      .mockResolvedValueOnce(paths.join(root, relativePath))
    handle.read.mockClear()
    handle.close.mockClear()
    await expect(readRoomRepositoryFile({ canonicalRoot: root }, relativePath, 64)).rejects.toThrow('file_changed')
    expect(handle.read).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledOnce()
  })
})
