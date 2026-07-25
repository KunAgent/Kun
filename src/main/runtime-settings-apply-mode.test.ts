import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import {
  kunRuntimeConfigChanged,
  runtimeSettingsApplyMode,
  runtimeSettingsRollbackPatch
} from './runtime-settings-apply-mode'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
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
    disabledSkillIds: []
  }
}

function multiProviderSettings(): AppSettingsV1 {
  const base = settings()
  const deepseek = {
    ...base.provider.providers[0]!,
    apiKey: 'sk-deepseek-old'
  }
  const codex: ModelProviderProfileV1 = {
    ...deepseek,
    id: 'codex',
    name: 'ChatGPT Subscription',
    apiKey: 'codex-oauth',
    baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
    endpointFormat: 'custom_endpoint',
    models: ['gpt-5.6-sol'],
    modelProfiles: {}
  }
  const minimax: ModelProviderProfileV1 = {
    ...deepseek,
    id: 'minimax',
    name: 'MiniMax',
    apiKey: 'sk-minimax-old',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    models: ['MiniMax-M2'],
    modelProfiles: {}
  }
  return {
    ...base,
    provider: {
      ...base.provider,
      apiKey: deepseek.apiKey,
      providers: [deepseek, codex, minimax]
    },
    agents: {
      kun: {
        ...base.agents.kun,
        providerId: codex.id,
        model: codex.models[0]!
      }
    }
  }
}

function updateProvider(
  settings: AppSettingsV1,
  providerId: string,
  patch: Partial<ModelProviderProfileV1>
): AppSettingsV1 {
  return {
    ...settings,
    provider: {
      ...settings.provider,
      providers: settings.provider.providers.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider
      )
    }
  }
}

describe('runtimeSettingsApplyMode', () => {
  it('ignores UI-only settings', () => {
    const prev = settings()
    const next = { ...prev, uiFontScale: 0.9, theme: 'dark' as const }

    expect(runtimeSettingsApplyMode(prev, next)).toBe('none')
  })

  it('hot-applies model, provider, approval, media, MCP, project grants, memory, and subagent changes', () => {
    const prev = settings()
    const withModel = {
      ...prev,
      agents: { kun: { ...prev.agents.kun, model: 'deepseek-reasoner' } }
    }
    const withProviderKey = {
      ...prev,
      provider: { ...prev.provider, apiKey: 'sk-next' }
    }
    const withApproval = {
      ...prev,
      agents: { kun: { ...prev.agents.kun, approvalPolicy: 'never' as const, sandboxMode: 'read-only' as const } }
    }
    const withMedia = {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          imageGeneration: {
            ...prev.agents.kun.imageGeneration,
            enabled: true,
            providerId: 'deepseek',
            model: 'image-model'
          }
        }
      }
    }
    const withImageResolution = {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          imageGeneration: {
            ...prev.agents.kun.imageGeneration,
            defaultResolution: '2K' as const
          }
        }
      }
    }
    const withMcp = {
      ...prev,
      schedule: {
        ...prev.schedule,
        internal: { ...prev.schedule.internal, port: prev.schedule.internal.port + 1 }
      }
    }
    const withProjectGrant = {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          projectConfig: {
            grants: [{ workspaceRoot: '/workspace/project', configDigest: 'a'.repeat(64) }]
          }
        }
      }
    }
    const withMemory = {
      ...prev,
      agents: { kun: { ...prev.agents.kun, memoryEnabled: true } }
    }
    const withTurnCapacity = {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          runtimeTuning: {
            ...prev.agents.kun.runtimeTuning,
            maxConcurrentTurns: 32
          }
        }
      }
    }
    const withSubagents = {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          subagents: {
            enabled: true,
            maxParallel: 5,
            maxChildRuns: 20,
            profiles: [{
              id: 'researcher',
              enabled: true,
              name: 'Researcher',
              mode: 'subagent' as const,
              toolPolicy: 'readOnly' as const
            }]
          }
        }
      }
    }

    expect(runtimeSettingsApplyMode(prev, withModel)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withProviderKey)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withApproval)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withMedia)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withImageResolution)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withMcp)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withProjectGrant)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withMemory)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withTurnCapacity)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withSubagents)).toBe('hot')
  })

  it('hot-applies a non-default DeepSeek credential rotation while Codex is active', () => {
    const prev = multiProviderSettings()
    const next = updateProvider(prev, 'deepseek', { apiKey: 'sk-deepseek-new' })
    next.provider.apiKey = 'sk-deepseek-new'

    expect(kunRuntimeConfigChanged(prev, next)).toBe(false)
    expect(runtimeSettingsApplyMode(prev, next)).toBe('hot')
  })

  it('hot-applies non-default provider transport changes', () => {
    const prev = multiProviderSettings()
    const changes: Partial<ModelProviderProfileV1>[] = [
      { baseUrl: 'https://api.minimax.io/anthropic' },
      { endpointFormat: 'chat_completions' },
      { retry: { maxAttempts: 2, initialDelayMs: 500, httpStatusCodes: [429, 503] } },
      { kind: 'agent-sdk' }
    ]

    for (const change of changes) {
      expect(runtimeSettingsApplyMode(prev, updateProvider(prev, 'minimax', change))).toBe('hot')
    }
    expect(runtimeSettingsApplyMode(prev, {
      ...prev,
      provider: {
        ...prev.provider,
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
      }
    })).toBe('hot')
  })

  it('hot-applies routed provider additions and removals', () => {
    const prev = multiProviderSettings()
    const minimax = prev.provider.providers.find((provider) => provider.id === 'minimax')!
    const added: ModelProviderProfileV1 = {
      ...minimax,
      id: 'minimax-backup',
      name: 'MiniMax Backup'
    }
    const withAdded = {
      ...prev,
      provider: {
        ...prev.provider,
        providers: [...prev.provider.providers, added]
      }
    }
    const withRemoved = {
      ...prev,
      provider: {
        ...prev.provider,
        providers: prev.provider.providers.filter((provider) => provider.id !== 'minimax')
      }
    }

    expect(runtimeSettingsApplyMode(prev, withAdded)).toBe('hot')
    expect(runtimeSettingsApplyMode(prev, withRemoved)).toBe('hot')
  })

  it('hot-applies route pool and local gateway enablement changes', () => {
    const prev = multiProviderSettings()
    const targetProvider = prev.provider.providers.find((provider) => provider.id === 'minimax')!
    const withPool = {
      ...prev,
      provider: {
        ...prev.provider,
        routePools: [{
          id: 'minimax-pool',
          name: 'MiniMax pool',
          modelId: targetProvider.models[0]!,
          enabled: true,
          strategy: 'priority' as const,
          targets: [{
            id: 'primary',
            providerId: targetProvider.id,
            modelId: targetProvider.models[0]!,
            enabled: true,
            weight: 1
          }],
          failurePolicy: {
            failoverHttpStatusCodes: [429, 503],
            failoverOnNetworkError: true,
            failoverOnTimeout: true,
            failoverOnAuthError: true
          },
          healthPolicy: {
            failureThreshold: 3,
            cooldownMs: 60_000,
            halfOpenMaxAttempts: 1
          }
        }]
      }
    }
    const withGateway = {
      ...withPool,
      provider: {
        ...withPool.provider,
        localGateway: { ...withPool.provider.localGateway, enabled: true }
      }
    }

    expect(runtimeSettingsApplyMode(prev, withPool)).toBe('hot')
    expect(runtimeSettingsApplyMode(withPool, withGateway)).toBe('hot')
  })

  it('preserves desired route intent when restoring previous Runtime settings', () => {
    const previous = multiProviderSettings()
    const targetProvider = previous.provider.providers.find((provider) => provider.id === 'minimax')!
    const desired = {
      ...previous,
      agents: { kun: { ...previous.agents.kun, port: previous.agents.kun.port + 1 } },
      provider: {
        ...previous.provider,
        localGateway: { enabled: true, name: 'Team Relay' },
        routePools: [{
          id: 'durable-route', name: 'Durable route', modelId: 'durable-auto', enabled: true, strategy: 'priority' as const,
          targets: [{ id: 'target', providerId: targetProvider.id, modelId: targetProvider.models[0], enabled: true, weight: 1 }],
          failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
          healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
        }]
      }
    }

    const patch = runtimeSettingsRollbackPatch(previous, desired)
    expect(patch.agents?.kun?.port).toBe(previous.agents.kun.port)
    expect(patch.provider?.routePools).toEqual(desired.provider.routePools)
    expect(patch.provider?.localGateway).toEqual(desired.provider.localGateway)
    expect(patch.provider?.providers).toEqual(previous.provider.providers)
  })

  it('ignores provider order and display-name-only changes', () => {
    const prev = multiProviderSettings()
    const reordered = {
      ...prev,
      provider: {
        ...prev.provider,
        providers: [...prev.provider.providers].reverse()
      }
    }
    const renamed = updateProvider(prev, 'minimax', { name: 'MiniMax Renamed' })
    const gatewayRenamed = {
      ...prev,
      provider: {
        ...prev.provider,
        localGateway: { ...prev.provider.localGateway, name: 'Team Relay' }
      }
    }

    expect(runtimeSettingsApplyMode(prev, reordered)).toBe('none')
    expect(runtimeSettingsApplyMode(prev, renamed)).toBe('none')
    expect(runtimeSettingsApplyMode(prev, gatewayRenamed)).toBe('none')
  })

  it('requires restart for process-level runtime changes', () => {
    const prev = settings()

    expect(runtimeSettingsApplyMode(prev, {
      ...prev,
      agents: { kun: { ...prev.agents.kun, port: prev.agents.kun.port + 1 } }
    })).toBe('restart')
    expect(runtimeSettingsApplyMode(prev, {
      ...prev,
      agents: { kun: { ...prev.agents.kun, dataDir: '/tmp/kun-next' } }
    })).toBe('restart')
    expect(runtimeSettingsApplyMode(prev, {
      ...prev,
      agents: { kun: { ...prev.agents.kun, runtimeToken: 'tok-next' } }
    })).toBe('restart')
    expect(runtimeSettingsApplyMode(prev, {
      ...prev,
      agents: {
        kun: {
          ...prev.agents.kun,
          storage: { ...prev.agents.kun.storage, backend: 'file' as const }
        }
      }
    })).toBe('restart')
  })

  it('requires restart when the active default provider switches between http and agent-sdk', () => {
    const prev = settings()
    const provider = prev.provider.providers[0]!
    const next = {
      ...prev,
      provider: {
        ...prev.provider,
        providers: [
          { ...provider, kind: 'agent-sdk' as const }
        ]
      }
    }

    expect(runtimeSettingsApplyMode(prev, next)).toBe('restart')
  })
})
