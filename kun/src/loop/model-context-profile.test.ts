import { describe, expect, it } from 'vitest'
import {
  contextThresholdsForModel,
  modelCapabilitiesForModel,
  modelCapabilitiesForProviderModel,
  modelContextProfilesFromConfig,
  safeProviderReasoningCapability
} from './model-context-profile.js'

describe('contextThresholdsForModel safety cap', () => {
  it('caps soft/hard thresholds to 75%/85% of the context window', () => {
    // A config-provided profile that sets thresholds dangerously close to
    // the full window (98%/99%) must be clamped so compaction still has
    // headroom to run before the real window is exceeded.
    const profiles = [
      {
        canonicalModel: 'deepseek-v4-pro',
        modelIds: ['deepseek-v4-pro'] as readonly string[],
        contextWindowTokens: 1_000_000,
        softThreshold: 980_000,
        hardThreshold: 990_000,
        inputModalities: ['text'] as const,
        outputModalities: ['text'] as const,
        supportsToolCalling: true,
        messageParts: ['text'] as const
      }
    ]
    const thresholds = contextThresholdsForModel('deepseek-v4-pro', undefined, profiles)
    expect(thresholds.softThreshold).toBe(750_000)
    expect(thresholds.hardThreshold).toBe(850_000)
  })

  it('leaves already-safe thresholds untouched', () => {
    const profiles = [
      {
        canonicalModel: 'deepseek-v4-pro',
        modelIds: ['deepseek-v4-pro'] as readonly string[],
        contextWindowTokens: 1_000_000,
        softThreshold: 500_000,
        hardThreshold: 600_000,
        inputModalities: ['text'] as const,
        outputModalities: ['text'] as const,
        supportsToolCalling: true,
        messageParts: ['text'] as const
      }
    ]
    const thresholds = contextThresholdsForModel('deepseek-v4-pro', undefined, profiles)
    expect(thresholds.softThreshold).toBe(500_000)
    expect(thresholds.hardThreshold).toBe(600_000)
  })

  it('returns the fallback when no profile matches', () => {
    const fallback = { softThreshold: 1234, hardThreshold: 5678 }
    const thresholds = contextThresholdsForModel('unknown-model', fallback, [])
    expect(thresholds).toEqual(fallback)
  })

  it('derives safe thresholds from a Gemini context-window-only profile', () => {
    const profiles = modelContextProfilesFromConfig({
      models: {
        profiles: {
          'gemini-2.5-flash': {
            contextWindowTokens: 1_048_576,
            maxOutputTokens: 65_536
          }
        }
      }
    })

    expect(contextThresholdsForModel('gemini-2.5-flash', undefined, profiles)).toEqual({
      softThreshold: 786_432,
      hardThreshold: 891_289
    })
    expect(modelCapabilitiesForModel('gemini-2.5-flash', profiles)).toMatchObject({
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 65_536
    })
  })
})

describe('per-model endpointFormat', () => {
  it('carries a configured maxOutputTokens from models.profiles into capabilities', () => {
    const profiles = modelContextProfilesFromConfig({
      models: {
        profiles: {
          'long-writer': { contextWindowTokens: 256_000, maxOutputTokens: 32_000 }
        }
      }
    })

    expect(modelCapabilitiesForModel('long-writer', profiles).maxOutputTokens).toBe(32_000)
  })

  it('carries a configured endpointFormat from models.profiles into capabilities', () => {
    const profiles = modelContextProfilesFromConfig({
      models: {
        profiles: {
          'minimax-m3': { contextWindowTokens: 256_000, endpointFormat: 'messages' },
          'glm-5.1': { contextWindowTokens: 131_072 }
        }
      }
    })
    expect(modelCapabilitiesForModel('minimax-m3', profiles).endpointFormat).toBe('messages')
    // A model without an override inherits (no endpointFormat emitted).
    expect(modelCapabilitiesForModel('glm-5.1', profiles).endpointFormat).toBeUndefined()
  })

  it('omits endpointFormat for unknown models so they inherit the provider format', () => {
    const model = modelCapabilitiesForModel('unknown-model', [])

    expect(model.contextWindowTokens).toBe(256_000)
    expect(model.endpointFormat).toBeUndefined()
  })
})

describe('built-in reasoning compatibility profiles', () => {
  it('suppresses a stale thinking toggle only for OpenCode Go accounts', () => {
    const stale = {
      supportedEfforts: ['off', 'low', 'medium', 'high', 'max'],
      defaultEffort: 'max',
      requestProtocol: 'thinking-toggle-chat-completions'
    } satisfies NonNullable<Parameters<typeof safeProviderReasoningCapability>[1]>
    expect(safeProviderReasoningCapability({
      providerId: 'opencode-go-2',
      presetSource: 'opencode-go',
      model: 'muse-spark-1.2-contributor'
    }, stale)).toEqual({
      supportedEfforts: ['auto'],
      defaultEffort: 'auto',
      requestProtocol: 'none'
    })
    expect(safeProviderReasoningCapability({
      providerId: 'custom-provider',
      model: 'muse-spark-1.2-contributor'
    }, stale)).toEqual(stale)
  })

  it('keeps audited Codex Responses variants available for legacy snapshots', () => {
    expect(modelCapabilitiesForModel('gpt-5.6-luna')).toMatchObject({
      contextWindowTokens: 372_000,
      inputModalities: ['text', 'image'],
      responsesMode: 'lite',
      reasoning: {
        supportedEfforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-responses'
      }
    })
  })

  it('keeps audited GLM variants available when provider metadata is missing', () => {
    expect(modelCapabilitiesForModel('glm-5.2')).toMatchObject({
      contextWindowTokens: 1_000_000,
      reasoning: {
        supportedEfforts: ['off', 'high', 'max'],
        defaultEffort: 'max',
        requestProtocol: 'glm-chat-completions'
      }
    })

    const configured = modelContextProfilesFromConfig({
      models: {
        profiles: {
          'glm-5.2': {
            contextWindowTokens: 131_072,
            inputModalities: ['text', 'image']
          }
        }
      }
    })
    expect(modelCapabilitiesForModel('opencode-go/glm-5.2', configured)).toMatchObject({
      contextWindowTokens: 131_072,
      inputModalities: ['text', 'image'],
      reasoning: {
        supportedEfforts: ['off', 'high', 'max'],
        requestProtocol: 'glm-chat-completions'
      }
    })
  })

  it('does not invent reasoning variants for unknown custom models', () => {
    expect(modelCapabilitiesForModel('my-private-model').reasoning).toBeUndefined()
  })

  it.each([
    ['kimi-code', 'k3', 'https://api.kimi.com/coding/v1', 'openai-chat-completions', ['low', 'high', 'max']],
    ['grok-subscription', 'grok-4.5', 'https://cli-chat-proxy.grok.com/v1', 'openai-responses', ['low', 'medium', 'high']],
    ['opencode-go', 'grok-4.5', 'https://opencode.ai/zen/go/v1', 'openai-chat-completions', ['low', 'medium', 'high']],
    ['claude-subscription', 'claude-sonnet-4-6', 'https://api.anthropic.com', 'anthropic-thinking', ['low', 'medium', 'high', 'max']],
    ['xiaomi-token-plan', 'mimo-v2.5-pro', 'https://token-plan-cn.xiaomimimo.com/v1', 'mimo-chat-completions', ['off', 'low', 'medium', 'high']],
    ['minimax', 'MiniMax-M3', 'https://api.minimaxi.com/anthropic', 'anthropic-thinking', ['auto', 'off']],
    ['aliyun', 'qwq-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-chat-completions', ['auto', 'off']],
    ['tencentcloud-token-plan', 'hunyuan-t1-latest', 'https://api.lkeap.cloud.tencent.com/plan/v3', 'thinking-toggle-chat-completions', ['auto', 'off']],
    ['volcengine-coding-plan', 'doubao-seed-1-6-250615', 'https://ark.cn-beijing.volces.com/api/coding/v3', 'thinking-toggle-chat-completions', ['auto', 'off']],
    ['zenmux', 'openai/gpt-5.4', 'https://zenmux.ai/api/v1', 'openai-chat-completions', ['low', 'medium', 'high']]
  ])('restores %s/%s provider-scoped variants', (
    providerId,
    model,
    baseUrl,
    requestProtocol,
    supportedEfforts
  ) => {
    expect(modelCapabilitiesForProviderModel({
      providerId,
      baseUrl,
      kind: providerId === 'claude-subscription' ? 'agent-sdk' : 'http',
      model
    }).reasoning).toEqual({
      supportedEfforts,
      defaultEffort: providerId === 'minimax' || providerId.startsWith('aliyun') ||
        providerId.startsWith('tencentcloud') || providerId.startsWith('volcengine')
        ? 'auto'
        : providerId === 'zenmux' || providerId === 'opencode-go' ? 'medium' : 'high',
      requestProtocol
    })
  })

  it('does not apply aggregator variants to an unknown custom endpoint', () => {
    expect(modelCapabilitiesForProviderModel({
      providerId: 'private',
      baseUrl: 'https://private.example/v1',
      model: 'private-reasoning-model'
    }).reasoning).toBeUndefined()
  })

  it.each([
    ['grok-4.5', 'https://cli-chat-proxy.grok.com.attacker.test', 'openai-responses'],
    ['mimo-private', 'https://xiaomimimo.com.attacker.test', 'mimo-chat-completions'],
    ['minimax-m3-private', 'https://minimaxi.com.attacker.test', 'anthropic-thinking'],
    ['minimax-m3-private', 'https://minimax.io.attacker.test', 'anthropic-thinking'],
    ['qwq-private', 'https://dashscope.aliyuncs.com.attacker.test', 'qwen-chat-completions'],
    ['qwq-private', 'https://region.maas.aliyuncs.com.attacker.test', 'qwen-chat-completions'],
    ['hunyuan-t1-private', 'https://hunyuan.cloud.tencent.com.attacker.test', 'thinking-toggle-chat-completions'],
    ['hunyuan-t1-private', 'https://lkeap.cloud.tencent.com.attacker.test', 'thinking-toggle-chat-completions'],
    ['doubao-private', 'https://volces.com.attacker.test', 'thinking-toggle-chat-completions']
  ])('does not trust a provider domain embedded in an attacker hostname for %s', (
    model,
    baseUrl,
    requestProtocol
  ) => {
    expect(modelCapabilitiesForProviderModel({
      providerId: 'private',
      baseUrl,
      model
    }).reasoning?.requestProtocol).not.toBe(requestProtocol)
  })

  it('advertises priority only for eligible Codex subscription models', () => {
    expect(modelCapabilitiesForProviderModel({
      providerId: 'codex-2',
      presetSource: 'codex',
      model: 'gpt-5.4'
    }).serviceTiers).toEqual(['priority'])
    expect(modelCapabilitiesForProviderModel({
      providerId: 'codex-2',
      presetSource: 'codex',
      model: 'gpt-5.4-mini'
    }).serviceTiers).toBeUndefined()
    expect(modelCapabilitiesForProviderModel({
      providerId: 'private-openai',
      model: 'gpt-5.4'
    }).serviceTiers).toBeUndefined()
  })

  it('uses ZenMux chat reasoning for routed DeepSeek models and excludes non-reasoning ids', () => {
    expect(modelCapabilitiesForProviderModel({
      providerId: 'zenmux',
      baseUrl: 'https://zenmux.ai/api/v1',
      model: 'deepseek/deepseek-v4-pro'
    }).reasoning?.requestProtocol).toBe('openai-chat-completions')
    expect(modelCapabilitiesForProviderModel({
      providerId: 'zenmux',
      baseUrl: 'https://zenmux.ai/api/v1',
      model: 'x-ai/grok-4.2-fast-non-reasoning'
    }).reasoning).toBeUndefined()
  })
})
