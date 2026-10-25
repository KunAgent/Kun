import { describe, expect, it } from 'vitest'
import { offlineAgentSdkHarness, offlineAgentProfileConfig } from '../../tests/helpers/offline-agent-sdk-harness.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem } from '../domain/item.js'
import type { ModelStreamChunk } from '../ports/model-client.js'
import { createChildAgentExecutor } from './child-agent-executor.js'

describe('child external-agent admission and results', () => {
  it('dispatches provider-native children through the host runtime factory with the narrowed boundary', async () => {
    let nativeModelCalled = false
    let capturedBoundary:
      | Parameters<NonNullable<
          Parameters<typeof createChildAgentExecutor>[0]['createDelegatedRuntime']
        >>[0]
      | undefined
    const executor = createChildAgentExecutor({
      ...offlineAgentProfileConfig(['claude-subscription']),
      model: {
        provider: 'http',
        model: 'http-model',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          nativeModelCalled = true
          if (nativeModelCalled) {
            throw new Error('HTTP model must not own a subscription child')
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      toolHost: new LocalToolHost({ tools: [] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'http-model',
      createDelegatedRuntime: (boundary) => {
        capturedBoundary = boundary
        return offlineAgentSdkHarness({
          handlesProvider: (providerId: string | undefined) => providerId === 'claude-subscription',
          capabilities: (providerId: string | undefined) => providerId === 'claude-subscription'
            ? {
                nativeResume: true,
                structuredStreaming: true,
                kunTools: true,
                externalApproval: true,
                liveSteering: true,
                nativeContextTelemetry: true,
                fork: true
              }
            : undefined,
          runTurn: async (threadId: string, turnId: string) => {
            await boundary.turns.applyItem(
              threadId,
              makeAssistantTextItem({
                id: 'item_subscription',
                threadId,
                turnId,
                text: 'subscription child completed',
                status: 'completed'
              })
            )
            await boundary.turns.finishTurn({ threadId, turnId, status: 'completed' })
            return 'completed'
          }
        }, ['claude-subscription'])
      }
    })

    await expect(executor({
      childId: 'child_subscription',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'inspect safely',
      workspace: '/tmp/workspace',
      model: 'claude-sonnet-4-5',
      providerId: 'claude-subscription',
      toolPolicy: 'readOnly',
      allowedTools: ['read', 'bash'],
      blockedTools: ['grep'],
      blockedMcpServers: ['private'],
      blockedSkills: ['unsafe-skill'],
      skillsEnabled: false,
      security: {
        sandboxRoot: '/tmp/workspace',
        allowedToolNames: ['read', 'web_search', 'fast_context'],
        allowedProviderIds: ['builtin', 'fast-context'],
        allowedSkillIds: ['safe-skill'],
        blockedToolNames: ['write'],
        blockedProviderIds: ['mcp:blocked'],
        blockedSkillIds: ['parent-blocked'],
        memoryEnabled: false
      },
      signal: new AbortController().signal
    })).resolves.toMatchObject({ summary: 'subscription child completed' })

    expect(nativeModelCalled).toBe(false)
    expect(capturedBoundary).toMatchObject({
      toolPolicy: 'readOnly',
      allowedToolNames: ['read', 'fast_context'],
      allowedProviderIds: ['builtin', 'fast-context'],
      allowedSkillIds: ['safe-skill'],
      blockedToolNames: ['write', 'grep'],
      blockedProviderIds: ['mcp:blocked', 'mcp:private'],
      blockedSkillIds: ['parent-blocked', 'unsafe-skill'],
      skillsEnabled: false,
      memoryEnabled: false
    })
  })

})
