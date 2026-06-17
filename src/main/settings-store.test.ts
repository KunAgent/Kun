import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APPROVAL_POLICY, defaultKunRuntimeSettings, defaultModelProviderSettings } from '../shared/app-settings'
import { DEFAULT_GUI_UPDATE_CHANNEL } from '../shared/gui-update'
import { JsonSettingsStore } from './settings-store'

describe('JsonSettingsStore', () => {
  it('defaults GUI updates to the stable channel for new settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.guiUpdate.channel).toBe(DEFAULT_GUI_UPDATE_CHANNEL)
    expect(loaded.agents.kun.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(loaded.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeAction: 'ask',
      closeToTray: false
    })
  })

  it('creates a default write workspace with welcome.md', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    const store = new JsonSettingsStore(userDataDir)
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
    expect(await readFile(join(loaded.write.defaultWorkspaceRoot, 'welcome.md'), 'utf8')).toContain('Welcome to Write')
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

  it('creates the configured code workspace on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const workspaceRoot = join(userDataDir, 'missing-workspace')

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.workspaceRoot).toBe(workspaceRoot)
    expect((await stat(workspaceRoot)).isDirectory()).toBe(true)
  })

  it('migrates legacy deepseek-runtime agentProvider to Kun', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))

    await writeFile(
      join(userDataDir, 'deepseek-gui-settings.json'),
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        deepseek: { port: 8787 }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.kun.port).toBe(8787)
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

  it('merges desktop behavior patches without keeping invalid startup state', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'ds-gui-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const enabled = await store.patch({
      appBehavior: {
        openAtLogin: true,
        startMinimized: true,
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
      closeAction: 'tray',
      closeToTray: true
    })
    expect(disabled.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
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
