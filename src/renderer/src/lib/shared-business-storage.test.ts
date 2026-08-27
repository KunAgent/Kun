/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installSharedBusinessStorage,
  resetSharedBusinessStorageInstallForTests,
  syncSharedBusinessStorageOnce,
  type SharedBusinessStorageCursor
} from './shared-business-storage'

import {
  SHARED_BUSINESS_STORAGE_JOURNAL_KEY,
  writeSharedBusinessStorageJournal
} from './shared-business-storage-journal'

const DESIGN_REGISTRY_KEY = 'kun.design.threadRegistry.v1'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('shared business storage synchronization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetSharedBusinessStorageInstallForTests()
  })

  it('pushes a Design registry written while the remote read is pending', async () => {
    const storage = new MemoryStorage()
    const oldRegistry = '{"version":1,"workspaces":{"old":{}}}'
    const newRegistry = '{"version":1,"workspaces":{"drawing-new":{}}}'
    storage.setItem(DESIGN_REGISTRY_KEY, oldRegistry)
    vi.stubGlobal('localStorage', storage)

    const pendingRead = deferred<{ revision: number; value: Record<string, string> }>()
    const write = vi.fn(async (_revision: number, value: Record<string, string>) => ({
      revision: 8,
      value
    }))
    const cursor: SharedBusinessStorageCursor = {
      baseline: { [DESIGN_REGISTRY_KEY]: oldRegistry },
      revision: 7
    }

    const syncing = syncSharedBusinessStorageOnce({
      read: () => pendingRead.promise,
      write
    }, cursor)
    storage.setItem(DESIGN_REGISTRY_KEY, newRegistry)
    pendingRead.resolve({
      revision: 7,
      value: { [DESIGN_REGISTRY_KEY]: oldRegistry }
    })

    const result = await syncing

    expect(write).toHaveBeenCalledWith(7, {
      [DESIGN_REGISTRY_KEY]: newRegistry
    })
    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(newRegistry)
    expect(result.baseline[DESIGN_REGISTRY_KEY]).toBe(newRegistry)
    expect(result.retry).toBe(false)
  })

  it('retries the initial remote read before giving up', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const read = vi
      .fn<() => Promise<{ revision: number; value: Record<string, string> }>>()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValue({ revision: 1, value: {} })
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: { read, write: vi.fn() },
      appEnvironment: { flavor: 'development' }
    }

    await installSharedBusinessStorage()

    expect(read).toHaveBeenCalledTimes(3)
    // Successful install starts exactly one polling timer.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('rejects after the initial read retries are exhausted and allows a later retry', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const read = vi
      .fn<() => Promise<{ revision: number; value: Record<string, string> }>>()
      .mockRejectedValue(new Error('ipc down'))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: { read, write: vi.fn() },
      appEnvironment: { flavor: 'development' }
    }

    await expect(installSharedBusinessStorage()).rejects.toThrow('ipc down')
    expect(read).toHaveBeenCalledTimes(3)

    // A later retry (e.g. the StartupGate retry button) must be able to install
    // again after the failure cleared the cached install promise.
    read.mockResolvedValue({ revision: 1, value: {} })
    await installSharedBusinessStorage()
    expect(read).toHaveBeenCalledTimes(4)
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('does not create a second polling timer when install is called again after success', async () => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const read = vi
      .fn<() => Promise<{ revision: number; value: Record<string, string> }>>()
      .mockResolvedValue({ revision: 1, value: {} })
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: { read, write: vi.fn() },
      appEnvironment: { flavor: 'development' }
    }

    await installSharedBusinessStorage()
    await installSharedBusinessStorage()
    await installSharedBusinessStorage()

    expect(read).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('restores a dirty local update across restart and uploads it over an old remote value', async () => {
    const storage = new MemoryStorage()
    const oldRegistry = '{"old":true}'
    const newRegistry = '{"new":true}'
    storage.setItem(DESIGN_REGISTRY_KEY, newRegistry)
    vi.stubGlobal('localStorage', storage)
    writeSharedBusinessStorageJournal({
      version: 1,
      acknowledgedRevision: 4,
      acknowledgedEntries: { [DESIGN_REGISTRY_KEY]: oldRegistry },
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })
    const write = vi.fn(async (_revision: number, value: Record<string, string>) => ({
      revision: 5,
      value
    }))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: {
        read: vi.fn(async () => ({ revision: 4, value: { [DESIGN_REGISTRY_KEY]: oldRegistry } })),
        write
      },
      appEnvironment: { flavor: 'development' }
    }

    await installSharedBusinessStorage()

    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(newRegistry)
    expect(write).toHaveBeenCalledWith(4, { [DESIGN_REGISTRY_KEY]: newRegistry })
    expect(JSON.parse(storage.getItem(SHARED_BUSINESS_STORAGE_JOURNAL_KEY) ?? '{}')).toMatchObject({
      acknowledgedRevision: 5,
      dirtyKeys: []
    })
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('keeps local data after an initial read failure and uploads it on the next install', async () => {
    const storage = new MemoryStorage()
    const oldRegistry = '{"old":true}'
    const newRegistry = '{"new":true}'
    storage.setItem(DESIGN_REGISTRY_KEY, newRegistry)
    vi.stubGlobal('localStorage', storage)
    writeSharedBusinessStorageJournal({
      version: 1,
      acknowledgedRevision: 2,
      acknowledgedEntries: { [DESIGN_REGISTRY_KEY]: oldRegistry },
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })
    const read = vi.fn().mockRejectedValue(new Error('manager unavailable'))
    const write = vi.fn(async (_revision: number, value: Record<string, string>) => ({ revision: 3, value }))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: { read, write },
      appEnvironment: { flavor: 'development' }
    }

    await expect(installSharedBusinessStorage()).rejects.toThrow('manager unavailable')
    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(newRegistry)
    resetSharedBusinessStorageInstallForTests()
    read.mockResolvedValue({ revision: 2, value: { [DESIGN_REGISTRY_KEY]: oldRegistry } })
    await installSharedBusinessStorage()

    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(newRegistry)
    expect(write).toHaveBeenCalledWith(2, { [DESIGN_REGISTRY_KEY]: newRegistry })
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('preserves a dirty deletion tombstone instead of resurrecting the remote value', async () => {
    const storage = new MemoryStorage()
    const oldRegistry = '{"old":true}'
    vi.stubGlobal('localStorage', storage)
    writeSharedBusinessStorageJournal({
      version: 1,
      acknowledgedRevision: 8,
      acknowledgedEntries: { [DESIGN_REGISTRY_KEY]: oldRegistry },
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })
    const write = vi.fn(async (_revision: number, value: Record<string, string>) => ({
      revision: 9,
      value
    }))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: {
        read: vi.fn(async () => ({ revision: 8, value: { [DESIGN_REGISTRY_KEY]: oldRegistry } })),
        write
      },
      appEnvironment: { flavor: 'development' }
    }

    await installSharedBusinessStorage()

    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBeNull()
    expect(write).toHaveBeenCalledWith(8, {})
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('runs the immediate follow-up after clearing the completed in-flight sync', async () => {
    const storage = new MemoryStorage()
    const remoteRegistry = '{"version":1,"workspaces":{}}'
    const firstLocalRegistry = '{"version":1,"workspaces":{"drawing-1":{}}}'
    const latestLocalRegistry = '{"version":1,"workspaces":{"drawing-2":{}}}'
    storage.setItem(DESIGN_REGISTRY_KEY, firstLocalRegistry)
    vi.stubGlobal('localStorage', storage)
    writeSharedBusinessStorageJournal({
      version: 1,
      acknowledgedRevision: 3,
      acknowledgedEntries: { [DESIGN_REGISTRY_KEY]: remoteRegistry },
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })

    let remote: { revision: number; value: Record<string, string> } = {
      revision: 3,
      value: { [DESIGN_REGISTRY_KEY]: remoteRegistry }
    }
    const firstWrite = deferred<typeof remote>()
    const write = vi
      .fn<(revision: number, value: Record<string, string>) => Promise<typeof remote>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementation(async (_revision, value) => {
        remote = { revision: remote.revision + 1, value: { ...value } }
        return remote
      })
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: {
        read: vi.fn(async () => remote),
        write
      },
      appEnvironment: { flavor: 'development' }
    }

    const installing = installSharedBusinessStorage()
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    storage.setItem(DESIGN_REGISTRY_KEY, latestLocalRegistry)
    remote = {
      revision: 4,
      value: { [DESIGN_REGISTRY_KEY]: firstLocalRegistry }
    }
    firstWrite.resolve(remote)

    await installing
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))

    expect(write).toHaveBeenLastCalledWith(4, {
      [DESIGN_REGISTRY_KEY]: latestLocalRegistry
    })
    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(latestLocalRegistry)
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('bounds immediate retries when writes keep failing', async () => {
    const storage = new MemoryStorage()
    const remoteRegistry = '{"remote":true}'
    const localRegistry = '{"local":true}'
    storage.setItem(DESIGN_REGISTRY_KEY, localRegistry)
    vi.stubGlobal('localStorage', storage)
    writeSharedBusinessStorageJournal({
      version: 1,
      acknowledgedRevision: 6,
      acknowledgedEntries: { [DESIGN_REGISTRY_KEY]: remoteRegistry },
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })
    const write = vi.fn().mockRejectedValue(new Error('write unavailable'))
    ;(window as unknown as { kunGui: unknown }).kunGui = {
      sharedClientState: {
        read: vi.fn(async () => ({
          revision: 6,
          value: { [DESIGN_REGISTRY_KEY]: remoteRegistry }
        })),
        write
      },
      appEnvironment: { flavor: 'development' }
    }

    await installSharedBusinessStorage()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(6))
    await Promise.resolve()
    await Promise.resolve()

    expect(write).toHaveBeenCalledTimes(6)
    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(localRegistry)
    expect(JSON.parse(storage.getItem(SHARED_BUSINESS_STORAGE_JOURNAL_KEY) ?? '{}')).toMatchObject({
      dirtyKeys: [DESIGN_REGISTRY_KEY]
    })
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  it('protects a newer local registry written while its previous value is being committed', async () => {
    const storage = new MemoryStorage()
    const remoteRegistry = '{"version":1,"workspaces":{}}'
    const firstLocalRegistry = '{"version":1,"workspaces":{"drawing-1":{}}}'
    const latestLocalRegistry = '{"version":1,"workspaces":{"drawing-2":{}}}'
    storage.setItem(DESIGN_REGISTRY_KEY, firstLocalRegistry)
    vi.stubGlobal('localStorage', storage)

    const pendingWrite = deferred<{ revision: number; value: Record<string, string> }>()
    const write = vi.fn(() => pendingWrite.promise)
    const syncing = syncSharedBusinessStorageOnce({
      read: vi.fn(async () => ({
        revision: 3,
        value: { [DESIGN_REGISTRY_KEY]: remoteRegistry }
      })),
      write
    }, {
      baseline: { [DESIGN_REGISTRY_KEY]: remoteRegistry },
      revision: 3
    })

    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    storage.setItem(DESIGN_REGISTRY_KEY, latestLocalRegistry)
    pendingWrite.resolve({
      revision: 4,
      value: { [DESIGN_REGISTRY_KEY]: firstLocalRegistry }
    })

    const result = await syncing

    expect(storage.getItem(DESIGN_REGISTRY_KEY)).toBe(latestLocalRegistry)
    expect(result.baseline[DESIGN_REGISTRY_KEY]).toBe(firstLocalRegistry)
    expect(result.retry).toBe(true)
  })
})
