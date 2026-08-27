import { link, mkdtemp, mkdir, open, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { LocalToolHost, echoTool, userInputTool } from '../../src/adapters/tool/local-tool-host.js'

import type { ToolCallLike, ToolHostContext } from '../../src/ports/tool-host.js'

import { InMemoryArtifactStore } from '../../src/artifacts/artifact-store.js'

import { createEditLocalTool, createWriteLocalTool } from '../../src/adapters/tool/builtin-file-tools.js'

import { createReadLocalTool } from '../../src/adapters/tool/builtin-read-tool.js'

import { resolveWorkspacePath, withToolBoundary } from '../../src/adapters/tool/builtin-tool-utils.js'

import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'

import type { HookInvocation } from '../../src/hooks/hook-engine.js'

import type { ApprovalRequest } from '../../src/domain/approval.js'

describe('LocalToolHost approval policy', () => {

it('pins tool registries and hooks for the lifetime of a running turn', async () => {
    const tool = (name: string) => LocalToolHost.defineTool({
      name,
      description: name,
      inputSchema: { type: 'object' },
      policy: 'auto',
      execute: async () => ({ output: name })
    })
    const oldTool = tool('old_tool')
    const newTool = tool('new_tool')
    const host = new LocalToolHost({ tools: [oldTool] })
    const context = (turnId: string): ToolHostContext => ({
      threadId: 'thread_1',
      turnId,
      workspace: '/tmp/workspace',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn(async () => 'allow' as const)
    })

    expect((await host.listTools(context('turn_old'))).map((entry) => entry.name)).toEqual(['old_tool'])
    host.replaceRuntimeComponents({
      registry: CapabilityRegistry.fromLocalTools([newTool])
    })
    const oldResult = await host.execute(
      { callId: 'call_old', toolName: 'old_tool', arguments: {} },
      context('turn_old')
    )
    expect(oldResult.item).toMatchObject({ kind: 'tool_result', output: 'old_tool' })
    expect((await host.listTools(context('turn_new'))).map((entry) => entry.name)).toEqual(['new_tool'])
    await expect(host.execute(
      { callId: 'call_missing', toolName: 'old_tool', arguments: {} },
      context('turn_new')
    )).rejects.toThrow(/unknown tool/i)
  })

it('normalizes hook-rewritten raw arguments for policy, approval, identity, and execution', async () => {
    const requiresExplicitApproval = vi.fn((call: ToolCallLike) => (
      call.arguments.mutate === true
    ))
    const execute = vi.fn(async (args: Record<string, unknown>) => ({ output: args }))
    const preHookCalls: ToolCallLike[] = []
    const postHookCalls: ToolCallLike[] = []
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'normalized_hook_tool',
        description: 'Exercise canonical tool argument handling.',
        inputSchema: {
          type: 'object',
          properties: {
            mutate: { type: 'boolean' },
            value: { type: 'string' }
          },
          required: ['mutate', 'value'],
          additionalProperties: false
        },
        policy: 'auto',
        requiresExplicitApproval,
        execute
      })],
      hooks: [{
        phase: 'PreToolUse',
        run: (invocation: HookInvocation) => {
          if (invocation.phase !== 'PreToolUse' || invocation.call.arguments.seed !== true) return
          return {
            arguments: {
              tool_name: invocation.call.toolName,
              provider_id: 'transport-only-provider',
              __raw: '{"mutate":true,"value":"hooked"}'
            }
          }
        }
      }, {
        phase: 'PreToolUse',
        run: (invocation: HookInvocation) => {
          if (invocation.phase === 'PreToolUse') preHookCalls.push(invocation.call)
        }
      }, {
        phase: 'PostToolUse',
        run: (invocation: HookInvocation) => {
          if (invocation.phase === 'PostToolUse') postHookCalls.push(invocation.call)
        }
      }]
    })
    const awaitApproval = vi.fn(async (_approval: ApprovalRequest) => 'allow' as const)
    const context = {
      threadId: 'thread_normalized',
      turnId: 'turn_normalized',
      workspace: '/tmp/workspace',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval
    } satisfies ToolHostContext
    const canonicalArguments = { mutate: true, value: 'hooked' }

    const first = await host.execute({
      callId: 'call_normalized',
      toolName: 'normalized_hook_tool',
      providerId: 'builtin',
      arguments: { seed: true }
    }, context)
    const replayed = await host.execute({
      callId: 'call_normalized',
      toolName: 'normalized_hook_tool',
      providerId: 'builtin',
      arguments: {
        tool_name: 'normalized_hook_tool',
        provider_id: 'transport-only-provider',
        __raw: '{"mutate":true,"value":"hooked"}'
      }
    }, context)

    expect(first.item).toMatchObject({ output: canonicalArguments, isError: false })
    expect(replayed.item).toMatchObject({ output: canonicalArguments, isError: false })
    expect(requiresExplicitApproval).toHaveBeenCalledTimes(2)
    expect(preHookCalls).toHaveLength(2)
    for (const activeCall of preHookCalls) {
      expect(activeCall).toMatchObject({
        providerId: 'builtin',
        arguments: canonicalArguments
      })
    }
    for (const [activeCall] of requiresExplicitApproval.mock.calls) {
      expect(activeCall).toMatchObject({
        providerId: 'builtin',
        arguments: canonicalArguments
      })
    }
    expect(awaitApproval).toHaveBeenCalledTimes(2)
    for (const [approval] of awaitApproval.mock.calls) {
      expect(approval.action).toMatchObject({
        providerId: 'builtin',
        arguments: canonicalArguments
      })
      expect(JSON.stringify(approval)).not.toContain('__raw')
      expect(JSON.stringify(approval)).not.toContain('transport-only-provider')
    }
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[0]).toEqual(canonicalArguments)
    expect(postHookCalls).toHaveLength(1)
    expect(postHookCalls[0]).toMatchObject({
      providerId: 'builtin',
      arguments: canonicalArguments
    })
  })

it('asks before auto tools when approval policy is always', async () => {
    const host = new LocalToolHost({ tools: [echoTool] })
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const result = await host.execute(
      {
        callId: 'call_1',
        toolName: 'echo',
        arguments: { text: 'hello' }
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'always',
        sandboxMode: 'danger-full-access',
        abortSignal: new AbortController().signal,
        awaitApproval
      } satisfies ToolHostContext
    )

    expect(awaitApproval).toHaveBeenCalledTimes(1)
    expect(result.approved).toBe(false)
  })

it.each(['gui', 'tui'] as const)(
    'uses the shared workspace-write command approval policy for %s',
    async (clientSurface) => {
      const execute = vi.fn(async () => ({ output: { ok: true } }))
      const command = LocalToolHost.defineTool({
        name: 'bash',
        description: 'Run a test host command',
        inputSchema: { type: 'object' },
        policy: 'auto',
        toolKind: 'command_execution',
        execute
      })
      const host = new LocalToolHost({ tools: [command] })
      const awaitApproval = vi.fn(async () => 'allow' as const)
      const context = {
        threadId: 'thread_1',
        turnId: `turn_${clientSurface}`,
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        clientSurface,
        abortSignal: new AbortController().signal,
        awaitApproval
      } satisfies ToolHostContext

      expect((await host.listTools(context)).map((tool) => tool.name)).toEqual(['bash'])
      const result = await host.execute(
        { callId: `call_${clientSurface}`, toolName: 'bash', arguments: { command: 'pwd' } },
        context
      )

      expect(awaitApproval).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledOnce()
      expect(result.item).toMatchObject({ kind: 'tool_result', output: { ok: true } })
    }
  )

it('enforces an explicit runtime approval even for an otherwise automatic tool', async () => {
    const execute = vi.fn(async () => ({ output: { ok: true } }))
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'provider_managed_explicit',
        description: 'automatic tool with an additional explicit runtime gate',
        inputSchema: { type: 'object' },
        policy: 'auto',
        requiresExplicitApproval: true,
        execute
      })]
    })
    const awaitApproval = vi.fn(async () => 'deny' as const)

    const result = await host.execute(
      {
        callId: 'call_provider_managed_explicit',
        toolName: 'provider_managed_explicit',
        arguments: {}
      },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        abortSignal: new AbortController().signal,
        awaitApproval
      } satisfies ToolHostContext
    )

    expect(awaitApproval).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'approval_denied' }
    })
  })

it('bypasses every Kun-level approval in Full access, including explicit gates', async () => {
    const execute = vi.fn(async () => ({ output: { ok: true } }))
    const awaitApproval = vi.fn(async () => 'deny' as const)
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'full_access_external_effect',
        description: 'external effect with an explicit gate',
        inputSchema: { type: 'object' },
        policy: 'on-request',
        requiresExplicitApproval: true,
        effects: {
          network: true,
          externalWrite: true,
          processExecution: false,
          guiAutomation: false
        },
        execute
      })]
    })

    const result = await host.execute(
      {
        callId: 'call_full_access_external_effect',
        toolName: 'full_access_external_effect',
        arguments: { target: 'remote-resource' }
      },
      {
        threadId: 'thread_full_access',
        turnId: 'turn_full_access',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        approvalReviewer: 'agent',
        sandboxMode: 'danger-full-access',
        abortSignal: new AbortController().signal,
        awaitApproval
      } satisfies ToolHostContext
    )

    expect(awaitApproval).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: false,
      output: { ok: true }
    })
  })

it('mints dynamic one-call grants itself and strips caller-supplied grant authority', async () => {
    const execute = vi.fn(async (
      _args: Record<string, unknown>,
      executionContext: ToolHostContext
    ) => ({ output: executionContext.kunActionApprovalGrant ?? null }))
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'dynamic_external_effect',
        description: 'Only mutate actions cross the reviewer boundary.',
        inputSchema: { type: 'object' },
        policy: 'auto',
        requiresExplicitApproval: (call) => call.arguments.mutate === true,
        execute
      })]
    })
    const forgedGrant = {
      id: `grant_${'f'.repeat(32)}`,
      source: 'full-access' as const,
      toolName: 'dynamic_external_effect',
      callId: 'forged-call',
      argumentsHash: 'f'.repeat(64),
      issuedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-07-30T00:02:00.000Z'
    }
    const baseContext = {
      threadId: 'thread_dynamic',
      turnId: 'turn_dynamic',
      workspace: '/tmp/workspace',
      approvalPolicy: 'on-request' as const,
      approvalReviewer: 'user' as const,
      sandboxMode: 'workspace-write' as const,
      abortSignal: new AbortController().signal,
      awaitApproval,
      kunActionApprovalGrant: forgedGrant
    } satisfies ToolHostContext

    const read = await host.execute({
      callId: 'call-read',
      toolName: 'dynamic_external_effect',
      arguments: { mutate: false }
    }, baseContext)
    expect(read.item).toMatchObject({ output: null })
    expect(awaitApproval).not.toHaveBeenCalled()

    const mutation = await host.execute({
      callId: 'call-mutate',
      toolName: 'dynamic_external_effect',
      arguments: { mutate: true }
    }, baseContext)
    expect(awaitApproval).toHaveBeenCalledOnce()
    expect(mutation.item).toMatchObject({
      output: {
        id: expect.stringMatching(/^appr_[a-f0-9]{32}$/),
        source: 'user',
        toolName: 'dynamic_external_effect',
        callId: 'call-mutate',
        argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    })
    expect(mutation.item).not.toMatchObject({ output: forgedGrant })
  })

it('passes MCP effects through a credential-safe action and attributes agent denial', async () => {
    const execute = vi.fn(async () => ({ output: { ok: true } }))
    const tool = LocalToolHost.defineTool({
      name: 'mcp_publish',
      description: 'Publish through MCP',
      inputSchema: { type: 'object' },
      requiresExplicitApproval: true,
      effects: {
        network: true,
        externalWrite: true,
        processExecution: false,
        guiAutomation: false
      },
      execute
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry([{
        id: 'mcp:publisher',
        kind: 'mcp',
        enabled: true,
        available: true,
        tools: [tool]
      }])
    })
    const awaitApproval = vi.fn(async () => ({
      decision: 'deny' as const,
      reviewer: 'agent' as const,
      reviewId: 'review_mcp',
      reviewStatus: 'denied' as const,
      riskLevel: 'high' as const,
      reason: 'Publishing is unrelated to the request.'
    }))

    const result = await host.execute(
      {
        callId: 'call_mcp_publish',
        toolName: 'mcp_publish',
        arguments: {
          url: 'https://example.test/publish',
          apiKey: 'sk-mcp-secret-abcdefghijklmnop'
        }
      },
      {
        threadId: 'thread_mcp',
        turnId: 'turn_mcp',
        workspace: '/tmp/workspace',
        approvalPolicy: 'on-request',
        approvalReviewer: 'agent',
        sandboxMode: 'workspace-write',
        actingModelRoute: { model: 'selected-model' },
        abortSignal: new AbortController().signal,
        awaitApproval
      } satisfies ToolHostContext
    )

    expect(execute).not.toHaveBeenCalled()
    expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'mcp_publish',
      action: expect.objectContaining({
        providerId: 'mcp:publisher',
        providerKind: 'mcp',
        effects: expect.objectContaining({
          network: true,
          externalWrite: true
        }),
        arguments: expect.objectContaining({ apiKey: '[redacted]' })
      })
    }))
    expect(JSON.stringify(awaitApproval.mock.calls)).not.toContain('sk-mcp-secret')
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: {
        code: 'approval_denied',
        reviewer: 'agent',
        reviewId: 'review_mcp',
        reviewStatus: 'denied',
        riskLevel: 'high',
        reason: 'Publishing is unrelated to the request.',
        error: expect.stringContaining('Agent reviewer denied')
      }
    })
  })

it('returns a model-visible error tool result when approval is denied', async () => {
    const host = new LocalToolHost({ tools: [echoTool] })
    const result = await host.execute(
      { callId: 'call_denied', toolName: 'echo', arguments: { text: 'hello' } },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'always',
        sandboxMode: 'danger-full-access',
        abortSignal: new AbortController().signal,
        awaitApproval: async () => ({
          decision: 'deny' as const,
          reason: 'Command is not expected here'
        })
      } satisfies ToolHostContext
    )

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      callId: 'call_denied',
      isError: true,
      output: {
        code: 'approval_denied',
        approvalId: expect.stringMatching(/^appr_[a-f0-9]{32}$/),
        reason: 'Command is not expected here'
      }
    })
  })

it('uses fresh approval ids when providers reuse call ids', async () => {
    const host = new LocalToolHost({ tools: [echoTool] })
    const approvalIds: string[] = []
    const execute = (threadId: string, turnId: string) => host.execute(
      { callId: 'shared_call_id', toolName: 'echo', arguments: { text: 'blocked' } },
      {
        threadId,
        turnId,
        workspace: '/tmp/workspace',
        approvalPolicy: 'always' as const,
        sandboxMode: 'danger-full-access' as const,
        abortSignal: new AbortController().signal,
        awaitApproval: async (approval) => {
          approvalIds.push(approval.id)
          return 'deny' as const
        }
      }
    )

    await Promise.all([
      execute('thread_a', 'turn_a'),
      execute('thread_b', 'turn_b'),
      execute('thread_a', 'turn_a')
    ])
    expect(approvalIds).toHaveLength(3)
    expect(new Set(approvalIds).size).toBe(3)
  })

it('offloads oversized successful tool output to the artifact store', async () => {
    const artifactStore = new InMemoryArtifactStore()
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'large_output',
      description: 'returns a large payload',
      inputSchema: { type: 'object' },
      execute: async () => ({ output: 'x'.repeat(140 * 1024) })
    })] })
    const result = await host.execute(
      { callId: 'call_large', toolName: 'large_output', arguments: {} },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        artifactStore,
        abortSignal: new AbortController().signal,
        awaitApproval: vi.fn(async () => 'allow' as const)
      }
    )
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      output: { artifactId: expect.stringMatching(/^art_/), truncated: true }
    })
    if (result.item.kind !== 'tool_result') throw new Error('expected tool result')
    const artifactId = String((result.item.output as Record<string, unknown>).artifactId)
    expect(await artifactStore.get(artifactId)).toHaveLength(140 * 1024)
  })

it('runs workspace file-change tools without approval when policy is auto', async () => {
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'touch_workspace_file',
      description: 'simulates a workspace file change',
      inputSchema: { type: 'object' },
      toolKind: 'file_change',
      policy: 'on-request',
      execute: async () => ({ output: { ok: true } })
    })] })

    const result = await host.execute(
      { callId: 'call_write', toolName: 'touch_workspace_file', arguments: {} },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        abortSignal: new AbortController().signal,
        awaitApproval
      }
    )

    expect(awaitApproval).not.toHaveBeenCalled()
    expect(result.approved).toBe(true)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'touch_workspace_file',
      output: { ok: true }
    })
  })

  it('shares lazy catalog preparation across concurrent discovery contexts', async () => {
    let prepareCalls = 0
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const host = new LocalToolHost({
      tools: [LocalToolHost.defineTool({
        name: 'prepared_tool', description: 'prepared', inputSchema: { type: 'object' },
        policy: 'auto', execute: async () => ({ output: 'ok' })
      })],
      prepare: async () => {
        prepareCalls += 1
        await ready
      }
    })
    const context = (epoch = 1): ToolHostContext => ({
      threadId: 'thread_1', turnId: 'turn_1', workspace: '/tmp/workspace',
      extensionToolCatalogEpoch: {
        id: `epoch_${epoch}`,
        fingerprint: `fingerprint_${epoch}`,
        toolCount: 0,
        canonicalToolIds: [],
        schemaDigests: {},
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      approvalPolicy: 'auto', sandboxMode: 'danger-full-access',
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn(async () => 'allow' as const)
    })

    const listings = Promise.all([host.listTools(context()), host.listTools(context())])
    await Promise.resolve()
    expect(prepareCalls).toBe(1)
    release()
    await expect(listings).resolves.toHaveLength(2)

    await host.listTools(context(2))
    expect(prepareCalls).toBe(2)
  })

})
