import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageCleanupService } from './service'
import { StorageTrash } from './trash'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), cp: vi.fn(actual.cp), rm: vi.fn(actual.rm), mkdir: vi.fn(actual.mkdir) }
})

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
const NOW = new Date('2026-10-29T00:00:00.000Z')
const crossVolume = () => Object.assign(new Error('Cross-device link'), { code: 'EXDEV' })

afterEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actual.rename)
  vi.mocked(cp).mockReset().mockImplementation(actual.cp)
  vi.mocked(rm).mockReset().mockImplementation(actual.rm)
  vi.mocked(mkdir).mockReset().mockImplementation(actual.mkdir)
  await Promise.all(roots.splice(0).map((root) => actual.rm(root, { recursive: true, force: true })))
})

async function fixture(kind: 'file' | 'directory' = 'file') {
  const root = await mkdtemp(join(tmpdir(), 'kun-storage-trash-')); roots.push(root)
  const original = join(root, 'data-volume', 'entry')
  const content = kind === 'file' ? original : join(original, 'nested', 'log.jsonl')
  await mkdir(dirname(content), { recursive: true })
  await writeFile(content, 'complete content')
  const trashRoot = join(root, 'home-volume', 'trash', 'storage-cleanup')
  const trash = new StorageTrash(trashRoot, () => NOW)
  const run = await trash.begin(7)
  const stored = join(trashRoot, run.runId, 'files', '0')
  return { root, original, content, trashRoot, trash, run, stored }
}

describe('cross-volume cleanup trash restore', () => {
  it.each(['file', 'directory'] as const)('copies a %s both into trash and back across EXDEV', async (kind) => {
    const { original, content, trash, run, stored } = await fixture(kind)
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    expect(await run.move(original, 16)).toBe(true)
    await run.commit()
    expect(await lstat(original).catch(() => null)).toBeNull()

    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    vi.mocked(cp).mockImplementationOnce(async (...args) => {
      await actual.cp(...args)
      expect(await lstat(stored)).toBeDefined()
      expect(await lstat(original).catch(() => null)).toBeNull()
    })
    expect(await trash.restore(run.runId)).toEqual({ restored: 1, kept: 0, failures: [] })
    expect(await readFile(content, 'utf8')).toBe('complete content')
    expect(await lstat(stored).catch(() => null)).toBeNull()
    expect((await trash.summary()).entries).toBe(0)
    expect(cp).toHaveBeenLastCalledWith(stored, expect.any(String), {
      recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true
    })
  })

  it('preserves an occupied original and reports the conflict', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    await writeFile(original, 'new user content')
    const result = await trash.restore(run.runId)
    expect(result).toMatchObject({ restored: 0, kept: 1, failures: [{ path: original, code: 'EEXIST' }] })
    expect(await readFile(original, 'utf8')).toBe('new user content')
    expect(await readFile(stored, 'utf8')).toBe('complete content')
    expect(cp).not.toHaveBeenCalled()
    expect((await trash.summary()).entries).toBe(1)
  })

  it('keeps the source and removes a partial staged copy after ENOSPC, allowing a retry', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    vi.mocked(cp).mockImplementationOnce(async (_source, target) => {
      await writeFile(target, 'partial')
      throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })
    })
    expect(await trash.restore(run.runId)).toEqual({
      restored: 0, kept: 1,
      failures: [{ path: original, code: 'ENOSPC', message: 'No space left on device' }]
    })
    expect(await readFile(stored, 'utf8')).toBe('complete content')
    expect(await lstat(original).catch(() => null)).toBeNull()
    expect(await readdir(dirname(original))).toEqual([])
    expect((await trash.summary()).entries).toBe(1)

    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    expect(await trash.restore(run.runId)).toEqual({ restored: 1, kept: 0, failures: [] })
    expect(await readFile(original, 'utf8')).toBe('complete content')
  })

  it('does not overwrite an original created while copying', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    vi.mocked(cp).mockImplementationOnce(async (...args) => {
      await actual.cp(...args)
      await writeFile(original, 'new user content')
    })
    expect(await trash.restore(run.runId)).toMatchObject({ restored: 0, kept: 1, failures: [{ code: 'EEXIST' }] })
    expect(await readFile(original, 'utf8')).toBe('new user content')
    expect(await readFile(stored, 'utf8')).toBe('complete content')
    expect(await readdir(dirname(original))).toEqual(['entry'])
  })

  it('only falls back on EXDEV and reports permission errors', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))
    expect(await trash.restore(run.runId)).toEqual({
      restored: 0, kept: 1, failures: [{ path: original, code: 'EACCES', message: 'Permission denied' }]
    })
    expect(cp).not.toHaveBeenCalled()
    expect(await readFile(stored, 'utf8')).toBe('complete content')
  })

  it('retains both complete copies and the manifest if removing the trash source fails', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (String(path) === stored) throw Object.assign(new Error('Source is busy'), { code: 'EBUSY' })
      return actual.rm(path, options)
    })
    expect(await trash.restore(run.runId)).toMatchObject({
      restored: 0, kept: 1, failures: [{ path: original, code: 'EBUSY', message: 'Source is busy' }]
    })
    expect(await readFile(original, 'utf8')).toBe('complete content')
    expect(await readFile(stored, 'utf8')).toBe('complete content')
    expect((await trash.summary()).entries).toBe(1)
  })

  it.skipIf(process.platform === 'win32')('preserves symlinks while restoring a directory across volumes', async () => {
    const { original, trash, run } = await fixture('directory')
    await symlink('nested/log.jsonl', join(original, 'link'))
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    expect(await trash.restore(run.runId)).toMatchObject({ restored: 1, kept: 0 })
    expect((await lstat(join(original, 'link'))).isSymbolicLink()).toBe(true)
    expect(await readFile(join(original, 'link'), 'utf8')).toBe('complete content')
  })

  it('keeps the source and manifest when publishing the staged copy fails', async () => {
    const { original, trash, run, stored } = await fixture()
    await run.move(original, 16)
    await run.commit()
    vi.mocked(rename)
      .mockRejectedValueOnce(crossVolume())
      .mockRejectedValueOnce(Object.assign(new Error('Cannot publish restored file'), { code: 'EACCES' }))
    expect(await trash.restore(run.runId)).toEqual({
      restored: 0, kept: 1, failures: [{ path: original, code: 'EACCES', message: 'Cannot publish restored file' }]
    })
    expect(await readFile(stored, 'utf8')).toBe('complete content')
    expect(await lstat(original).catch(() => null)).toBeNull()
    expect(await readdir(dirname(original))).toEqual([])
    expect((await trash.summary()).entries).toBe(1)
  })

  it('removes only successfully restored entries from a mixed run', async () => {
    const { original, trash, run, stored } = await fixture()
    const occupied = join(dirname(original), 'occupied')
    await writeFile(occupied, 'second entry')
    await run.move(original, 16)
    await run.move(occupied, 12)
    await run.commit()
    await writeFile(occupied, 'new user content')
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    expect(await trash.restore(run.runId)).toMatchObject({
      restored: 1, kept: 1, failures: [{ path: occupied, code: 'EEXIST' }]
    })
    expect(await readFile(original, 'utf8')).toBe('complete content')
    expect(await lstat(stored).catch(() => null)).toBeNull()
    expect(await readFile(occupied, 'utf8')).toBe('new user content')
    expect(await readFile(join(dirname(stored), '1'), 'utf8')).toBe('second entry')
    expect(await trash.summary()).toMatchObject({ entries: 1, bytes: 12, runs: [{ entries: 1, bytes: 12 }] })
  })

  it('passes restore failures and the latest summary through the service boundary', async () => {
    const { root, original, trash, run } = await fixture()
    await run.move(original, 16)
    await run.commit()
    await writeFile(original, 'occupied')
    const service = new StorageCleanupService({
      paths: async () => ({ kunHome: join(root, 'home-volume'), dataDir: join(root, 'data-volume'), userData: join(root, 'user-data') }),
      runtime: { preview: async () => [], apply: async () => ({ slimmed: [], skipped: [] }) },
      clearBrowserCaches: async () => undefined,
      notify: () => undefined,
      now: () => NOW
    })
    expect(await service.restoreTrashRun(run.runId)).toMatchObject({
      restored: 0, kept: 1, failures: [{ path: original, code: 'EEXIST' }], trash: await trash.summary()
    })
  })
})

describe('scheduled trash move cancellation', () => {
  it.each(['disable', 'shorten'] as const)('keeps completed moves restorable and stops later moves after %s', async (change) => {
    const { root } = await fixture()
    const paths = { kunHome: join(root, 'home-volume'), dataDir: join(root, 'data-volume'), userData: join(root, 'user-data') }
    const records = join(paths.dataDir, 'observability', 'trajectory', 'records')
    await mkdir(records, { recursive: true })
    const old = new Date('2026-08-01T00:00:00.000Z')
    for (const name of ['a.jsonl', 'b.jsonl']) {
      await writeFile(join(records, name), 'trace')
      await utimes(join(records, name), old, old)
    }
    const service = new StorageCleanupService({
      paths: async () => paths,
      runtime: { preview: async () => [], apply: vi.fn() },
      clearBrowserCaches: async () => undefined, notify: () => undefined, now: () => NOW
    })
    await service.enable(30)
    await service.updateConfig({ notifyBefore: false })
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    let moves = 0
    vi.mocked(mkdir).mockImplementation(async (...args) => {
      const result = await actual.mkdir(...args)
      if (String(args[0]).endsWith(`${process.platform === 'win32' ? '\\' : '/'}files`) && ++moves === 2) {
        entered()
        await gate
      }
      return result
    })
    const tick = service.tick()
    await waiting
    const status = change === 'disable' ? await service.disable() : await service.updateConfig({ olderThanDays: 1 })
    expect(status.state).toBe(change === 'disable' ? 'off' : 'needs_consent')
    release()
    await tick
    expect(await readdir(records)).toHaveLength(1)
    const completed = await service.status()
    expect(completed.config.lastRunAt).toBeUndefined()
    expect(completed.trash.entries).toBe(1)
    expect((await service.history())[0]).toMatchObject({ movedToTrash: 1, trashedBytes: 5 })
    expect(await service.restoreTrashRun(completed.trash.runs[0]!.runId)).toMatchObject({ restored: 1, kept: 0, failures: [] })
    expect((await readdir(records)).sort()).toEqual(['a.jsonl', 'b.jsonl'])
  })

  it('rechecks cancellation after creating the destination directory', async () => {
    const { original, trash } = await fixture()
    let active = true
    const run = await trash.begin(7, () => active)
    vi.mocked(mkdir).mockImplementationOnce(async (...args) => {
      const result = await actual.mkdir(...args)
      active = false
      return result
    })
    expect(await run.move(original, 16)).toBe(false)
    await run.commit()
    expect(rename).not.toHaveBeenCalled()
    expect(await readFile(original, 'utf8')).toBe('complete content')
    expect((await trash.summary()).entries).toBe(0)
  })

  it('does not delete the original if cancelled during a cross-volume copy', async () => {
    const { original, trash } = await fixture()
    let active = true
    const run = await trash.begin(7, () => active)
    vi.mocked(rename).mockRejectedValueOnce(crossVolume())
    vi.mocked(cp).mockImplementationOnce(async (...args) => {
      await actual.cp(...args)
      active = false
    })
    expect(await run.move(original, 16)).toBe(false)
    await run.commit()
    expect(await readFile(original, 'utf8')).toBe('complete content')
    expect((await trash.summary()).entries).toBe(0)
  })
})
