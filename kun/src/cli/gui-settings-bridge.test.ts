import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import { publishRuntimeDiscovery } from '../server/runtime-discovery.js'
import {
  acquireRuntimeDataDirMigrationLock,
  runtimeDataDirClaimsPath
} from '../server/runtime-data-dir-migration-lock.js'
import {
  acquireRuntimeDataDirLease,
  RUNTIME_DATA_DIR_OWNER_FILE
} from '../server/runtime-data-dir-lease.js'
import {
  hasUnpublishedGuiRuntime,
  modelConnectionSnapshotFromGuiSettings,
  projectModelSelectionToGuiSettings,
  readGuiSharedSettings,
  resolveLegacyGuiRuntime,
  syncGuiProviderCatalogToConfig
} from './gui-settings-bridge.js'

describe('GUI settings bridge', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('discovers the GUI data dir and strips credential fields from the parsed catalog', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })

    expect(settings).toMatchObject({
      dataDir: fixture.dataDir,
      defaultProviderId: 'codex',
      defaultModel: 'gpt-5.6-luna',
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'danger-full-access',
      defaultApprovalReviewer: 'agent'
    })
    expect(settings?.providers.map((provider) => provider.id)).toEqual(['deepseek', 'codex', 'kimi-code'])
    expect(settings?.providers[1]).not.toHaveProperty('apiKey')
    expect(settings?.providers[1]?.modelProfiles?.['gpt-5.6-luna']?.reasoning).toEqual({
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'low',
      requestProtocol: 'openai-responses'
    })
  })

  it('ignores GUI settings from a newer schema without rewriting them', async () => {
    const fixture = await createFixture()
    const raw = JSON.stringify({
      version: 2,
      agents: { kun: { dataDir: fixture.dataDir } },
      futureProviderState: { keep: true }
    })
    await writeFile(fixture.settingsPath, raw, 'utf8')

    await expect(readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })).resolves.toBeNull()
    await expect(readFile(fixture.settingsPath, 'utf8')).resolves.toBe(raw)
  })

  it('fails closed instead of falling back when the primary candidate is newer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'kun-gui-settings-newer-primary-'))
    roots.push(home)
    const supportDir = join(home, 'Library', 'Application Support')
    const currentPath = join(supportDir, 'Kun', 'kun-settings.json')
    const stalePath = join(supportDir, 'DeepSeek GUI', 'kun-settings.json')
    await mkdir(join(supportDir, 'Kun'), { recursive: true })
    await mkdir(join(supportDir, 'DeepSeek GUI'), { recursive: true })
    await writeFile(currentPath, JSON.stringify({ version: 2, future: true }), 'utf8')
    await writeFile(stalePath, JSON.stringify({
      provider: { providers: [] },
      agents: { kun: { dataDir: join(home, '.kun', 'data') } }
    }), 'utf8')

    await expect(readGuiSharedSettings({ env: {}, platform: 'darwin', homeDir: home }))
      .resolves.toBeNull()
  })

  it('keeps the current GUI profile authoritative when it contains a newer provider transport', async () => {
    const home = await mkdtemp(join(tmpdir(), 'kun-gui-settings-forward-compatible-'))
    roots.push(home)
    const supportDir = join(home, 'Library', 'Application Support', 'Kun')
    const currentPath = join(supportDir, 'kun-settings.json')
    const stalePath = join(supportDir, 'deepseek-gui-settings.json')
    const dataDir = join(home, '.deepseekgui', 'kun')
    await mkdir(supportDir, { recursive: true })
    await writeFile(currentPath, JSON.stringify({
      provider: {
        providers: [
          {
            id: 'deepseek', name: 'DeepSeek', apiKey: 'current-secret',
            baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
            models: ['deepseek-v4-pro']
          },
          {
            id: 'gemini-subscription', name: 'Gemini subscription', apiKey: 'oauth-json',
            kind: 'gemini-code-assist', baseUrl: 'https://cloudcode-pa.googleapis.com',
            endpointFormat: 'custom_endpoint', models: ['gemini-3.1-pro-preview']
          },
          {
            id: 'future-provider', name: 'Future provider', apiKey: 'future-secret',
            kind: 'transport-from-the-future', baseUrl: 'https://future.invalid',
            endpointFormat: 'chat_completions', models: ['future-model']
          }
        ]
      },
      agents: {
        kun: {
          dataDir, providerId: 'gemini-subscription', model: 'gemini-3.1-pro-preview',
          port: 18899, runtimeToken: 'current-runtime-token'
        }
      }
    }), 'utf8')
    await writeFile(stalePath, JSON.stringify({
      provider: {
        providers: [{
          id: 'deepseek', name: 'DeepSeek', apiKey: 'stale-secret',
          baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
          models: ['deepseek-v4-pro']
        }]
      },
      agents: {
        kun: {
          dataDir: join(home, '.kun', 'data'), providerId: 'deepseek', model: 'deepseek-v4-pro',
          port: 7878, runtimeToken: 'stale-runtime-token'
        }
      }
    }), 'utf8')

    const settings = await readGuiSharedSettings({
      env: {},
      platform: 'darwin',
      homeDir: home
    })

    expect(settings).toMatchObject({
      settingsPath: currentPath,
      dataDir,
      defaultProviderId: 'gemini-subscription',
      defaultModel: 'gemini-3.1-pro-preview'
    })
    expect(settings?.providers.map((provider) => [provider.id, provider.kind])).toEqual([
      ['deepseek', 'http'],
      ['gemini-subscription', 'gemini-code-assist']
    ])
    expect(JSON.stringify(settings)).not.toContain('current-secret')
    expect(JSON.stringify(settings)).not.toContain('oauth-json')
    expect(JSON.stringify(settings)).not.toContain('future-secret')

    const snapshot = modelConnectionSnapshotFromGuiSettings(settings!)
    expect(snapshot.providers.map((provider) => [provider.id, provider.kind])).toEqual([
      ['deepseek', 'http'],
      ['gemini-subscription', 'gemini-code-assist']
    ])
    const result = await syncGuiProviderCatalogToConfig(dataDir, settings!)
    expect(result?.config.serve.providers?.['gemini-subscription']).toMatchObject({
      kind: 'gemini-code-assist',
      models: ['gemini-3.1-pro-preview']
    })
  })

  it('atomically projects every GUI model catalog without copying secrets', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    expect(settings).not.toBeNull()

    const result = await syncGuiProviderCatalogToConfig(fixture.dataDir, settings!)
    expect(result?.changed).toBe(true)
    const configPath = join(fixture.dataDir, 'config.json')
    const text = await readFile(configPath, 'utf8')
    const config = JSON.parse(text)
    expect(text).not.toContain('gui-secret')
    expect(config.serve).toMatchObject({
      credentialSourceId: 'settings:provider:codex',
      model: 'gpt-5.6-luna',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'agent'
    })
    expect(config.serve.providers.deepseek.models).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
    expect(config.serve.providers.codex.models).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol'])
    expect(config.serve.providers['kimi-code'].models).toEqual(['kimi-for-coding', 'kimi-for-coding-highspeed'])
    expect(config.serve.providers.codex.modelCapabilities['gpt-5.6-luna'].reasoning).toEqual({
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'low',
      requestProtocol: 'openai-responses'
    })
    expect(config.serve.providers.codex.apiKey).toBe('')
    expect(config.serve.providers.codex.credentialSourceId).toBe('settings:provider:codex')
    expect(config.capabilities.futureGuiCapability).toEqual({ enabled: true, protocol: 'future-v2' })
    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    }
    expect(result?.applyRequest.serve?.providers?.codex?.models).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol'])
    expect(result?.applyRequest.serve).toMatchObject({
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'agent'
    })
    expect(result?.applyRequest.modelSelection).toEqual({
      providerId: 'codex',
      model: 'gpt-5.6-luna'
    })
    expect(result?.applyRequest.models?.profiles?.['gpt-5.6-luna']?.reasoning).toEqual({
      supportedEfforts: ['low', 'high'],
      defaultEffort: 'low',
      requestProtocol: 'openai-responses'
    })
  })

  it('fails closed without changing config while migration owns the data dir', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    const configPath = join(fixture.dataDir, 'config.json')
    const before = await readFile(configPath, 'utf8')
    const migration = await acquireRuntimeDataDirMigrationLock(fixture.dataDir)
    try {
      await expect(syncGuiProviderCatalogToConfig(fixture.dataDir, settings!))
        .rejects.toThrow(/migration is active/)
      await expect(readFile(configPath, 'utf8')).resolves.toBe(before)
    } finally {
      await migration.release()
    }
  })

  it('fails closed without changing config while a legacy Runtime owner is live', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    const configPath = join(fixture.dataDir, 'config.json')
    const before = await readFile(configPath, 'utf8')
    await writeFile(join(fixture.dataDir, RUNTIME_DATA_DIR_OWNER_FILE), JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      token: 'legacy-runtime-owner',
      startedAt: new Date().toISOString()
    }))

    await expect(syncGuiProviderCatalogToConfig(fixture.dataDir, settings!))
      .rejects.toThrow(new RegExp(`active process ${process.pid}`))
    await expect(readFile(configPath, 'utf8')).resolves.toBe(before)
  })

  it('holds the legacy owner fence for the full config mutation', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    let entered!: () => void
    const claimAcquired = new Promise<void>((resolve) => { entered = resolve })
    let continueSync!: () => void
    const mayContinue = new Promise<void>((resolve) => { continueSync = resolve })
    const sync = syncGuiProviderCatalogToConfig(fixture.dataDir, settings!, {
      afterWriterClaimAcquired: async () => {
        entered()
        await mayContinue
      }
    })
    await claimAcquired

    const ownerPath = join(fixture.dataDir, RUNTIME_DATA_DIR_OWNER_FILE)
    await expect(open(ownerPath, 'wx', 0o600)).rejects.toMatchObject({ code: 'EEXIST' })
    continueSync()
    await expect(sync).resolves.toMatchObject({ changed: true })
    await expect(readFile(ownerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('safely reclaims a stale legacy owner before synchronizing config', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    const ownerPath = join(fixture.dataDir, RUNTIME_DATA_DIR_OWNER_FILE)
    await writeFile(ownerPath, JSON.stringify({
      schemaVersion: 1,
      pid: 2_147_483_647,
      token: 'stale-legacy-runtime-owner',
      startedAt: '2026-08-05T00:00:00.000Z'
    }))

    await expect(syncGuiProviderCatalogToConfig(fixture.dataDir, settings!))
      .resolves.toMatchObject({ changed: true })
    await expect(readFile(ownerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses an existing in-process writer authority without a second claim', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    const lease = await acquireRuntimeDataDirLease(fixture.dataDir)
    try {
      await expect(syncGuiProviderCatalogToConfig(fixture.dataDir, settings!, {
        writerAuthority: lease.authority
      })).resolves.toMatchObject({ changed: true })
      expect((await readdir(runtimeDataDirClaimsPath(fixture.dataDir)))
        .filter((name) => name.startsWith('claim-'))).toHaveLength(1)
    } finally {
      await lease.release()
    }
  })

  it('serializes authority-backed config mutations and makes release await the queue', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    const nextSettings = {
      ...settings!,
      defaultProviderId: 'kimi-code',
      defaultModel: 'kimi-for-coding-highspeed'
    }
    const lease = await acquireRuntimeDataDirLease(fixture.dataDir)
    let firstEntered!: () => void
    const firstAtWrite = new Promise<void>((resolve) => { firstEntered = resolve })
    let allowFirst!: () => void
    const firstMayWrite = new Promise<void>((resolve) => { allowFirst = resolve })
    let secondEntered!: () => void
    const secondAtWrite = new Promise<void>((resolve) => { secondEntered = resolve })
    let allowSecond!: () => void
    const secondMayWrite = new Promise<void>((resolve) => { allowSecond = resolve })
    let secondStarted = false
    const first = syncGuiProviderCatalogToConfig(fixture.dataDir, settings!, {
      writerAuthority: lease.authority,
      authoritative: true,
      beforeConfigWrite: async () => {
        firstEntered()
        await firstMayWrite
      }
    })
    await firstAtWrite
    const second = syncGuiProviderCatalogToConfig(fixture.dataDir, nextSettings, {
      writerAuthority: lease.authority,
      authoritative: true,
      beforeConfigWrite: async () => {
        secondStarted = true
        secondEntered()
        await secondMayWrite
      }
    })
    let releaseFinished = false
    const release = lease.release().then(() => { releaseFinished = true })

    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(secondStarted).toBe(false)
      expect(releaseFinished).toBe(false)
      allowFirst()
      await secondAtWrite
      expect(releaseFinished).toBe(false)
      allowSecond()
      await expect(Promise.all([first, second])).resolves.toHaveLength(2)
      await release
      expect(releaseFinished).toBe(true)
      const config = JSON.parse(await readFile(join(fixture.dataDir, 'config.json'), 'utf8'))
      expect(config.serve).toMatchObject({ model: 'kimi-for-coding-highspeed' })
    } finally {
      allowFirst()
      allowSecond()
      await Promise.allSettled([first, second, release])
    }
  })

  it('releases the short config claim when synchronization throws', async () => {
    const fixture = await createFixture()
    const settings = await readGuiSharedSettings({
      env: { KUN_GUI_SETTINGS_PATH: fixture.settingsPath },
      platform: 'darwin',
      homeDir: fixture.home
    })
    await writeFile(
      join(fixture.dataDir, 'config.json'),
      JSON.stringify({ serve: { port: -1 } }),
      'utf8'
    )

    await expect(syncGuiProviderCatalogToConfig(fixture.dataDir, settings!))
      .rejects.toThrow(/invalid serve config/)
    const migration = await acquireRuntimeDataDirMigrationLock(fixture.dataDir)
    await migration.release()
  })

  async function createFixture(): Promise<{
    home: string
    dataDir: string
    settingsPath: string
  }> {
    const home = await mkdtemp(join(tmpdir(), 'kun-gui-settings-bridge-'))
    roots.push(home)
    const dataDir = join(home, '.deepseekgui', 'kun')
    const settingsPath = join(home, 'Library', 'Application Support', 'Kun', 'kun-settings.json')
    await mkdir(join(dataDir, 'extensions'), { recursive: true })
    await mkdir(join(settingsPath, '..'), { recursive: true })
    await writeFile(settingsPath, JSON.stringify({
      provider: {
        providers: [
          {
            id: 'deepseek', name: 'DeepSeek', apiKey: 'gui-secret-deepseek',
            baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
            models: ['deepseek-v4-pro', 'deepseek-v4-flash']
          },
          {
            id: 'codex', name: 'ChatGPT subscription', apiKey: 'gui-secret-codex',
            baseUrl: 'https://chatgpt.com/backend-api/codex/responses', endpointFormat: 'custom_endpoint',
            models: ['gpt-5.6-luna', 'gpt-5.6-sol'],
            modelProfiles: {
              'gpt-5.6-luna': {
                contextWindowTokens: 372000,
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                supportsToolCalling: true,
                messageParts: ['text', 'image_url'],
                reasoning: {
                  supportedEfforts: ['low', 'high'],
                  defaultEffort: 'low',
                  requestProtocol: 'openai-responses'
                },
                responsesMode: 'lite'
              }
            }
          },
          {
            id: 'kimi-code', name: 'Kimi Code', apiKey: 'gui-secret-kimi',
            baseUrl: 'https://api.kimi.com/coding/v1', endpointFormat: 'chat_completions',
            models: ['kimi-for-coding', 'kimi-for-coding-highspeed']
          }
        ]
      },
      agents: {
        kun: {
          dataDir, providerId: 'codex', model: 'gpt-5.6-luna',
          port: 19999, runtimeToken: 'legacy-runtime-secret',
          approvalPolicy: 'auto', sandboxMode: 'danger-full-access',
          approvalReviewer: 'agent'
        }
      }
    }), 'utf8')
    await writeFile(join(dataDir, 'config.json'), JSON.stringify({
      serve: {
        apiKey: '',
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
        endpointFormat: 'custom_endpoint',
        credentialSourceId: 'settings:provider:codex',
        model: 'gpt-5.6-luna',
        providers: {
          deepseek: {
            apiKey: '', credentialSourceId: 'settings:provider:deepseek',
            baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions'
          },
          codex: {
            apiKey: '', credentialSourceId: 'settings:provider:codex',
            baseUrl: 'https://chatgpt.com/backend-api/codex/responses', endpointFormat: 'custom_endpoint'
          },
          'kimi-code': {
            apiKey: '', credentialSourceId: 'settings:provider:kimi-code',
            baseUrl: 'https://api.kimi.com/coding/v1', endpointFormat: 'chat_completions'
          }
        }
      },
      capabilities: {
        futureGuiCapability: { enabled: true, protocol: 'future-v2' }
      }
    }), 'utf8')
    return { home, dataDir, settingsPath }
  }
})
