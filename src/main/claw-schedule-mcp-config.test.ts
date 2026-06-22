import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedClawScheduleMcpJson,
  clawScheduleMcpSettingsChanged,
  removeLegacyClawScheduleTomlConfig,
  resolveClawScheduleMcpCommand,
  resolveClawScheduleMcpNodeEntryPath,
  resolveDeepseekConfigPath,
  resolveKunConfigPath,
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '../shared/app-settings'

function createSettings(patch: Partial<AppSettingsV1['schedule']['internal']> = {}): AppSettingsV1 {
  const claw = defaultClawSettings()
  const schedule = defaultScheduleSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: {
      ...schedule,
      internal: {
        ...schedule.internal,
        ...patch
      }
    },
    workflow: defaultWorkflowSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    disabledSkillIds: [],
    claw: {
      ...claw,
      enabled: true,
      im: {
        ...claw.im,
        enabled: true,
        port: 18787,
        secret: ''
      }
    }
  }
}

const launch: ClawScheduleMcpLaunchConfig = {
  appPath: '/Applications/Kun.app',
  execPath: '/Applications/Kun.app/Contents/MacOS/Kun',
  isPackaged: false
}

describe('claw schedule MCP config', () => {
  it('uses Kun config files by default', () => {
    expect(resolveKunConfigPath()).toBe(join(homedir(), '.kun', 'config.toml'))
    expect(resolveKunMcpJsonPath()).toBe(join(homedir(), '.kun', 'mcp.json'))
    expect(resolveDeepseekConfigPath()).toBe(resolveKunConfigPath())
  })

  it('writes the gui_schedule server to the Kun MCP JSON config shape', () => {
    const settings = createSettings({ port: 19787, secret: 'top-secret' })
    const synced = buildSyncedClawScheduleMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          }
        }
      },
      settings,
      launch
    )

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      },
      gui_schedule: {
        command: resolveClawScheduleMcpCommand(launch),
        args: [
          resolveClawScheduleMcpNodeEntryPath(launch),
          '--gui-schedule-mcp-server',
          '--base-url',
          'http://127.0.0.1:19787',
          '--secret',
          'top-secret',
          '--workflow-base-url',
          'http://127.0.0.1:18799'
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        },
        url: null,
        enabled: true
      }
    })
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('uses the macOS Electron helper for real app bundle paths', () => {
    expect(resolveClawScheduleMcpCommand(launch, 'darwin')).toBe(
      '/Applications/Kun.app/Contents/Frameworks/Kun Helper.app/Contents/MacOS/Kun Helper'
    )
    expect(resolveClawScheduleMcpCommand({
      appPath: '/tmp/deepseek-gui-test-app',
      execPath: '/tmp/electron',
      isPackaged: false
    }, 'darwin')).toBe('/tmp/electron')
  })

  it('removes legacy config.toml claw_schedule blocks without touching other MCP servers', () => {
    const cleaned = removeLegacyClawScheduleTomlConfig(
      [
        'provider = "deepseek"',
        '',
        '[mcp_servers.context7]',
        'command = "npx"',
        '',
        '[mcp_servers.claw_schedule]',
        'command = "old"',
        'args = []',
        '',
        '# DeepSeek GUI plugin:mcp:claw-schedule START',
        '[mcp_servers.claw_schedule]',
        'command = "electron"',
        'args = []',
        '# DeepSeek GUI plugin:mcp:claw-schedule END',
        '',
        '[providers.deepseek]',
        'api_key = ""'
      ].join('\n')
    )

    expect(cleaned).toContain('[mcp_servers.context7]')
    expect(cleaned).toContain('[providers.deepseek]')
    expect(cleaned).not.toContain('[mcp_servers.claw_schedule]')
    expect(cleaned).not.toContain('DeepSeek GUI plugin:mcp:claw-schedule')
  })

  it('does not rewrite config.toml text when there is no legacy claw_schedule block', () => {
    const current = [
      'provider = "deepseek"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      '',
      ''
    ].join('\n')

    expect(removeLegacyClawScheduleTomlConfig(current)).toBe(current)
  })

  it('syncs mcp.json and cleans the old config.toml entry on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ds-gui-mcp-'))
    const kunDir = join(root, '.kun')
    const configTomlPath = join(kunDir, 'config.toml')
    const mcpJsonPath = join(kunDir, 'mcp.json')
    await mkdir(kunDir, { recursive: true })
    await writeFile(
      configTomlPath,
      [
        'provider = "deepseek"',
        '',
        '# DeepSeek GUI plugin:mcp:claw-schedule START',
        '[mcp_servers.claw_schedule]',
        'command = "electron"',
        'args = []',
        '# DeepSeek GUI plugin:mcp:claw-schedule END',
        ''
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        servers: {
          existing: {
            command: '/bin/echo',
            args: ['ok'],
            env: {},
            url: null
          }
        }
      }),
      'utf8'
    )

    await syncClawScheduleMcpConfig(createSettings(), launch, { configTomlPath, mcpJsonPath })

    const toml = await readFile(configTomlPath, 'utf8')
    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>

    expect(toml).toBe('provider = "deepseek"\n')
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        },
        gui_schedule: {
          command: resolveClawScheduleMcpCommand(launch),
          args: [
            resolveClawScheduleMcpNodeEntryPath(launch),
            '--gui-schedule-mcp-server',
            '--base-url',
            'http://127.0.0.1:18788',
            '--workflow-base-url',
            'http://127.0.0.1:18799'
          ],
          env: {
            ELECTRON_RUN_AS_NODE: '1'
          }
        }
      }
    })
  })

  it('migrates old claw_schedule JSON entries to gui_schedule', () => {
    const synced = buildSyncedClawScheduleMcpJson(
      {
        servers: {
          claw_schedule: {
            command: 'old',
            args: ['--claw-schedule-mcp-server']
          }
        }
      },
      createSettings(),
      launch
    )

    expect((synced.servers as Record<string, unknown>).claw_schedule).toBeUndefined()
    expect(synced.servers).toMatchObject({
      gui_schedule: {
        command: resolveClawScheduleMcpCommand(launch),
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        }
      }
    })
  })

  it('requests a runtime restart when the MCP launch arguments change', () => {
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings({ port: 19876 }))).toBe(true)
    expect(clawScheduleMcpSettingsChanged(createSettings(), createSettings({ secret: 'abc' }))).toBe(true)
  })
})
