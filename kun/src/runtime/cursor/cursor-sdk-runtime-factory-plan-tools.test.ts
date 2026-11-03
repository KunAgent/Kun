import { describe, expect, test, vi } from 'vitest'
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKMessage
} from '@cursor/sdk'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import { createCreatePlanTool } from '../../adapters/tool/create-plan-tool.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import {
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps
} from './cursor-sdk-runtime-factory.js'
import type { CursorSdkApi } from './cursor-sdk-runtime.js'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

function completedRun(): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'done'
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages([{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => undefined,
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: undefined,
    model: undefined,
    durationMs: undefined,
    usage: undefined,
    git: undefined,
    createdAt: 1
  }
}

describe('Cursor SDK runtime factory', () => {
  test('bridges create_plan through Cursor custom tools with Plan mode and sandbox policy intact', async () => {
    const planWrites: Array<{
      workspaceRoot: string
      relativePath: string
      markdown: string
    }> = []
    const createPlanTool = createCreatePlanTool({
      resolveWorkspaceRoot: async (workspace) => workspace,
      listPlanFiles: async () => [],
      writePlan: async (target) => {
        planWrites.push({
          workspaceRoot: target.workspaceRoot,
          relativePath: target.relativePath,
          markdown: target.markdown
        })
        return { path: target.absolutePath, savedAt: '2026-08-06T00:00:00.000Z' }
      }
    })
    const registry = CapabilityRegistry.fromLocalTools([createPlanTool])
    const toolHost = new LocalToolHost({ registry })
    const executeSpy = vi.spyOn(toolHost, 'execute')
    const threadStore = { get: async () => thread }
    const thread = {
      id: 'thread_plan',
      title: 'Cursor plan',
      workspace: '/tmp/cursor-plan',
      model: 'cursor-model',
      mode: 'plan',
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'workspace-write',
      turns: [{
        id: 'turn_plan',
        prompt: 'draft a plan',
        mode: 'plan',
        actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' }
      }]
    }
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost,
      providerConfigs: {},
      providerIds: new Set(['cursor-provider']),
      defaultIsCursor: false,
      defaultModel: 'cursor-model',
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'workspace-write',
      threadStore: threadStore as never,
      sessionStore: {} as never,
      turns: { updateTurnMetadata: async () => undefined } as never,
      events: { record: async () => undefined } as never,
      ids: { next: (prefix) => `${prefix}_1` }
    })
    const loadKunTurnContext = (runtime as unknown as {
      deps: {
        loadKunTurnContext(input: {
          threadId: string
          turnId: string
          userText: string
          actingModelRoute: { model: string; providerId?: string }
          signal: AbortSignal
        }): Promise<{
          tools: Array<{ name: string; toolKind?: string }>
          customTools: Record<string, {
            execute(
              args: Record<string, unknown>,
              context: { toolCallId?: string }
            ): Promise<unknown>
          }>
        }>
      }
    }).deps.loadKunTurnContext
    const input = {
      threadId: 'thread_plan',
      turnId: 'turn_plan',
      userText: 'draft a plan',
      actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' },
      signal: new AbortController().signal
    }

    const planning = await loadKunTurnContext(input)
    expect(planning.tools.map((tool) => tool.name)).toContain('create_plan')
    expect(planning.tools.find((tool) => tool.name === 'create_plan')?.toolKind)
      .toBe('file_change')
    expect(planning.customTools.create_plan).toBeDefined()

    const result = await planning.customTools.create_plan.execute(
      { markdown: '# Implementation plan\n\n- step 1' },
      { toolCallId: 'call_plan' }
    )
    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('Created Kun plan at') }]
    })
    expect(planWrites).toHaveLength(1)
    expect(planWrites[0]).toMatchObject({
      workspaceRoot: '/tmp/cursor-plan',
      relativePath: expect.stringContaining('.kunsdd/plan/')
    })
    expect(executeSpy).toHaveBeenCalled()
    expect(executeSpy.mock.calls[0]?.[0]).toMatchObject({
      toolName: 'create_plan',
      providerId: 'builtin',
      toolKind: 'file_change',
      callId: 'call_plan'
    })

    // Plan mode must not advertise create_plan on ordinary agent turns.
    thread.mode = 'agent'
    thread.turns[0].mode = 'agent'
    const agentContext = await loadKunTurnContext(input)
    expect(agentContext.tools.map((tool) => tool.name)).not.toContain('create_plan')
    expect(agentContext.customTools.create_plan).toBeUndefined()

    // Read-only sandbox hides the file-change plan tool from Cursor even in
    // Plan mode: Kun's sandbox policy gates advertisement, so the model can
    // never invoke a write that the read-only sandbox forbids.
    threadStore.get = async () => ({
      ...thread,
      mode: 'plan',
      sandboxMode: 'read-only',
      turns: [{ ...thread.turns[0]!, mode: 'plan' }]
    })
    const readOnlyContext = await loadKunTurnContext(input)
    expect(readOnlyContext.tools.map((tool) => tool.name)).not.toContain('create_plan')
    expect(readOnlyContext.customTools.create_plan).toBeUndefined()
  })

  test.each([
    {
      decision: 'allow' as const,
      reviewStatus: 'approved' as const,
      executed: true
    },
    {
      decision: 'deny' as const,
      reviewStatus: 'denied' as const,
      executed: false
    }
  ])('routes Cursor Kun tools through agent review ($decision)', async ({
    decision,
    reviewStatus,
    executed
  }) => {
    const execute = vi.fn(async () => ({ output: { published: true } }))
    const registry = new CapabilityRegistry([{
      id: 'mcp:publisher',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [LocalToolHost.defineTool({
        name: 'mcp_publish',
        description: 'Publish with MCP',
        inputSchema: { type: 'object' },
        requiresExplicitApproval: true,
        effects: {
          network: true,
          externalWrite: true,
          processExecution: false,
          guiAutomation: false
        },
        execute
      })]
    }])
    const toolHost = new LocalToolHost({ registry })
    const approvalGate = new InMemoryApprovalGate()
    const gateRequest = vi.spyOn(approvalGate, 'request')
    const review = vi.fn(async () => ({
      decision,
      reviewer: 'agent' as const,
      reviewId: 'review_cursor',
      reviewStatus,
      riskLevel: decision === 'allow' ? 'low' as const : 'high' as const,
      reason: decision === 'allow'
        ? 'Action matches intent.'
        : 'Action exceeds intent.'
    }))
    const record = vi.fn(async () => undefined)
    const thread = {
      id: 'thread_cursor_review',
      title: 'Cursor review',
      workspace: '/tmp/cursor-review',
      model: 'cursor-model',
      mode: 'agent',
      approvalPolicy: 'on-request',
      approvalReviewer: 'agent',
      sandboxMode: 'workspace-write',
      turns: [{
        id: 'turn_cursor_review',
        prompt: 'Publish the report',
        approvalReviewer: 'agent',
        actingModelRoute: {
          model: 'cursor-model',
          providerId: 'cursor-provider',
          accountId: 'cursor-account'
        }
      }]
    }
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost,
      providerConfigs: {},
      providerIds: new Set(['cursor-provider']),
      defaultIsCursor: false,
      defaultModel: 'cursor-model',
      defaultApprovalPolicy: 'on-request',
      defaultSandboxMode: 'workspace-write',
      defaultApprovalReviewer: 'agent',
      threadStore: { get: async () => thread } as never,
      sessionStore: {} as never,
      turns: {} as never,
      events: { record } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      approvalGate,
      approvalReview: { review }
    })
    const loadKunTurnContext = (runtime as unknown as {
      deps: {
        loadKunTurnContext(input: {
          threadId: string
          turnId: string
          userText: string
          actingModelRoute: {
            model: string
            providerId?: string
            accountId?: string
          }
          signal: AbortSignal
        }): Promise<{
          customTools: Record<string, {
            execute(
              args: Record<string, unknown>,
              context: { toolCallId?: string }
            ): Promise<unknown>
          }>
        }>
      }
    }).deps.loadKunTurnContext
    const context = await loadKunTurnContext({
      threadId: 'thread_cursor_review',
      turnId: 'turn_cursor_review',
      userText: 'Publish the report',
      actingModelRoute: {
        model: 'cursor-model',
        providerId: 'cursor-provider',
        accountId: 'cursor-account'
      },
      signal: new AbortController().signal
    })
    // A settings/thread edit after the turn starts must not replace the
    // captured reviewer, policy, sandbox, or model route for this invocation.
    Object.assign(thread, {
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'danger-full-access'
    })
    Object.assign(thread.turns[0]!, {
      approvalReviewer: 'user',
      actingModelRoute: {
        model: 'later-model',
        providerId: 'later-provider',
        accountId: 'later-account'
      }
    })

    const result = await context.customTools.mcp_publish?.execute(
      {
        url: 'https://example.test/publish',
        apiKey: 'sk-cursor-secret-abcdefghijklmnop'
      },
      { toolCallId: 'cursor_call_1' }
    )

    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      route: expect.objectContaining({
        model: 'cursor-model',
        providerId: 'cursor-provider',
        accountId: 'cursor-account'
      }),
      intent: 'Publish the report',
      approval: expect.objectContaining({
        action: expect.objectContaining({
          providerId: 'mcp:publisher',
          providerKind: 'mcp',
          arguments: expect.objectContaining({ apiKey: '[redacted]' })
        })
      })
    }))
    expect(JSON.stringify(review.mock.calls)).not.toContain('sk-cursor-secret')
    expect(execute).toHaveBeenCalledTimes(executed ? 1 : 0)
    expect(result).toMatchObject(
      executed
        ? { content: [{ type: 'text', text: expect.stringContaining('published') }] }
        : {
            isError: true,
            content: [{
              type: 'text',
              text: expect.stringContaining('Agent reviewer denied')
            }]
          }
    )
    expect(gateRequest).not.toHaveBeenCalled()
    expect(approvalGate.pending()).toEqual([])
    expect(record).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval_requested'
    }))
  })
})
