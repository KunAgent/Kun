import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RevisionedDocumentStore } from '../../kun/src/manager/revisioned-document-store.js'
import { LegacyProviderSettingsMigrationCoordinator } from './legacy-provider-settings-migration'
import { JsonSettingsStore } from './settings-store'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-close-manager-'))
  const settingsPath = join(root, 'kun-settings.json')
  const dataDir = join(root, 'runtime-data')
  await mkdir(dataDir)
  const original = {
    version: 1, locale: 'zh', theme: 'dark',
    agents: { kun: { dataDir } },
    appBehavior: { closeAction: 'tray', closeToTray: true, openAtLogin: true, startMinimized: true, keepAwake: true },
    preservedFutureField: { untouched: true }
  }
  await writeFile(settingsPath, JSON.stringify(original))
  const documents = new RevisionedDocumentStore({ settingsPath, clientStatePath: join(root, 'client-state.json') })
  const backend = {
    read: vi.fn(() => documents.read('settings')),
    write: vi.fn((expectedRevision: number, value: string) => documents.write({ key: 'settings', expectedRevision, value }))
  }
  return { root, settingsPath, dataDir, original, backend }
}

describe('Manager-backed close behavior migration with credential coordination', () => {
  it('commits only close fields through the Manager document when credential preparation is unavailable', async () => {
    const test = await fixture()
    const migration = new LegacyProviderSettingsMigrationCoordinator(async () => { throw new Error('Protected credential store unavailable') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const loaded = await new JsonSettingsStore(test.root, { documentBackend: test.backend, credentialMigration: migration }).load()
      expect(loaded.appBehavior.closeAction).toBe('quit')
      expect(test.backend.write).toHaveBeenCalledOnce()
      expect(test.backend.write.mock.calls[0][0]).toBe(1)
      expect(JSON.parse(await readFile(test.settingsPath, 'utf8'))).toEqual({
        ...test.original, appBehavior: { ...test.original.appBehavior, closeAction: 'quit', closeToTray: false }
      })
      const reopened = await new JsonSettingsStore(test.root, { documentBackend: test.backend, credentialMigration: migration }).load()
      expect(reopened.appBehavior).toEqual(loaded.appBehavior)
      expect(test.backend.write).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
      await rm(test.root, { recursive: true, force: true })
    }
  })

  it('retries rather than caching a migration whose Manager commit failed', async () => {
    const test = await fixture()
    const migration = new LegacyProviderSettingsMigrationCoordinator(async () => { throw new Error('Credential store unavailable') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    test.backend.write.mockRejectedValueOnce(new Error('Manager document unavailable'))
    const store = new JsonSettingsStore(test.root, { documentBackend: test.backend, credentialMigration: migration })
    try {
      await expect(store.load()).rejects.toThrow('Manager document unavailable')
      expect(JSON.parse(await readFile(test.settingsPath, 'utf8')).appBehavior.closeAction).toBe('tray')
      expect((await store.load()).appBehavior.closeAction).toBe('quit')
      expect(test.backend.write).toHaveBeenCalledTimes(2)
      expect(JSON.parse(await readFile(test.settingsPath, 'utf8')).appBehavior.closeAction).toBe('quit')
    } finally {
      warn.mockRestore()
      await rm(test.root, { recursive: true, force: true })
    }
  })

  it('keeps legacy plaintext migration fail-closed even when close preferences need migration', async () => {
    const test = await fixture()
    const original = { ...test.original, provider: { apiKey: 'existing-test-key' } }
    await writeFile(test.settingsPath, JSON.stringify(original))
    const migration = new LegacyProviderSettingsMigrationCoordinator(async () => { throw new Error('Protected credential store unavailable') })
    try {
      await expect(new JsonSettingsStore(test.root, { documentBackend: test.backend, credentialMigration: migration }).load())
        .rejects.toThrow('could not be moved to protected storage')
      expect(test.backend.write).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(test.settingsPath, 'utf8'))).toEqual(original)
    } finally {
      await rm(test.root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('uses the canonical Registry directory when GUI settings contain a symlink alias', async () => {
    const test = await fixture()
    const alias = join(test.root, 'runtime-alias')
    await symlink(test.dataDir, alias)
    await writeFile(test.settingsPath, JSON.stringify({ ...test.original, agents: { kun: { dataDir: alias } } }))
    const factory = vi.fn(async () => ({
      service: {
        migrate: async () => [], listBindings: async () => [], resolveApiKey: async () => null,
        markSettingsCommitted: async () => undefined, rollbackPending: async () => undefined
      } as never,
      modelConnections: {} as never,
      resolveRegistryCredential: async () => ({ authoritative: false, apiKey: '' })
    }))
    const migration = new LegacyProviderSettingsMigrationCoordinator(factory)
    try {
      const loaded = await new JsonSettingsStore(test.root, { documentBackend: test.backend, credentialMigration: migration }).load()
      expect(factory).toHaveBeenCalledWith(await realpath(test.dataDir))
      expect(loaded.appBehavior.closeAction).toBe('quit')
      expect(JSON.parse(await readFile(test.settingsPath, 'utf8')).appBehavior.closeAction).toBe('quit')
    } finally {
      await rm(test.root, { recursive: true, force: true })
    }
  })
})
