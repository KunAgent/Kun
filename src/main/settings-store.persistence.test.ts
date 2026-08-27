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

it('ignores null entries in persisted Claw channels and schedule tasks', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'kun-settings.json'),
      JSON.stringify({
        version: 1,
        claw: {
          channels: [null]
        },
        schedule: {
          tasks: [null]
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.claw.channels).toEqual([])
    expect(loaded.schedule.tasks).toEqual([])
  })

  it('loads the legacy file name inside the current userData dir and re-saves it under the new name', async () => {
    // userData 整目录迁移后的常见形态:目录已经叫 Kun,里面还是旧文件名。
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({ version: 1, provider: { apiKey: 'sk-migrated' } }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.provider.apiKey).toBe('sk-migrated')
    const rewritten = await readFile(join(userDataDir, 'kun-settings.json'), 'utf8')
    expect(rewritten).toContain('sk-migrated')
    // 旧文件保留,回滚老版本时仍可读。
    expect(await readFile(join(userDataDir, 'deepseek-gui-settings.json'), 'utf8')).toContain('sk-migrated')
  })

  it('persists the versioned stream idle timeout migration for existing users', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'kun-settings.json')
    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        agents: {
          kun: {
            runtimeTuning: {
              maxConcurrentTurns: 256,
              maxWallTimeMs: 86_400_000,
              streamIdleTimeoutMs: 45_000
            }
          }
        }
      }),
      'utf8'
    )

    const loaded = await new JsonSettingsStore(userDataDir).load()
    expect(loaded.agents.kun.runtimeTuning).toMatchObject({
      defaultsVersion: 1,
      streamIdleTimeoutMs: 450_000
    })

    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      agents: { kun: { runtimeTuning: { defaultsVersion: number; streamIdleTimeoutMs: number } } }
    }
    expect(persisted.agents.kun.runtimeTuning).toMatchObject({
      defaultsVersion: 1,
      streamIdleTimeoutMs: 450_000
    })

    const reloaded = await new JsonSettingsStore(userDataDir).load()
    expect(reloaded.agents.kun.runtimeTuning).toMatchObject({
      defaultsVersion: 1,
      streamIdleTimeoutMs: 450_000
    })
  })

  it('throws for non-recoverable read errors', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'deepseek-gui-settings.json')
    await mkdir(settingsPath, { recursive: true })

    const store = new JsonSettingsStore(userDataDir)

    await expect(store.load()).rejects.toThrow(/Failed to read settings file/)
  })

  it('merges Kun settings patches', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const saved = await store.patch({
      agents: {
        kun: {
          model: 'deepseek-reasoner',
          approvalPolicy: 'on-request'
        }
      }
    })

    expect(saved.agents.kun.model).toBe('deepseek-reasoner')
    expect(saved.agents.kun.approvalPolicy).toBe('on-request')
  })

  it('persists Graphite defaults and preserves dark color siblings on partial patches', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    const initial = await store.load()

    expect(initial.darkUiColors).toEqual({
      background: '#181818',
      border: '#272727',
      panel: '#2c2c2c'
    })
    await store.patch({ darkUiColors: { background: '#101010', panel: '#303030' } })
    const saved = await store.patch({ darkUiColors: { border: '#AABBCC' } })

    expect(saved.darkUiColors).toEqual({
      background: '#101010',
      border: '#aabbcc',
      panel: '#303030'
    })
    expect((await new JsonSettingsStore(userDataDir).load()).darkUiColors).toEqual(saved.darkUiColors)
  })

  it('merges desktop behavior patches without keeping invalid startup state', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const enabled = await store.patch({
      appBehavior: {
        openAtLogin: true,
        startMinimized: true,
        useSystemTitleBar: true,
        closeAction: 'tray'
      }
    })
    const disabled = await store.patch({
      appBehavior: {
        openAtLogin: false,
        closeToTray: false
      }
    })

    expect(enabled.appBehavior).toEqual({
      openAtLogin: true,
      startMinimized: true,
      useSystemTitleBar: true,
      closeAction: 'tray',
      closeToTray: true
    })
    expect(disabled.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      useSystemTitleBar: true,
      closeAction: 'quit',
      closeToTray: false
    })
  })

  it('omits agentProvider when writing normalized settings to disk', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const settingsPath = join(userDataDir, 'kun-settings.json')
    const store = new JsonSettingsStore(userDataDir)
    await store.load()
    await store.patch({
      agents: {
        kun: {
          model: 'deepseek-chat'
        }
      }
    })

    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect('agentProvider' in persisted).toBe(false)
    expect(persisted.agents).toEqual(
      expect.objectContaining({
        kun: expect.objectContaining({ model: 'deepseek-chat' })
      })
    )
  })

  it('folds legacy Claw thread ids into the single Kun mapping', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        claw: {
          channels: [
            {
              id: 'channel-1',
              provider: 'feishu',
              label: 'Feishu Agent',
              threadId: 'thr_codewhale',
              agentThreadIds: { reasonix: '2026-06-01T01:00:00.000Z' },
              conversations: [
                {
                  id: 'conversation-1',
                  chatId: 'chat-1',
                  latestMessageId: 'message-1',
                  localThreadId: 'thr_conversation_codewhale',
                  agentThreadIds: { reasonix: '2026-06-01T02:00:00.000Z' }
                }
              ]
            }
          ]
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const channel = loaded.claw.channels[0]
    const conversation = channel?.conversations[0]

    expect(channel?.threadId).toBe('thr_codewhale')
    expect(conversation?.localThreadId).toBe('thr_conversation_codewhale')
  })

  it('seeds Reasonix-only Claw conversations into the canonical thread id', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        claw: {
          channels: [
            {
              id: 'channel-1',
              provider: 'feishu',
              label: 'Feishu Agent',
              agentThreadIds: { reasonix: 'reasonix-channel' },
              conversations: [
                {
                  id: 'conversation-1',
                  chatId: 'chat-1',
                  latestMessageId: 'message-1',
                  localThreadId: '',
                  agentThreadIds: { reasonix: 'reasonix-conversation' }
                }
              ]
            }
          ]
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const channel = loaded.claw.channels[0]
    const conversation = channel?.conversations[0]

    expect(channel?.threadId).toBe('reasonix-channel')
    expect(conversation?.localThreadId).toBe('reasonix-conversation')
  })

  it('saves settings atomically (no .tmp file left on success)', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-atomic-'))

    try {
      const store = new JsonSettingsStore(userDataDir)
      const loaded = await store.load()
      await store.save(loaded)

      // Final file is present and non-empty.
      const finalContents = await readFile(
        join(userDataDir, 'kun-settings.json'),
        'utf8'
      )
      expect(finalContents.length).toBeGreaterThan(0)

      // No .tmp leftover from the atomic write.
      const entries = await readdir(userDataDir)
      expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
