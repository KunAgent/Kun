import { posix, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Exercise the production guard with both Node path implementations on every OS.
// Only path syntax and the temporary-directory location are substituted; the
// containment calculation itself is always the implementation under test.
describe.each([
  { name: 'POSIX', paths: posix, temporary: '/tmp' },
  { name: 'Windows drive', paths: win32, temporary: 'C:\\Users\\tester\\AppData\\Local\\Temp' },
  { name: 'Windows UNC', paths: win32, temporary: '\\\\server\\share\\Temp' }
])('shared attachment containment: $name', ({ paths, temporary }) => {
  afterEach(() => {
    vi.doUnmock('node:path')
    vi.doUnmock('node:os')
    vi.resetModules()
  })

  async function load() {
    vi.resetModules()
    vi.doMock('node:path', () => paths)
    vi.doMock('node:os', () => ({ tmpdir: () => temporary }))
    return import('./shared-attachment-content.js')
  }

  it('recognizes only the cache root and its descendants', async () => {
    const module = await load()
    const directory = module.sharedAttachmentDirectory('thread')
    const root = paths.dirname(directory)
    for (const path of [root, directory, paths.join(directory, 'att_file.txt'), paths.join(root, '..name', 'file')]) {
      expect(module.isSharedAttachmentCachePath(path), path).toBe(true)
    }
    for (const path of [
      temporary,
      paths.parse(root).root,
      paths.join(temporary, 'workspace', 'file.txt'),
      root + '-sibling',
      paths.join(root + '-sibling', 'file.txt'),
      paths.join(directory, '..', '..', 'workspace', 'file.txt'),
      ...(paths === win32 ? ['D:\\workspace\\file.txt', '\\\\other\\share\\file.txt', '\\\\server\\other-share\\file.txt'] : [])
    ]) {
      expect(module.isSharedAttachmentCachePath(path), path).toBe(false)
    }
    if (paths === win32) {
      expect(module.isSharedAttachmentCachePath(directory.toUpperCase())).toBe(true)
      expect(module.isSharedAttachmentCachePath(directory.replaceAll('\\', '/'))).toBe(true)
    }
  })

  it('does not attempt private-cache reads for outside or other-thread paths', async () => {
    const module = await load()
    const directory = module.sharedAttachmentDirectory('thread')
    const context = { threadId: 'thread', attachmentAliases: [] }
    for (const path of [
      paths.join(temporary, 'workspace', 'file.txt'),
      directory + '-sibling',
      module.sharedAttachmentDirectory('other-thread'),
      paths.join(directory, '..', '..', 'workspace', 'file.txt')
    ]) {
      // No filesystem entries are created: a mistaken admission would attempt
      // realpath and throw instead of declining the special read exception.
      expect(await module.sharedAttachmentReadPath(path, context), path).toBeNull()
    }
    expect(await module.sharedAttachmentReadPath(directory, { threadId: 'thread' })).toBeNull()
  })
})
