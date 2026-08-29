import { describe, expect, it, vi } from 'vitest'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createApprovalRequest } from '../domain/approval.js'
import type { ToolTurnContextInput } from './turn-execution-types.js'
import {
  createToolDiscoveryContext,
  modelToolDiscoveryContexts
} from './tool-discovery-context-factory.js'

function turnContextInput(signal: AbortSignal): ToolTurnContextInput {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/workspace',
    clientSurface: 'gui',
    threadMode: 'plan',
    activePlanContext: {
      operation: 'draft', workspaceRoot: '/workspace', relativePath: 'plan.md', planId: 'plan_1'
    },
    guiDesignCanvas: true,
    guiDesignMode: true,
    modelProviderId: 'provider_1',
    modelCapabilities: {
      id: 'model_1',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    activeSkillIds: ['skill_1'],
    allowedToolNames: ['read'],
    approvalPolicy: 'always',
    sandboxMode: 'workspace-write',
    signal
  }
}

describe('createToolDiscoveryContext', () => {
  it('keeps approval inert while retaining schema visibility inputs', async () => {
    const signal = new AbortController().signal
    const awaitUserInput = vi.fn(async () => ({ status: 'submitted' as const, answers: [] }))
    const context = createToolDiscoveryContext(turnContextInput(signal), {
      memoryEnabled: true,
      blockedProviderIds: ['mcp:blocked'],
      blockedToolNames: ['blocked_tool'],
      blockedSkillIds: ['blocked_skill'],
      runtimeDataDir: '/runtime',
      fastContext: true,
      fastContextScopeId: 'parent_thread_1',
      fastContextTaskCount: 2,
      interactiveToolBridge: { awaitUserInput }
    })
    const approval = createApprovalRequest({
      id: 'approval_1', threadId: 'thread_1', turnId: 'turn_1', toolName: 'read', summary: 'Read file'
    })

    await expect(context.awaitApproval(approval)).resolves.toBe('allow')
    await expect(context.awaitUserInput?.({
      id: 'input_1', itemId: 'item_input_1', prompt: 'Continue?', questions: []
    })).resolves.toEqual({ status: 'submitted', answers: [] })

    expect(context).toMatchObject({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/workspace',
      threadMode: 'plan',
      guiPlan: expect.objectContaining({ planId: 'plan_1' }),
      model: expect.objectContaining({ id: 'model_1' }),
      activeSkillIds: ['skill_1'],
      memoryPolicy: { enabled: true },
      approvalPolicy: 'always',
      sandboxMode: 'workspace-write',
      blockedProviderIds: ['mcp:blocked'],
      blockedToolNames: ['blocked_tool'],
      blockedSkillIds: ['blocked_skill'],
      fastContext: true,
      fastContextScopeId: 'parent_thread_1',
      fastContextTaskCount: 2
    })
    // Discovery intentionally does not inherit execution-only routing or
    // artifact persistence capabilities.
    expect(context.modelProviderId).toBeUndefined()
    expect(context.artifactStore).toBeUndefined()
    expect(awaitUserInput).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1', turnId: 'turn_1', signal
    }))
  })

  it('omits user input when the turn explicitly disables it', () => {
    const context = createToolDiscoveryContext({
      ...turnContextInput(new AbortController().signal),
      userInputDisabled: true
    }, {
      memoryEnabled: false,
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })

    expect(context.awaitUserInput).toBeUndefined()
  })

  it('keeps Design UI continuation metadata out of tool policy', () => {
    const context = createToolDiscoveryContext({
      ...turnContextInput(new AbortController().signal),
      messageSource: 'design_continuation'
    }, {
      memoryEnabled: false,
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })

    expect(context.messageSource).toBeUndefined()
  })

  it('uses one stable model catalog scope without widening execution authority', async () => {
    const signal = new AbortController().signal
    const {
      activePlanContext: _activePlanContext,
      allowedToolNames: _allowedToolNames,
      ...normalInput
    } = turnContextInput(signal)
    const base = createToolDiscoveryContext({
      ...normalInput,
      threadMode: 'agent',
      agentSurface: 'design'
    }, {
      memoryEnabled: false,
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const contexts = modelToolDiscoveryContexts(base)

    expect(contexts).toEqual([
      expect.objectContaining({
        agentSurface: 'code',
        guiDesignCanvas: true
      }),
      expect.objectContaining({
        agentSurface: 'design',
        guiDesignCanvas: true,
        guiDesignMode: true
      })
    ])
    expect(contexts[0]).not.toHaveProperty('guiDesignMode')
    expect(modelToolDiscoveryContexts({
      ...base,
      orchestration: 'graph'
    })).toEqual([expect.objectContaining({ orchestration: 'graph' })])
    expect(modelToolDiscoveryContexts({
      ...base,
      agentSurface: 'write'
    })).toEqual([expect.objectContaining({ agentSurface: 'write' })])

    const designOnly = LocalToolHost.defineTool({
      name: 'design_only',
      description: 'Design-only tool.',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      shouldAdvertise: (context) => context.agentSurface === 'design',
      execute: async () => ({ output: { ok: true } })
    })
    const host = new LocalToolHost({ tools: [designOnly] })
    const advertised = (await Promise.all(contexts.map((context) => host.listTools(context))))
      .flat()
      .map((tool) => tool.name)
    expect(advertised).toContain('design_only')
    const { guiDesignMode: _guiDesignMode, ...codeContext } = base
    await expect(host.execute({
      callId: 'call_design', toolName: 'design_only', arguments: {}
    }, {
      ...codeContext,
      agentSurface: 'code',
      guiDesignCanvas: false
    })).rejects.toThrow('tool design_only is not advertised in this turn context')
  })
})
