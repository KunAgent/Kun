import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  migrateLegacyAppSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { kunRuntimeAdapter } from './runtime/kun-adapter'
import { JsonSettingsStore } from './settings-store'

describe('Kun single-agent regression', () => {
  it('seeds provider credentials and Kun port from legacy local HTTP settings', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'codewhale',
      agents: {
        codewhale: {
          binaryPath: '/usr/local/bin/codewhale',
          port: 18787,
          apiKey: 'legacy-key',
          baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
          autoStart: false
        }
      },
      deepseek: { port: 18788 }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents).toEqual({
      kun: expect.objectContaining({
        apiKey: '',
        baseUrl: '',
        binaryPath: '',
        port: 18788,
        autoStart: false
      })
    })
    expect(migrated.provider).toEqual(expect.objectContaining({
      apiKey: 'legacy-key',
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL
    }))
  })

  it('does not carry legacy local-runtime binary paths into Kun', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        binaryPath: '/Applications/DeepSeek Runtime.app/Contents/MacOS/deepseek-runtime',
        port: 18787
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      binaryPath: '',
      port: 18787
    }))
  })

  it('does not keep the legacy default local HTTP port for Kun', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'codewhale',
      agents: {
        codewhale: {
          // 这里必须保留旧版真实写入值, 用于升级到当前 Kun 默认端口。
          port: 7878
        }
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.port).toBe(18899)
  })

  it('seeds provider credentials and Kun model from legacy reasoning settings', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'reasonix',
      agents: {
        reasonix: {
          apiKey: 'reasoning-key',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-reasoner',
          autoStart: false
        }
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      apiKey: '',
      baseUrl: '',
      model: 'deepseek-reasoner',
      autoStart: false
    }))
    expect(migrated.provider).toEqual(expect.objectContaining({
      apiKey: 'reasoning-key',
      baseUrl: 'https://api.deepseek.com'
    }))
  })

  it('Kun adapter reports base url and id', () => {
    const settings: AppSettingsV1 = {
      version: 1,
      locale: 'en',
      theme: 'system',
      uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
      provider: defaultModelProviderSettings(),
      agents: {
        kun: defaultKunRuntimeSettings(19000)
      },
      workspaceRoot: '/tmp',
      conversationWorkspaceRoot: '~/Documents/Kun',
      log: { enabled: true, retentionDays: 7 },
      checkpointCleanup: { enabled: false, intervalDays: 3 },
      notifications: { turnComplete: true },
      appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
      keyboardShortcuts: defaultKeyboardShortcuts(),
      write: defaultWriteSettings(),
      claw: defaultClawSettings(),
      schedule: defaultScheduleSettings(),
      workflow: defaultWorkflowSettings(),
      terminal: defaultTerminalSettings(),
      guiUpdate: { channel: 'stable' },
      codePromptPrefix: '',
      disabledSkillIds: []
    }

    expect(kunRuntimeAdapter.id).toBe('kun')
    expect(kunRuntimeAdapter.getBaseUrl(settings)).toBe('http://127.0.0.1:19000')
  })

  it('JsonSettingsStore saves only Kun after legacy settings migration', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ca-settings-'))
    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agentProvider: 'codewhale',
        deepseek: { port: 18787 }
      }),
      'utf-8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents).toEqual({
      kun: expect.objectContaining({ port: 18787 })
    })
    await rm(userDataDir, { recursive: true, force: true })
  })
})
