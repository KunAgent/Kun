import { describe, expect, it, vi } from 'vitest'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { createApprovalRequest } from '../domain/approval.js'
import type { ToolTurnContextInput } from './turn-execution-types.js'
import { createToolDiscoveryContext } from './tool-discovery-context-factory.js'

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
  it('fences the host-reserved Gmail model before its first request without guessing other providers', async () => {
    const signal = new AbortController().signal
    const input = { ...turnContextInput(signal), modelProviderId: 'kun-gmail-local', threadMode: 'agent' as const,
      activePlanContext: undefined, allowedToolNames: undefined }
    const context = createToolDiscoveryContext(input, {
      memoryEnabled: false, interactiveToolBridge: { awaitUserInput: vi.fn() }
    })
    const make = (name: string) => LocalToolHost.defineTool({ name, description: name, inputSchema: {}, policy: 'auto',
      execute: async () => ({ output: 'not executed' }) })
    const native = ['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send']
    const host = new LocalToolHost({ registry: new CapabilityRegistry([
      { id: 'gmail', kind: 'built-in', enabled: true, available: true, tools: native.map(make) },
      { id: 'builtin', kind: 'built-in', enabled: true, available: true, tools: [make('bash'), make('web_search')] }
    ]) })
    expect(context.modelProviderId).toBe('kun-gmail-local')
    expect((await host.listTools(context)).map((spec) => spec.name)).toEqual(native)
  })
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

    await expect(context.awaitApproval(approval)).resolves.toBe('deny')
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

  it('does not invent canvas capabilities for a Code conversation', () => {
    const context = createToolDiscoveryContext({
      ...turnContextInput(new AbortController().signal),
      threadMode: 'agent',
      agentSurface: 'code',
      activePlanContext: undefined,
      guiDesignCanvas: false,
      guiExcalidrawCanvas: false,
      guiDesignMode: false
    }, {
      memoryEnabled: false,
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })

    expect(context.agentSurface).toBe('code')
    expect(context).not.toHaveProperty('guiDesignCanvas')
    expect(context).not.toHaveProperty('guiExcalidrawCanvas')
    expect(context).not.toHaveProperty('guiDesignMode')
  })
})
