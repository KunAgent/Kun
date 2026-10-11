import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonSettingsStore } from '../../settings-store'
import { createPaperWorkspaceEnsurer } from './paper-workspace-service'

// Keep the unrelated docs/conversation workspace bootstrap out of this test's
// temporary filesystem. The actual settings queue, merge and disk writes run.
vi.mock('../../settings-store-foundation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../settings-store-foundation')>()
  return {
    ...actual,
    ensureManagedWorkspaceRootsExist: vi.fn(async () => undefined),
    loadDefaultSettings: async () => actual.normalizeStoredSettings(actual.defaultSettings())
  }
})

let userDataDir: string
let defaultRoot: string
let store: JsonSettingsStore

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

const errno = (code: string) => Object.assign(new Error(`Filesystem ${code}`), { code })
const ensureWith = (fileSystem?: Parameters<typeof createPaperWorkspaceEnsurer>[1]) =>
  createPaperWorkspaceEnsurer({ store, userDataDir: () => userDataDir }, fileSystem)

beforeEach(async () => {
  userDataDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'kun-paper-workspace-')))
  defaultRoot = join(userDataDir, 'paper-workspaces', 'default')
  store = new JsonSettingsStore(userDataDir)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(userDataDir, { recursive: true, force: true })
})

describe('paper workspace bootstrap and migration', () => {
  it('creates and persists one default on first launch without changing docs or memory scope', async () => {
    const before = await store.load()
    const result = await ensureWith()()
    expect(result).toEqual({
      ok: true, workspaceRoot: defaultRoot, defaultWorkspaceRoot: defaultRoot,
      created: true, libraries: [defaultRoot], activeLibrary: defaultRoot
    })
    expect((await fs.stat(defaultRoot)).isDirectory()).toBe(true)
    const saved = await new JsonSettingsStore(userDataDir).load()
    expect(saved.write.paperMode).toMatchObject({
      workspaceInitialized: true, libraries: [defaultRoot], activeLibrary: defaultRoot
    })
    expect({ ...saved, write: { ...saved.write, paperMode: before.write.paperMode } }).toEqual(before)
  })

  it('reuses the same root and contents after restart without another mkdir', async () => {
    await ensureWith()()
    await fs.writeFile(join(defaultRoot, 'keep.txt'), 'existing papers')
    store = new JsonSettingsStore(userDataDir)
    const mkdir = vi.fn(fs.mkdir)
    expect(await ensureWith({ ...fs, mkdir: mkdir as typeof fs.mkdir })()).toMatchObject({ ok: true, created: false, workspaceRoot: defaultRoot })
    expect(mkdir).not.toHaveBeenCalled()
    expect(await fs.readFile(join(defaultRoot, 'keep.txt'), 'utf8')).toBe('existing papers')
  })

  it('coalesces concurrent calls into one filesystem and settings operation', async () => {
    const mkdir = vi.fn(fs.mkdir)
    const update = vi.spyOn(store, 'updateIf')
    const ensure = ensureWith({ ...fs, mkdir: mkdir as typeof fs.mkdir })
    const pending = Array.from({ length: 20 }, () => ensure())
    expect(pending.every((promise) => promise === pending[0])).toBe(true)
    const results = await Promise.all(pending)
    expect(results.every((result) => result.ok && result.workspaceRoot === defaultRoot)).toBe(true)
    expect(mkdir).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('preserves a legacy active root and repairs its missing library-list entry', async () => {
    const chosen = join(userDataDir, 'chosen')
    const other = join(userDataDir, 'other')
    await fs.mkdir(chosen)
    await fs.mkdir(other)
    await fs.writeFile(join(userDataDir, 'kun-settings.json'), JSON.stringify({
      version: 1, write: { paperMode: { activeLibrary: chosen, libraries: [other] } }
    }))
    expect(await ensureWith()()).toMatchObject({
      ok: true, created: false, activeLibrary: chosen, libraries: [chosen, other]
    })
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await new JsonSettingsStore(userDataDir).load()).write.paperMode.activeLibrary).toBe(chosen)
  })

  it('selects the first registered root when legacy settings have no active root', async () => {
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(chosen)
    await store.patch({ write: { paperMode: { libraries: [chosen] } } })
    expect(await ensureWith()()).toMatchObject({ ok: true, workspaceRoot: chosen, libraries: [chosen] })
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not drop a registered root to repair an orphan active root at the library limit', async () => {
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(chosen)
    const libraries = Array.from({ length: 64 }, (_, index) => join(userDataDir, `library-${index}`))
    await store.patch({ write: { paperMode: { activeLibrary: chosen, libraries } } })
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'library-limit', workspaceRoot: chosen })
    expect((await store.load()).write.paperMode).toMatchObject({ activeLibrary: chosen, libraries })
  })

  it('does not replace a missing chosen root with another library or a new default', async () => {
    const missing = join(userDataDir, 'missing')
    const other = join(userDataDir, 'other')
    await fs.mkdir(other)
    await store.patch({ write: { paperMode: { activeLibrary: missing, libraries: [missing, other] } } })
    const before = await fs.readFile(join(userDataDir, 'kun-settings.json'), 'utf8')
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'missing-root', workspaceRoot: missing })
    expect(await fs.readFile(join(userDataDir, 'kun-settings.json'), 'utf8')).toBe(before)
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not create a missing registered root when activeLibrary is blank', async () => {
    const missing = join(userDataDir, 'missing')
    await store.patch({ write: { paperMode: { libraries: [missing] } } })
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'missing-root', workspaceRoot: missing })
    expect((await store.load()).write.paperMode.activeLibrary).toBe('')
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a deleted default instead of silently recreating an empty library', async () => {
    await ensureWith()()
    await fs.rm(defaultRoot, { recursive: true })
    store = new JsonSettingsStore(userDataDir)
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'missing-root', workspaceRoot: defaultRoot })
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not resurrect any workspace after all libraries are explicitly removed', async () => {
    await ensureWith()()
    await store.patch({ write: { paperMode: { activeLibrary: '', libraries: [], workspaceInitialized: false } } })
    await fs.rm(defaultRoot, { recursive: true })
    store = new JsonSettingsStore(userDataDir)
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'unconfigured' })
    expect((await store.load()).write.paperMode.workspaceInitialized).toBe(true)
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('latest user selection wins', () => {
  it('rereads settings after mkdir and preserves a newer explicit selection and other settings', async () => {
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(chosen)
    const entered = gate()
    const resume = gate()
    const mkdir: typeof fs.mkdir = vi.fn(async (path, options) => {
      if (path === defaultRoot) { entered.release(); await resume.promise }
      return fs.mkdir(path, options as never)
    }) as typeof fs.mkdir
    const pending = ensureWith({ ...fs, mkdir: mkdir as typeof fs.mkdir })()
    await entered.promise
    await store.patch({ write: { paperMode: {
      activeLibrary: chosen, libraries: [chosen], reader: { paperTone: 'sepia' }
    } } })
    resume.release()
    expect(await pending).toMatchObject({ ok: true, workspaceRoot: chosen, created: false, libraries: [chosen] })
    expect((await store.load()).write.paperMode.reader.paperTone).toBe('sepia')
  })

  it('does not register an in-flight default after the user selects then removes a workspace', async () => {
    const entered = gate()
    const resume = gate()
    const mkdir: typeof fs.mkdir = vi.fn(async (path, options) => {
      if (path === defaultRoot) { entered.release(); await resume.promise }
      return fs.mkdir(path, options as never)
    }) as typeof fs.mkdir
    const pending = ensureWith({ ...fs, mkdir: mkdir as typeof fs.mkdir })()
    await entered.promise
    await store.patch({ write: { paperMode: { activeLibrary: join(userDataDir, 'chosen') } } })
    await store.patch({ write: { paperMode: { activeLibrary: '', libraries: [] } } })
    resume.release()
    expect(await pending).toMatchObject({ ok: false, code: 'unconfigured' })
    expect((await store.load()).write.paperMode.libraries).toEqual([])
  })

  it('discards a failed old-root validation when a new root is selected while waiting', async () => {
    const old = join(userDataDir, 'old')
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(old)
    await fs.mkdir(chosen)
    await store.patch({ write: { paperMode: { activeLibrary: old, libraries: [old] } } })
    const entered = gate()
    const resume = gate()
    const access = vi.fn(async (path: Parameters<typeof fs.access>[0], mode?: number) => {
      if (path === old) { entered.release(); await resume.promise; throw errno('EACCES') }
      return fs.access(path, mode)
    })
    const pending = ensureWith({ ...fs, access })()
    await entered.promise
    await store.patch({ write: { paperMode: { activeLibrary: chosen, libraries: [chosen] } } })
    resume.release()
    expect(await pending).toMatchObject({ ok: true, workspaceRoot: chosen })
  })

  it('retries against the latest selection if it changes immediately before atomic commit', async () => {
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(chosen)
    const updateIf = store.updateIf.bind(store)
    vi.spyOn(store, 'updateIf').mockImplementationOnce(async (predicate, mutation) => {
      await store.patch({ write: { paperMode: { libraries: [chosen], activeLibrary: chosen } } })
      return updateIf(predicate, mutation)
    })
    expect(await ensureWith()()).toMatchObject({ ok: true, workspaceRoot: chosen, libraries: [chosen] })
  })

  it('honors a newer selection from another client after a Manager revision conflict', async () => {
    const chosen = join(userDataDir, 'chosen')
    await fs.mkdir(chosen)
    const entered = gate()
    const resume = gate()
    let revision = 0
    let value: string | null = null
    let blocked = false
    const documentBackend = {
      async read() { return { revision, value } },
      async write(expectedRevision: number, next: string) {
        const activeLibrary = JSON.parse(next).write.paperMode.activeLibrary
        if (!blocked && activeLibrary === defaultRoot) {
          blocked = true
          entered.release()
          await resume.promise
        }
        if (expectedRevision !== revision) {
          throw Object.assign(new Error('revision conflict'), {
            name: 'ManagerRevisionConflictError', currentRevision: revision
          })
        }
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    store = new JsonSettingsStore(userDataDir, { documentBackend })
    const otherClient = new JsonSettingsStore(userDataDir, { documentBackend })
    const pending = ensureWith()()
    await entered.promise
    await otherClient.patch({ write: { paperMode: { activeLibrary: chosen, libraries: [chosen] } } })
    resume.release()
    expect(await pending).toMatchObject({ ok: true, workspaceRoot: chosen, libraries: [chosen] })
    expect((await store.load()).write.paperMode.activeLibrary).toBe(chosen)
    expect(revision).toBe(1)
  })
})

describe('paper workspace filesystem safety', () => {
  it('keeps an existing read-only library viewable without probing write access', async () => {
    const chosen = join(userDataDir, 'read-only')
    await fs.mkdir(chosen)
    await store.patch({ write: { paperMode: { activeLibrary: chosen, libraries: [chosen] } } })
    const access = vi.fn(async (path: Parameters<typeof fs.access>[0], mode = 0) => {
      if (mode & constants.W_OK) throw errno('EACCES')
      return fs.access(path, mode)
    })
    expect(await ensureWith({ ...fs, access })()).toMatchObject({ ok: true, workspaceRoot: chosen })
    expect(access).toHaveBeenCalledWith(chosen, constants.R_OK | constants.X_OK)
  })

  it('requires write access for default creation but not for an initialized default', async () => {
    const access = vi.fn(async (path: Parameters<typeof fs.access>[0], mode = 0) => {
      if (mode & constants.W_OK) throw errno('EACCES')
      return fs.access(path, mode)
    })
    expect(await ensureWith({ ...fs, access })()).toMatchObject({ ok: false, code: 'permission-denied' })
    expect(await ensureWith()()).toMatchObject({ ok: true })
    expect(await ensureWith({ ...fs, access })()).toMatchObject({ ok: true, workspaceRoot: defaultRoot })
  })

  it.each(['EACCES', 'EPERM', 'EROFS'])('does not persist a default when mkdir fails with %s', async (code) => {
    const mkdir = vi.fn(async () => { throw errno(code) }) as typeof fs.mkdir
    expect(await ensureWith({ ...fs, mkdir: mkdir as typeof fs.mkdir })()).toMatchObject({ ok: false, code: 'permission-denied' })
    expect((await store.load()).write.paperMode).toMatchObject({
      libraries: [], activeLibrary: '', workspaceInitialized: false
    })
    await expect(fs.stat(join(userDataDir, 'kun-settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await ensureWith()()).toMatchObject({ ok: true, created: true })
  })

  it('keeps settings untouched when persistence fails after successful directory creation', async () => {
    vi.spyOn(store, 'updateIf').mockRejectedValueOnce(errno('EACCES'))
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'permission-denied' })
    expect((await store.load()).write.paperMode.activeLibrary).toBe('')
    expect(await ensureWith()()).toMatchObject({ ok: true, workspaceRoot: defaultRoot, created: false })
  })

  it('rejects a file at the managed root without replacing it', async () => {
    await fs.mkdir(join(userDataDir, 'paper-workspaces'))
    await fs.writeFile(defaultRoot, 'keep this file')
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'invalid-root' })
    expect(await fs.readFile(defaultRoot, 'utf8')).toBe('keep this file')
    expect((await store.load()).write.paperMode.workspaceInitialized).toBe(false)
  })

  it.each(['parent', 'default'])('rejects a symlink at the managed %s without writing through it', async (position) => {
    const outside = join(userDataDir, 'outside')
    await fs.mkdir(outside)
    const link = position === 'parent' ? join(userDataDir, 'paper-workspaces') : defaultRoot
    if (position === 'default') await fs.mkdir(join(userDataDir, 'paper-workspaces'))
    await fs.symlink(outside, link, 'junction')
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'invalid-root' })
    expect(await fs.readdir(outside)).toEqual([])
    expect((await store.load()).write.paperMode.activeLibrary).toBe('')
  })

  it('rejects a dangling managed symlink and never fills its target', async () => {
    await fs.mkdir(join(userDataDir, 'paper-workspaces'))
    const missing = join(userDataDir, 'missing-target')
    await fs.symlink(missing, defaultRoot, 'junction')
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'invalid-root' })
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('allows a trusted userData alias while keeping managed children real directories', async () => {
    const alias = join(userDataDir, 'alias')
    const target = join(userDataDir, 'actual')
    await fs.mkdir(target)
    await fs.symlink(target, alias, 'junction')
    const ensure = createPaperWorkspaceEnsurer({ store, userDataDir: () => alias })
    expect(await ensure()).toMatchObject({ ok: true, workspaceRoot: join(alias, 'paper-workspaces', 'default') })
    expect((await fs.lstat(join(target, 'paper-workspaces', 'default'))).isDirectory()).toBe(true)
  })

  it('preserves a chosen existing library alias without creating any managed root', async () => {
    const target = join(userDataDir, 'actual')
    const alias = join(userDataDir, 'alias')
    await fs.mkdir(target)
    await fs.symlink(target, alias, 'junction')
    await store.patch({ write: { paperMode: { activeLibrary: alias, libraries: [alias] } } })
    expect(await ensureWith()()).toMatchObject({ ok: true, workspaceRoot: alias })
    await expect(fs.stat(defaultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['relative/path', '../escape', 'bad\0path'])('rejects unsafe configured root %s', async (activeLibrary) => {
    await store.patch({ write: { paperMode: { activeLibrary, libraries: [activeLibrary] } } })
    expect(await ensureWith()()).toMatchObject({ ok: false, code: 'invalid-root' })
  })
})
