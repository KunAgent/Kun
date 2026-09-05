import { describe, expect, it } from 'vitest'
import {
  createExtensionAgentHarness as createHarness,
  extensionAgentPrincipal as principal,
  workspace
} from './extension-agent-service.test-support.js'

describe('ExtensionAgentService model options', () => {
  it('projects safe choices and applies a supported model and reasoning effort per turn', async () => {
    const h = createHarness()
    await expect(h.service.getRunOptions(principal())).resolves.toEqual({
      defaultModel: 'default-model',
      models: [
        {
          id: 'default-model',
          displayName: 'Default model',
          selected: true,
          reasoningEfforts: ['off', 'high'],
          defaultReasoningEffort: 'high'
        },
        {
          id: 'alternate-model',
          displayName: 'Alternate model',
          selected: false,
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          defaultReasoningEffort: 'medium'
        }
      ]
    })

    const first = await h.service.createRun(principal(), {
      input: 'Use the alternate model',
      workspace,
      model: 'alternate-model',
      reasoningEffort: 'max'
    })
    expect(first).toMatchObject({
      providerBinding: { providerId: 'default-provider', modelId: 'alternate-model' },
      reasoningEffort: 'max'
    })
    expect((await h.threads.get(first.threadId))?.turns[0]).toMatchObject({
      model: 'alternate-model',
      reasoningEffort: 'max'
    })

    await h.turns.finishTurn({ threadId: first.threadId, turnId: first.id, status: 'completed' })
    const second = await h.service.createRun(principal(), {
      input: 'Keep the latest model',
      workspace,
      threadId: first.threadId
    })
    expect(second.providerBinding.modelId).toBe('alternate-model')
  })

  it('fails closed before starting a turn when a thread model leaves the live catalog', async () => {
    const h = createHarness()
    const first = await h.service.createRun(principal(), {
      input: 'Use the alternate model',
      workspace,
      model: 'alternate-model'
    })
    await h.turns.finishTurn({ threadId: first.threadId, turnId: first.id, status: 'completed' })
    h.setRunOptions({
      defaultModel: 'default-model',
      models: [{
        id: 'default-model',
        displayName: 'Default model',
        selected: true,
        reasoningEfforts: ['off', 'high'],
        defaultReasoningEffort: 'high'
      }]
    })

    await expect(h.service.createRun(principal(), {
      input: 'Continue with a removed model',
      workspace,
      threadId: first.threadId
    })).rejects.toMatchObject({ code: 'conflict' })
    expect((await h.threads.get(first.threadId))?.turns).toHaveLength(1)
  })

  it('rejects unavailable models, unsupported reasoning, and provider-profile overrides', async () => {
    const h = createHarness()
    await expect(h.service.createRun(principal(), {
      input: 'Unknown model', workspace, model: 'missing-model'
    })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(h.service.createRun(principal(), {
      input: 'Unsupported effort', workspace, model: 'default-model', reasoningEffort: 'max'
    })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(h.service.createRun(principal(), {
      input: 'Cross provider', workspace, profileId: 'reviewer', model: 'alternate-model'
    })).rejects.toMatchObject({ code: 'validation_error' })
    const first = await h.service.createRun(principal(), { input: 'Start', workspace })
    await h.turns.finishTurn({ threadId: first.threadId, turnId: first.id, status: 'completed' })
    await expect(h.service.createRun(principal(), {
      input: 'Do not mix bindings',
      workspace,
      threadId: first.threadId,
      model: 'alternate-model',
      providerBinding: {
        providerId: 'example-provider',
        accountId: 'account_1',
        modelId: 'example-model'
      }
    })).rejects.toMatchObject({ code: 'validation_error' })
    expect((await h.threads.get(first.threadId))?.turns).toHaveLength(1)
    await expect(h.service.getRunOptions({
      ...principal(), permissions: ['agent.threads.readOwn']
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })
})
