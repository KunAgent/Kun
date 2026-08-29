import { describe, expect, it, vi } from 'vitest'
import { createApprovalRequest } from '../domain/approval.js'
import type { ToolDispatchInput } from './turn-execution-types.js'
import { createToolExecutionContext } from './tool-context-factory.js'

function dispatchInput(signal: AbortSignal): ToolDispatchInput {
  return {
    calls: [],
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/workspace',
    clientSurface: 'gui',
    threadMode: 'agent',
    modelProviderId: 'provider_1',
    reasoningEffort: 'high',
    modelCapabilities: {
      id: 'model_1',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    activeSkillIds: ['skill_1'],
    allowedToolNames: ['read'],
    toolProviderKinds: new Map(),
    approvalPolicy: 'always',
    sandboxMode: 'workspace-write',
    signal
  }
}

describe('createToolExecutionContext', () => {
  it('builds a real approval and user-input execution context', async () => {
    const signal = new AbortController().signal
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const awaitUserInput = vi.fn(async () => ({ status: 'submitted' as const, answers: [] }))
    const context = createToolExecutionContext(dispatchInput(signal), {
      memoryEnabled: true,
      blockedProviderIds: ['mcp:blocked'],
      blockedToolNames: ['blocked_tool'],
      blockedSkillIds: ['blocked_skill'],
      runtimeDataDir: '/runtime',
      fastContext: true,
      fastContextScopeId: 'parent_thread_1',
      fastContextTaskCount: 2,
      interactiveToolBridge: { awaitApproval, awaitUserInput }
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
      modelProviderId: 'provider_1',
      reasoningEffort: 'high',
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
    expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
      approval,
      approvalPolicy: 'always',
      sandboxMode: 'workspace-write',
      signal
    }))
    expect(awaitUserInput).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_1', turnId: 'turn_1', signal
    }))
  })

  it('omits user input when the turn explicitly disables it', () => {
    const input = { ...dispatchInput(new AbortController().signal), userInputDisabled: true }
    const context = createToolExecutionContext(input, {
      memoryEnabled: false,
      interactiveToolBridge: {
        awaitApproval: async () => 'deny',
        awaitUserInput: async () => ({ status: 'cancelled' })
      }
    })

    expect(context.awaitUserInput).toBeUndefined()
  })

  it('keeps Design UI continuation metadata out of tool execution semantics', () => {
    const context = createToolExecutionContext({
      ...dispatchInput(new AbortController().signal),
      messageSource: 'design_continuation'
    }, {
      memoryEnabled: false,
      interactiveToolBridge: {
        awaitApproval: async () => 'deny',
        awaitUserInput: async () => ({ status: 'cancelled' })
      }
    })

    expect(context.messageSource).toBeUndefined()
  })
})
