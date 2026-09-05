import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLogger } from './logger'
import {
  defaultClawSettings,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  getModelProviderPreset,
  modelProviderPresetProfile,
  resolveKunRuntimeSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1,
  type ModelProviderModelProfileV1
} from '../shared/app-settings'
import { KunConfigSchema } from '../../kun/src/config/kun-config.js'
import {
  configureManagerAtomicJsonClient,
  isManagerAtomicJsonPath
} from '../../kun/src/extensions/atomic-json.js'
import {
  ManagerResourceLeaseClient,
  ManagerRevisionedDocumentClient
} from '../../kun/src/manager/manager-client.js'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

let tempRoot: string | null = null
let testKunPort = 18899

function createSettings(binaryPath: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(testKunPort),
        binaryPath,
        autoStart: true
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function writeScript(name: string, content: string): string {
  if (!tempRoot) throw new Error('temp root not initialized')
  const path = join(tempRoot, name)
  writeFileSync(path, content, 'utf8')
  return path
}

async function readKunLog(): Promise<string> {
  if (!tempRoot) throw new Error('temp root not initialized')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logFile = readdirSync(tempRoot).find((entry) => entry.startsWith('kun-') && entry.endsWith('.log'))
    if (logFile) return readFileSync(join(tempRoot, logFile), 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected a kun log file to be created')
}

function canBindTestPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    let settled = false
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => settle(true))
    })
  })
}

function allocateTestPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('failed to allocate a test port'))
      })
    })
  })
}

beforeEach(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kun-process-'))
  testKunPort = await allocateTestPort()
  configureLogger({ dir: tempRoot, enabled: true, retentionDays: 7 })
})

afterEach(async () => {
  const module = await import('./kun-process')
  await module.stopKunChildAndWait()
  configureLogger({ dir: '', enabled: true, retentionDays: DEFAULT_LOG_RETENTION_DAYS })
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  configureManagerAtomicJsonClient(null)
})
describe('syncGuiManagedKunConfig', () => {
  it('injects the explicitly enabled built-in GitHub MCP without persisting its PAT', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    vi.stubEnv('GITHUB_PAT_TOKEN', 'github-secret-for-test')
    const module = await import('./kun-process')
    const runtime = defaultKunRuntimeSettings()
    runtime.githubMcp = { ...runtime.githubMcp, enabled: true,
      authorization: { source: 'GITHUB_PAT_TOKEN', host: 'github.com', login: 'octocat', scopes: ['repo'], fingerprint: 'a'.repeat(64) } }
    await module.syncGuiManagedKunConfig(tempRoot, runtime, {
      mcpConfigPath: join(tempRoot, 'missing-mcp.json')
    })

    const configPath = join(tempRoot, 'config.json')
    const configText = readFileSync(configPath, 'utf8')
    const config = JSON.parse(configText) as any
    expect(config.capabilities.mcp.enabled).toBe(true)
    expect(config.capabilities.mcp.servers.github).toMatchObject({
      enabled: true,
      managedBy: 'kun:github',
      transport: 'streamable-http',
      url: 'https://api.githubcopilot.com/mcp/readonly',
      headers: {
        Authorization: 'Bearer ${GITHUB_PAT_TOKEN}',
        'X-MCP-Readonly': 'true'
      }
    })
    expect(configText).not.toContain('github-secret-for-test')
  }, 15_000)

  it('preserves a user-owned GitHub server that uses the official URL', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            github: {
              enabled: false,
              transport: 'streamable-http',
              url: 'https://api.githubcopilot.com/mcp/readonly',
              headers: {
                Authorization: 'Bearer ${MY_GITHUB_TOKEN}',
                'X-MCP-Readonly': 'true'
              },
              trustScope: 'user',
              timeoutMs: 12_345
            }
          }
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath: join(tempRoot, 'missing-mcp.json')
    })

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(config.capabilities.mcp.servers.github).toMatchObject({
      enabled: false,
      url: 'https://api.githubcopilot.com/mcp/readonly',
      headers: { Authorization: 'Bearer ${MY_GITHUB_TOKEN}' },
      timeoutMs: 12_345
    })
    expect(config.capabilities.mcp.servers.github).not.toHaveProperty('managedBy')
  }, 15_000)

  it('writes GUI-managed MCP search settings without removing existing servers', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      legacyTopLevelFlag: true,
      contextCompaction: {
        modelProfiles: {
          'custom-model': {
            contextWindowTokens: 128000
          }
        }
      },
      models: {
        profiles: {
          'user-model': {
            contextWindowTokens: 96000,
            contextCompaction: {
              softThreshold: 86000
            }
          },
          'deepseek-v4-pro': {
            contextCompaction: {
              softThreshold: 970000
            }
          }
        }
      },
      runtime: {
        customRuntimeFlag: true,
        toolStorm: {
          customStormFlag: 'keep'
        }
      },
      serve: {
        runtimeToken: 'keep-this-token',
        legacyServeFlag: true,
        tokenEconomy: {
          customTokenEconomyFlag: 'keep',
          historyHygiene: {
            customHistoryFlag: true
          }
        }
      },
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp',
              trustScope: 'user'
            }
          }
        },
        web: {
          enabled: true,
          fetchEnabled: true
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(
      tempRoot,
      {
        ...defaultKunRuntimeSettings(),
        storage: {
          backend: 'hybrid',
          sqlitePath: '/tmp/kun-index.sqlite3'
        },
        contextCompaction: {
          defaultSoftThreshold: 32000,
          defaultHardThreshold: 64000,
          summaryMode: 'model',
          summaryTimeoutMs: 30000,
          summaryMaxTokens: 1600,
          summaryInputMaxBytes: 131072
        },
        runtimeTuning: {
          defaultsVersion: 1,
          maxConcurrentTurns: 32,
          maxWallTimeMs: 7_200_000,
          streamIdleTimeoutMs: 120000,
          toolStorm: {
            enabled: false
          },
          toolArgumentRepair: {
            maxStringBytes: 262144
          },
          interruptedTurnResume: {
            enabled: true
          }
        },
        mcpSearch: {
          enabled: true,
          mode: 'search',
          autoThresholdToolCount: 12,
          topKDefault: 4,
          topKMax: 9,
          minScore: 0.2
        },
        tokenEconomy: {
          enabled: true,
          compressToolDescriptions: false,
          compressToolResults: true,
          conciseResponses: false,
          historyHygiene: {
            maxToolResultLines: 100,
            maxToolResultBytes: 16384,
            maxToolResultTokens: 4000,
            maxToolArgumentStringBytes: 4096,
            maxToolArgumentStringTokens: 1000,
            maxArrayItems: 40
          }
        },
        toolOutputLimits: {
          maxLines: 30000,
          maxBytes: 2 * 1024 * 1024
        }
      },
      { mcpConfigPath: join(tempRoot, 'missing-mcp.json') }
    )

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.legacyTopLevelFlag).toBeUndefined()
    expect(parsed.serve.legacyServeFlag).toBeUndefined()
    expect(parsed.serve.runtimeToken).toBe('keep-this-token')
    expect(parsed.serve.storage).toMatchObject({
      backend: 'hybrid',
      sqlitePath: '/tmp/kun-index.sqlite3'
    })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: true,
      compressToolDescriptions: false,
      compressToolResults: true,
      conciseResponses: false,
      historyHygiene: {
        maxToolResultLines: 100,
        maxToolResultBytes: 16384,
        maxToolResultTokens: 4000,
        maxToolArgumentStringBytes: 4096,
        maxToolArgumentStringTokens: 1000,
        maxArrayItems: 40
      }
    })
    expect(parsed.serve.tokenEconomy.customTokenEconomyFlag).toBeUndefined()
    expect(parsed.serve.tokenEconomy.historyHygiene.customHistoryFlag).toBeUndefined()
    expect(parsed.serve.toolOutputLimits).toEqual({
      maxLines: 30000,
      maxBytes: 2 * 1024 * 1024
    })
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 32000,
      defaultHardThreshold: 64000,
      summaryMode: 'model',
      summaryTimeoutMs: 30000,
      summaryMaxTokens: 1600,
      summaryInputMaxBytes: 131072
    })
    expect(parsed.contextCompaction.modelProfiles['custom-model']).toMatchObject({
      contextWindowTokens: 128000
    })
    expect(parsed.models.profiles['user-model']).toMatchObject({
      contextWindowTokens: 96000,
      contextCompaction: {
        softThreshold: 86000
      }
    })
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 970_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.toolStorm).toMatchObject({
      enabled: false
    })
    expect(parsed.runtime.toolStorm.customStormFlag).toBeUndefined()
    expect(parsed.runtime.customRuntimeFlag).toBeUndefined()
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 262144 })
    expect(parsed.runtime.turnLimits).toMatchObject({
      maxConcurrentTurns: 32,
      maxWallTimeMs: 7_200_000
    })
    expect(parsed.runtime.streamIdleTimeoutMs).toBe(120000)
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.mcp.servers.github.command).toBe('github-mcp')
    expect(parsed.capabilities.web.fetchEnabled).toBe(true)
    expect(parsed.capabilities.mcp.search).toMatchObject({
      enabled: true,
      mode: 'search',
      autoThresholdToolCount: 12,
      topKDefault: 4,
      topKMax: 9,
      minScore: 0.2
    })
  })

  it('imports GUI-managed MCP servers into runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: {
        'stata-mcp': {
          command: 'uvx',
          cwd: 'D:\\Workspace\\stata-project',
          args: ['stata-mcp'],
          env: {
            STATA_CLI: 'D:\\stata\\StataMP-64.exe'
          },
          enabled: true,
          disabled: false
        },
        'docs-mcp': {
          url: 'https://mcp.example.test/mcp',
          workspaceRoots: ['D:\\Workspace\\docs-project'],
          headers: {
            Authorization: 'Bearer docs-token'
          }
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers['stata-mcp']).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      cwd: 'D:\\Workspace\\stata-project',
      args: ['stata-mcp'],
      env: {
        STATA_CLI: 'D:\\stata\\StataMP-64.exe'
      },
      trustScope: 'user'
    })
    expect(parsed.capabilities.mcp.servers['docs-mcp']).toMatchObject({
      enabled: true,
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      workspaceRoots: ['D:\\Workspace\\docs-project'],
      headers: {
        Authorization: 'Bearer docs-token'
      },
      trustScope: 'user'
    })
  })

  it('imports user-managed workspace-scoped MCP servers into runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    const workspaceRoot = join(tempRoot, 'workspace')
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: {
        codegraph: {
          command: 'uvx',
          args: ['codegraph-mcp'],
          workspaceRoots: [workspaceRoot],
          trustScope: 'workspace',
          trustedWorkspaceRoots: [workspaceRoot]
        }
      }
    }), 'utf8')
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(workspaceRoot, '.mcp.json'), JSON.stringify({
      servers: {
        codegraph: {
          command: 'repo-controlled-codegraph',
          args: ['untrusted-project-config'],
          trustScope: 'user'
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.codegraph).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['codegraph-mcp'],
      workspaceRoots: [workspaceRoot],
      trustScope: 'workspace',
      trustedWorkspaceRoots: [workspaceRoot]
    })
    expect(JSON.stringify(parsed.capabilities.mcp.servers.codegraph)).not.toContain('repo-controlled-codegraph')
  })

  it('does not auto-import workspace .mcp.json servers into the runtime', async () => {
    // Security: a project file can suggest MCP setup, but it must not grant
    // itself permission to run commands in the local runtime. Users can still
    // opt in by copying the server into the GUI-managed MCP config above.
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const mcpConfigPath = join(tempRoot, 'mcp.json')
    const workspaceRoot = join(tempRoot, 'workspace')
    writeFileSync(mcpConfigPath, JSON.stringify({
      servers: {
        codegraph: {
          command: 'global-codegraph',
          args: ['global']
        }
      }
    }), 'utf8')
    mkdirSync(workspaceRoot, { recursive: true })
    writeFileSync(join(workspaceRoot, '.mcp.json'), JSON.stringify({
      servers: {
        codegraph: {
          command: 'uvx',
          args: ['codegraph-mcp'],
          trustScope: 'user'
        },
        evil: {
          command: 'node',
          args: ['evil.js'],
          trustScope: 'user'
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.codegraph).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'global-codegraph',
      args: ['global'],
      trustScope: 'user'
    })
    expect(JSON.stringify(parsed.capabilities.mcp.servers)).not.toContain('codegraph-mcp')
    expect(JSON.stringify(parsed.capabilities.mcp.servers)).not.toContain('evil.js')
  })

  it('does not auto-import repo-local .kun/mcp.json servers into the runtime', async () => {
    // Security: a cloned/untrusted repo must not be able to register an MCP
    // server that the runtime would spawn on startup. Workspace-scoped
    // *visibility* stays supported on user-authored servers (see the test
    // above); only the unsafe repo-file auto-discovery is intentionally absent.
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const repo = join(tempRoot, 'cloned-repo')
    mkdirSync(join(repo, '.kun'), { recursive: true })
    writeFileSync(join(repo, '.kun', 'mcp.json'), JSON.stringify({
      servers: {
        evil: { command: 'node', args: ['evil.js'], trustScope: 'user' }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      mcpConfigPath: join(tempRoot, 'missing-mcp.json')
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    const servers = parsed.capabilities?.mcp?.servers ?? {}
    expect(JSON.stringify(servers)).not.toContain('evil.js')
  })

  it('replaces unparsable historical Kun config with a valid GUI-managed config', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, '{ legacy config', 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('does not enable MCP when the capability is explicitly disabled', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        mcp: {
          enabled: false
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings: createSettings('/tmp/fake-kun-child.js'),
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(false)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/deepseek-gui-test-app/out/main/claw-schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:18788',
        '--workflow-base-url',
        'http://127.0.0.1:18799'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      }
    })
  })

  it('does not override an explicitly disabled attachment capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        attachments: {
          enabled: false,
          maxImageBytes: 1024
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.attachments).toMatchObject({
      enabled: false,
      maxImageBytes: 1024
    })
  })

  it('does not override explicitly disabled web fetch capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        web: {
          enabled: false,
          fetchEnabled: false,
          searchEnabled: true,
          provider: 'custom-search'
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.web).toMatchObject({
      enabled: false,
      fetchEnabled: false,
      searchEnabled: true,
      provider: 'custom-search'
    })
  })
})
