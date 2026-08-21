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

  it('shares manager-backed settings revisions across independent profiles', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-shared-settings-'))
    let revision = 0
    let value: string | null = null
    const backend = {
      async read() {
        return { revision, value }
      },
      async write(expectedRevision: number, next: string) {
        if (expectedRevision !== revision) throw new Error('revision conflict')
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    const production = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    const development = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    expect((await development.load()).locale).toBe('en')
    await production.patch({ locale: 'zh' })
    expect((await development.load()).locale).toBe('zh')
  })

  it('serializes concurrent patches so stale full snapshots cannot overwrite sibling intent', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-serialized-settings-'))
    let revision = 0
    let value: string | null = null
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    let writes = 0
    const backend = {
      async read() {
        return { revision, value }
      },
      async write(expectedRevision: number, next: string) {
        writes += 1
        if (writes === 1) await firstWriteGate
        if (expectedRevision !== revision) throw new Error('revision conflict')
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    const store = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    await store.load()

    const runtimePatch = store.patch({ agents: { kun: { model: 'deepseek-reasoner' } } })
    const unrelatedPatch = store.patch({ locale: 'zh' })
    await vi.waitFor(() => expect(writes).toBe(1))
    expect(writes).toBe(1)

    releaseFirstWrite()
    await expect(Promise.all([runtimePatch, unrelatedPatch])).resolves.toHaveLength(2)

    const saved = await store.load()
    expect(saved.agents.kun.model).toBe('deepseek-reasoner')
    expect(saved.locale).toBe('zh')
    expect(writes).toBe(2)
  })

  it('retains the last valid snapshot while an external edit contains invalid JSON', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-invalid-external-settings-'))
    let revision = 1
    let value: string | null = JSON.stringify({ version: 1, locale: 'zh' })
    const writes: string[] = []
    const backend = {
      async read() {
        return { revision, value }
      },
      async write(expectedRevision: number, next: string) {
        if (expectedRevision !== revision) throw new Error('revision conflict')
        writes.push(next)
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    const store = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    const valid = await store.load()
    value = '{invalid'
    revision += 1

    const retained = await store.load()

    expect(retained).toBe(valid)
    expect(retained.locale).toBe('zh')
    expect(writes).toEqual([])

    value = JSON.stringify({ version: 1, locale: 'en', theme: 'dark' })
    revision += 1
    await expect(store.load()).resolves.toMatchObject({ locale: 'en', theme: 'dark' })
  })

  it('retries a Manager revision conflict from the exact mutation snapshot', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-revision-retry-settings-'))
    let revision = 0
    let value: string | null = null
    let releaseFirstProfileWrite!: () => void
    let markFirstProfileWriteStarted!: () => void
    const firstProfileWriteGate = new Promise<void>((resolve) => { releaseFirstProfileWrite = resolve })
    const firstProfileWriteStarted = new Promise<void>((resolve) => { markFirstProfileWriteStarted = resolve })
    let gated = false
    const backend = {
      async read() {
        return { revision, value }
      },
      async write(expectedRevision: number, next: string) {
        const parsed = JSON.parse(next) as { agents?: { kun?: { model?: string } } }
        if (!gated && expectedRevision === 0 && parsed.agents?.kun?.model === 'deepseek-reasoner') {
          gated = true
          markFirstProfileWriteStarted()
          await firstProfileWriteGate
        }
        if (expectedRevision !== revision) {
          const conflict = new Error('revision conflict') as Error & { currentRevision: number }
          conflict.name = 'ManagerRevisionConflictError'
          conflict.currentRevision = revision
          throw conflict
        }
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    const production = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    const development = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    await Promise.all([production.load(), development.load()])

    const productionPatch = production.patch({ agents: { kun: { model: 'deepseek-reasoner' } } })
    await firstProfileWriteStarted
    await development.patch({ locale: 'zh' })
    releaseFirstProfileWrite()
    await productionPatch

    const saved = await production.load()
    expect(saved.agents.kun.model).toBe('deepseek-reasoner')
    expect(saved.locale).toBe('zh')
    expect(revision).toBe(2)
  })

  it('re-checks an updateIf guard after a Manager revision conflict', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-conditional-retry-settings-'))
    let revision = 0
    let value: string | null = null
    let releaseGuardedWrite!: () => void
    let markGuardedWriteStarted!: () => void
    const guardedWriteGate = new Promise<void>((resolve) => { releaseGuardedWrite = resolve })
    const guardedWriteStarted = new Promise<void>((resolve) => { markGuardedWriteStarted = resolve })
    let gated = false
    const backend = {
      async read() {
        return { revision, value }
      },
      async write(expectedRevision: number, next: string) {
        const parsed = JSON.parse(next) as { agents?: { kun?: { model?: string } } }
        if (!gated && expectedRevision === 0 && parsed.agents?.kun?.model === 'deepseek-reasoner') {
          gated = true
          markGuardedWriteStarted()
          await guardedWriteGate
        }
        if (expectedRevision !== revision) {
          const conflict = new Error('revision conflict') as Error & { currentRevision: number }
          conflict.name = 'ManagerRevisionConflictError'
          conflict.currentRevision = revision
          throw conflict
        }
        value = next
        revision += 1
        return { revision, value: next }
      }
    }
    const production = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    const development = new JsonSettingsStore(userDataDir, { documentBackend: backend })
    await Promise.all([production.load(), development.load()])

    const guarded = production.updateIf(
      (current) => current.locale === 'en',
      (current) => ({
        ...current,
        agents: { kun: { ...current.agents.kun, model: 'deepseek-reasoner' } }
      })
    )
    await guardedWriteStarted
    await development.patch({ locale: 'zh' })
    releaseGuardedWrite()

    await expect(guarded).resolves.toMatchObject({ applied: false })
    const saved = await production.load()
    expect(saved.locale).toBe('zh')
    expect(saved.agents.kun.model).not.toBe('deepseek-reasoner')
    expect(revision).toBe(1)
  })

  it('defaults GUI updates to the stable channel for new settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.guiUpdate.channel).toBe(DEFAULT_GUI_UPDATE_CHANNEL)
    expect(loaded.agents.kun).toEqual(expect.objectContaining({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'user'
    }))
    expect(loaded.checkpointCleanup.intervalDays).toBe(DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS)
    // Checkpoint cleanup is enabled by default to keep stale checkpoints from accumulating.
    expect(loaded.checkpointCleanup.enabled).toBe(DEFAULT_CHECKPOINT_CLEANUP_ENABLED)
    expect(loaded.checkpointCleanup.createEnabled).toBe(DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED)
    expect(loaded.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      useSystemTitleBar: false,
      closeAction: 'ask',
      closeToTray: false
    })
  })

  it('patches and normalizes checkpoint cleanup settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const patched = await store.patch({ checkpointCleanup: { intervalDays: 5 } })
    expect(patched.checkpointCleanup.intervalDays).toBe(5)

    const clamped = await store.patch({
      checkpointCleanup: { intervalDays: 99 as unknown as typeof patched.checkpointCleanup.intervalDays }
    })
    expect(clamped.checkpointCleanup.intervalDays).toBe(10)
  })

  it('patches one notification source without resetting sibling preferences', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)

    const mainDisabled = await store.patch({
      notifications: { mainAgentTurnComplete: false }
    })
    expect(mainDisabled.notifications).toEqual({
      turnComplete: true,
      mainAgentTurnComplete: false,
      subagentTurnComplete: false
    })

    const subagentEnabled = await store.patch({
      notifications: { subagentTurnComplete: true }
    })
    expect(subagentEnabled.notifications).toEqual({
      turnComplete: true,
      mainAgentTurnComplete: false,
      subagentTurnComplete: true
    })
  })

  it('creates the app-managed default workspaces and welcome file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const homeDir = await mkdtemp(join(tmpdir(), 'ds-gui-home-'))

    await withMockedHome(homeDir, async ({ JsonSettingsStore: Store }) => {
      const store = new Store(userDataDir)
      const loaded = await store.load()

      expect(loaded.write.defaultWorkspaceRoot).toContain('.kun')
      expect(loaded.write.workspaces).toContain(loaded.write.defaultWorkspaceRoot)
      expect(loaded.write.inlineCompletion.enabled).toBe(true)
      expect(loaded.write.inlineCompletion.retrievalEnabled).toBe(true)
      expect(loaded.write.inlineCompletion.longCompletionEnabled).toBe(true)
      expect(loaded.provider.baseUrl).toBe('https://api.deepseek.com')
      expect(loaded.write.inlineCompletion.apiKey).toBe('')
      expect(loaded.write.inlineCompletion.baseUrl).toBe('')
      expect(loaded.write.inlineCompletion.inheritModel).toBe(true)
      expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-flash')
      expect(loaded.write.inlineCompletion.longMaxTokens).toBe(256)
      expect((await stat(loaded.workspaceRoot)).isDirectory()).toBe(true)
      expect((await stat(loaded.write.defaultWorkspaceRoot)).isDirectory()).toBe(true)
      expect((await stat(loaded.conversationWorkspaceRoot)).isDirectory()).toBe(true)
      expect(await readFile(join(loaded.write.defaultWorkspaceRoot, 'welcome.md'), 'utf8'))
        .toContain('Welcome to Work')
    })
  })

  it('preserves the pro write completion model', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-pro'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion.inheritModel).toBe(false)
    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-pro')
  })

  it('preserves disabled Skill IDs when settings are reloaded', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        disabledSkillIds: ['test-skill-08', '/skill:test-skill-09', '']
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.disabledSkillIds).toEqual(['test-skill-08', 'test-skill-09'])
  })

  it('treats legacy flash defaults as inherited until the user explicitly overrides them', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-flash'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion.inheritModel).toBe(true)
    expect(loaded.write.inlineCompletion.model).toBe('deepseek-v4-flash')
  })

  it('migrates legacy deepseek.autoStart=false into Kun', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot,
        deepseek: {
          autoStart: false
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.kun.autoStart).toBe(false)
  })

  it('migrates existing Kun credentials into General provider settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agents: {
          kun: {
            apiKey: 'sk-existing',
            baseUrl: 'https://runtime.example/v1'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.provider.apiKey).toBe('sk-existing')
    expect(loaded.provider.baseUrl).toBe('https://runtime.example/v1')
    expect(loaded.agents.kun.apiKey).toBe('')
    expect(loaded.agents.kun.baseUrl).toBe('')
  })

  it('keeps custom model providers when migrated settings are reloaded', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    const provider = defaultModelProviderSettings()

    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        provider: {
          apiKey: 'sk-default',
          baseUrl: 'https://api.deepseek.com',
          providers: [
            ...provider.providers,
            {
              id: 'custom-provider-2',
              name: 'Custom Provider',
              apiKey: 'sk-custom',
              baseUrl: 'https://custom.example/v1',
              endpointFormat: 'messages',
              models: ['custom-model']
            }
          ]
        },
        agents: {
          kun: {
            ...defaultKunRuntimeSettings(),
            providerId: 'custom-provider-2',
            model: 'custom-model'
          }
        }
      }),
      'utf8'
    )

    const firstStore = new JsonSettingsStore(userDataDir)
    const firstLoaded = await firstStore.load()

    expect(firstLoaded.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'messages',
          models: ['custom-model']
        })
      ])
    )
    expect(firstLoaded.agents.kun.providerId).toBe('custom-provider-2')
    await firstStore.save(firstLoaded)

    const secondStore = new JsonSettingsStore(userDataDir)
    const secondLoaded = await secondStore.load()

    expect(secondLoaded.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'messages',
          models: ['custom-model']
        })
      ])
    )
    expect(secondLoaded.agents.kun.providerId).toBe('custom-provider-2')
  })

  it('preserves route pools, local gateway state, and account sources across restart and unrelated patches', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-routes-'))
    const initialStore = new JsonSettingsStore(userDataDir)
    const initial = await initialStore.load()
    const provider = {
      id: 'kimi-code',
      name: 'Kimi Code',
      presetSource: { presetId: 'kimi-code', mode: 'api' as const },
      apiKey: 'sk-kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      endpointFormat: 'chat_completions' as const,
      models: ['kimi-for-coding'],
      modelProfiles: {}
    }
    const routePool = {
      id: 'kimi-route',
      name: 'Kimi Route',
      modelId: 'kimi-auto',
      enabled: true,
      strategy: 'priority' as const,
      targets: [{ id: 'kimi-primary', providerId: provider.id, modelId: provider.models[0], enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
      healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
    }

    await initialStore.save({
      ...initial,
      provider: {
        ...initial.provider,
        providers: [...initial.provider.providers, provider],
        routePools: [routePool],
        localGateway: { enabled: true, name: 'Team Relay' }
      }
    })

    const restarted = new JsonSettingsStore(userDataDir)
    const loaded = await restarted.load()
    expect(loaded.provider.routePools).toEqual([routePool])
    expect(loaded.provider.localGateway).toEqual({ enabled: true, name: 'Team Relay' })
    expect(loaded.provider.providers.find((item) => item.id === provider.id)?.presetSource)
      .toEqual(provider.presetSource)

    await restarted.patch({ theme: 'dark' })
    const afterUnrelatedPatch = await new JsonSettingsStore(userDataDir).load()
    expect(afterUnrelatedPatch.provider.routePools).toEqual([routePool])
    expect(afterUnrelatedPatch.provider.localGateway).toEqual({ enabled: true, name: 'Team Relay' })
  })
})
