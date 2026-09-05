import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings
} from '../shared/app-settings'
import { DEFAULT_GUI_UPDATE_CHANNEL } from '../shared/gui-update'
import { devServerHintUrl, JsonSettingsStore } from './settings-store'

type SettingsStoreModule = typeof import('./settings-store')

async function withMockedHome<T>(
  homeDir: string,
  run: (settingsStore: SettingsStoreModule) => Promise<T>
): Promise<T> {
  vi.resetModules()
  vi.doMock('node:os', () => ({ homedir: () => homeDir }))
  try {
    return await run(await import('./settings-store'))
  } finally {
    vi.doUnmock('node:os')
    vi.resetModules()
  }
}

describe('JsonSettingsStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves current routing extensions while migrating mixed legacy settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-routes-legacy-'))
    const provider = {
      id: 'kimi-code',
      name: 'Kimi Code',
      presetSource: { presetId: 'kimi-code', mode: 'api' },
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: ['kimi-for-coding'],
      modelProfiles: {}
    }
    const routePool = {
      id: 'mixed-route', name: 'Mixed Route', modelId: 'mixed-auto', enabled: true, strategy: 'priority',
      targets: [{ id: 'mixed-target', providerId: provider.id, modelId: provider.models[0], enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    }
    await writeFile(join(userDataDir, 'deepseek-gui-settings.json'), JSON.stringify({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: { autoStart: false },
      provider: {
        providers: [provider],
        routePools: [routePool],
        localGateway: { enabled: true, name: 'Legacy Relay' }
      }
    }), 'utf8')

    const loaded = await new JsonSettingsStore(userDataDir).load()
    expect(loaded.agents.kun.autoStart).toBe(false)
    expect(loaded.provider.routePools).toEqual([routePool])
    expect(loaded.provider.localGateway).toEqual({ enabled: true, name: 'Legacy Relay' })
    expect(loaded.provider.providers.find((item) => item.id === provider.id)?.presetSource)
      .toEqual(provider.presetSource)
  })

  it('loads settings from the legacy lowercase userData directory and writes them into the current path', async () => {
    const supportRoot = await mkdtemp(join(tmpdir(), 'ds-gui-settings-compat-'))
    const legacyUserDataDir = join(supportRoot, 'deepseek-gui')
    const currentUserDataDir = join(supportRoot, 'Kun')
    const currentSettingsPath = join(currentUserDataDir, 'kun-settings.json')

    await mkdir(legacyUserDataDir, { recursive: true })
    await writeFile(
      join(legacyUserDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        provider: {
          apiKey: 'sk-legacy-provider'
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(currentUserDataDir)
    const loaded = await store.load()

    expect(loaded.provider.apiKey).toBe('sk-legacy-provider')
    expect(await readFile(currentSettingsPath, 'utf8')).toContain('sk-legacy-provider')
  })

  it('preserves a missing configured code workspace without creating it', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const homeDir = await mkdtemp(join(tmpdir(), 'ds-gui-home-'))
    const workspaceRoot = join(userDataDir, 'missing-workspace')
    const writeWorkspaceRoot = join(userDataDir, 'missing-write-workspace')
    const conversationWorkspaceRoot = join(userDataDir, 'missing-conversation-workspace')
    const clawChannelWorkspaceRoot = join(userDataDir, 'missing-claw-channel')
    const clawConversationWorkspaceRoot = join(userDataDir, 'missing-claw-conversation')

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot,
        conversationWorkspaceRoot,
        write: {
          defaultWorkspaceRoot: writeWorkspaceRoot,
          activeWorkspaceRoot: writeWorkspaceRoot,
          workspaces: [writeWorkspaceRoot]
        },
        claw: {
          channels: [{
            id: 'channel-1',
            provider: 'feishu',
            workspaceRoot: clawChannelWorkspaceRoot,
            conversations: [{
              id: 'conversation-1',
              chatId: 'chat-1',
              latestMessageId: 'message-1',
              workspaceRoot: clawConversationWorkspaceRoot
            }]
          }]
        }
      }),
      'utf8'
    )

    await withMockedHome(homeDir, async ({ JsonSettingsStore: Store }) => {
      const store = new Store(userDataDir)
      const loaded = await store.load()

      expect(loaded.workspaceRoot).toBe(workspaceRoot)
      expect(loaded.write.defaultWorkspaceRoot).toBe(writeWorkspaceRoot)
      expect(loaded.conversationWorkspaceRoot).toBe(conversationWorkspaceRoot)
      expect(loaded.claw.channels[0]?.workspaceRoot).toBe(clawChannelWorkspaceRoot)
      expect(loaded.claw.channels[0]?.conversations[0]?.workspaceRoot).toBe(clawConversationWorkspaceRoot)
      await expect(stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(writeWorkspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(conversationWorkspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(clawChannelWorkspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(clawConversationWorkspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await stat(join(homeDir, '.kun', 'default_workspace'))).isDirectory()).toBe(true)
      expect((await stat(join(homeDir, '.kun', 'write_workspace'))).isDirectory()).toBe(true)
    })
  })

  it('does not replace an unavailable configured workspace on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const blockedParent = join(userDataDir, 'disconnected-drive')
    const unavailableWorkspaceRoot = join(blockedParent, 'project')
    const settingsPath = join(userDataDir, 'kun-settings.json')

    await writeFile(blockedParent, 'not a directory', 'utf8')
    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        workspaceRoot: unavailableWorkspaceRoot
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
    expect(loaded.workspaceRoot).toBe(unavailableWorkspaceRoot)
    expect(persisted.workspaceRoot).toBe(unavailableWorkspaceRoot)
  })

  it('does not hide app-managed default workspace creation failures', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const homeRoot = await mkdtemp(join(tmpdir(), 'ds-gui-home-parent-'))
    const homeDir = join(homeRoot, 'home-is-a-file')

    await writeFile(homeDir, 'not a directory', 'utf8')

    await withMockedHome(homeDir, async ({ JsonSettingsStore: Store }) => {
      const store = new Store(userDataDir)
      await expect(store.load()).rejects.toThrow(/ENOTDIR|not a directory|mkdir/i)
    })
  })

  it('migrates legacy deepseek-runtime agentProvider to Kun', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        deepseek: { port: 18787 }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.kun.port).toBe(18787)
  })

  it('backs up invalid JSON and replaces it with defaults', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    await writeFile(settingsPath, '{ invalid json', 'utf8')

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const files = await readdir(userDataDir)
    const backupName = files.find((file) => file.startsWith('deepseek-gui-settings.invalid-'))

    expect(loaded.workspaceRoot.length).toBeGreaterThan(0)
    expect(backupName).toBeTruthy()
    expect(await readFile(join(userDataDir, backupName ?? ''), 'utf8')).toBe('{ invalid json')
    // 兜底默认值写进新文件名;旧文件保留原状(已经另有 invalid 备份)。
    const replaced = await readFile(join(userDataDir, 'kun-settings.json'), 'utf8')
    expect(() => JSON.parse(replaced)).not.toThrow()
  })

  it('backs up non-object settings JSON and replaces it with defaults', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'kun-settings.json')
    await writeFile(settingsPath, 'null', 'utf8')

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const files = await readdir(userDataDir)
    const backupName = files.find((file) => file.startsWith('kun-settings.invalid-'))

    expect(loaded.workspaceRoot.length).toBeGreaterThan(0)
    expect(backupName).toBeTruthy()
    expect(await readFile(join(userDataDir, backupName ?? ''), 'utf8')).toBe('null')
    const replaced = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
    expect(replaced.version).toBe(1)
  })

  it('never persists plaintext credentials when protected storage is unavailable', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir, {
      rejectPlaintextCredentials: true
    })

    const settingsWithSecret = await store.load()
    settingsWithSecret.provider.apiKey = 'plaintext-secret'
    settingsWithSecret.provider.providers[0].apiKey = 'plaintext-secret'
    await expect(store.save(settingsWithSecret))
      .rejects.toThrow(/plaintext credentials were not written/)

    const settingsPath = join(userDataDir, 'kun-settings.json')
    await expect(readFile(settingsPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed without caching plaintext when the protected backup cannot be created', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-backup-fail-'))
    const secret = 'backup-failure-secret'
    const plainStore = new JsonSettingsStore(userDataDir)
    const defaults = await plainStore.load()
    await plainStore.save({
      ...defaults,
      provider: { ...defaults.provider, apiKey: secret }
    })
    const settingsPath = join(userDataDir, 'kun-settings.json')
    const original = await readFile(settingsPath, 'utf8')
    await mkdir(join(userDataDir, 'kun-settings.pre-extension-credential-migration.json'))
    const prepare = vi.fn()
    const store = new JsonSettingsStore(userDataDir, {
      credentialMigration: { prepare }
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await store.load().catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toMatch(/protected settings backup could not be written/)
      expect(String(error)).not.toContain(secret)
    }
    expect(prepare).not.toHaveBeenCalled()
    expect(await readFile(settingsPath, 'utf8')).toBe(original)
  })

  it('fails closed and retries when credential prepare cannot reach Registry authority', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-prepare-fail-'))
    const secret = 'prepare-failure-secret'
    const plainStore = new JsonSettingsStore(userDataDir)
    const defaults = await plainStore.load()
    await plainStore.save({
      ...defaults,
      provider: { ...defaults.provider, apiKey: secret }
    })
    const settingsPath = join(userDataDir, 'kun-settings.json')
    const original = await readFile(settingsPath, 'utf8')
    const prepare = vi.fn(async () => { throw new Error('Registry CAS unavailable') })
    const store = new JsonSettingsStore(userDataDir, {
      credentialMigration: { prepare }
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await store.load().catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toMatch(/could not be moved to protected storage/)
      expect(String(error)).not.toContain(secret)
    }
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(await readFile(settingsPath, 'utf8')).toBe(original)
  })

  it('rolls back and never caches plaintext when secret-free settings persist fails', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-settings-persist-fail-'))
    const secret = 'persist-failure-secret'
    const defaults = await new JsonSettingsStore(userDataDir).load()
    const runtimeSettings = {
      ...defaults,
      provider: { ...defaults.provider, apiKey: secret }
    }
    const persistedSettings = {
      ...runtimeSettings,
      provider: { ...runtimeSettings.provider, apiKey: '' }
    }
    const raw = JSON.stringify(runtimeSettings)
    const backend = {
      read: vi.fn(async () => ({ revision: 4, value: raw })),
      write: vi.fn(async () => { throw new Error('Manager document write failed') })
    }
    const rollback = vi.fn(async () => undefined)
    const prepare = vi.fn(async () => ({
      runtimeSettings,
      persistedSettings,
      sourceIdsToCommit: ['settings:provider:deepseek'],
      removedPlaintext: true,
      rollback,
      commit: async () => undefined
    }))
    const store = new JsonSettingsStore(userDataDir, {
      documentBackend: backend,
      credentialMigration: { prepare }
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await store.load().catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toMatch(/could not commit secret-free settings/)
      expect(String(error)).not.toContain(secret)
    }
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(rollback).toHaveBeenCalledTimes(2)
    expect(backend.read).toHaveBeenCalledTimes(2)
    expect(backend.write).toHaveBeenCalledTimes(2)
    expect(raw).toContain(secret)
  })
})
