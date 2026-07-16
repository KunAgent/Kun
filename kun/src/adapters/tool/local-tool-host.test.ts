import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LocalToolHost, echoTool, userInputTool } from './local-tool-host.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'
import { resolveWorkspacePath } from './builtin-tool-utils.js'
import { createWriteLocalTool } from './builtin-file-tools.js'

describe('LocalToolHost approval policy', () => {
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

  it('asks before an external workspace-write path and scopes the grant to that call', async () => {
    const awaitApproval = vi.fn(async () => 'allow' as const)
    const execute = vi.fn(async (args: Record<string, unknown>, context: ToolHostContext) => ({
      output: {
        approvedExternalPaths: context.approvedExternalPaths,
        requestedPath: args.path
      }
    }))
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'write_external',
      description: 'simulates a file change outside the workspace',
      inputSchema: { type: 'object' },
      toolKind: 'file_change',
      policy: 'auto',
      execute
    })] })

    const result = await host.execute(
      { callId: 'call_external', toolName: 'write_external', arguments: { path: '../outside.txt' } },
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

    expect(awaitApproval).toHaveBeenCalledTimes(1)
    expect(awaitApproval).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.stringContaining('outside the workspace') })
    )
    expect(execute).toHaveBeenCalledWith(
      { path: '../outside.txt' },
      expect.objectContaining({ approvedExternalPaths: [resolvePath('/tmp/outside.txt')] }),
      expect.any(Function)
    )
    expect(result.item).toMatchObject({
      output: {
        approvedExternalPaths: [resolvePath('/tmp/outside.txt')],
        requestedPath: '../outside.txt'
      }
    })
  })

  it('does not execute an external path when the per-operation approval is denied', async () => {
    const execute = vi.fn(async () => ({ output: { ran: true } }))
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'write_external_denied',
      description: 'simulates a denied external file change',
      inputSchema: { type: 'object' },
      toolKind: 'file_change',
      policy: 'auto',
      execute
    })] })

    const result = await host.execute(
      { callId: 'call_external_denied', toolName: 'write_external_denied', arguments: { path: '../outside.txt' } },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        abortSignal: new AbortController().signal,
        awaitApproval: vi.fn(async () => ({ decision: 'deny' as const, reason: 'not now' }))
      }
    )

    expect(execute).not.toHaveBeenCalled()
    expect(result.item).toMatchObject({ isError: true, output: { code: 'approval_denied', reason: 'not now' } })
  })

  it('does not expand an approved external path to a sibling path', async () => {
    let approvedPath = ''
    const execute = vi.fn(async (_args: Record<string, unknown>, context: ToolHostContext) => {
      approvedPath = context.approvedExternalPaths?.[0] ?? ''
      await expect(resolveWorkspacePath('../outside.txt', context)).resolves.toMatchObject({
        absolutePath: approvedPath
      })
      await expect(resolveWorkspacePath('../sibling.txt', context)).rejects.toThrow()
      return { output: { ok: true } }
    })
    const host = new LocalToolHost({ tools: [LocalToolHost.defineTool({
      name: 'write_external_exact',
      description: 'checks that an external approval remains path-scoped',
      inputSchema: { type: 'object' },
      toolKind: 'file_change',
      policy: 'auto',
      execute
    })] })

    const result = await host.execute(
      { callId: 'call_external_exact', toolName: 'write_external_exact', arguments: { path: '../outside.txt' } },
      {
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/workspace',
        approvalPolicy: 'auto',
        sandboxMode: 'workspace-write',
        abortSignal: new AbortController().signal,
        awaitApproval: vi.fn(async () => 'allow' as const)
      }
    )

    expect(execute).toHaveBeenCalledTimes(1)
    expect(approvedPath).toBeTruthy()
    expect(result.item).toMatchObject({ output: { ok: true } })
  })

  it('writes a real external target only after a per-call approval', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-workspace-'))
    const external = await mkdtemp(join(tmpdir(), 'kun-external-'))
    const target = join(external, 'approved.txt')
    try {
      const awaitApproval = vi.fn(async () => 'allow' as const)
      const host = new LocalToolHost({ tools: [createWriteLocalTool()] })
      const result = await host.execute(
        { callId: 'call_write_external_file', toolName: 'write', arguments: { path: target, content: 'approved' } },
        {
          threadId: 'thread_1',
          turnId: 'turn_1',
          workspace,
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          abortSignal: new AbortController().signal,
          awaitApproval
        } satisfies ToolHostContext
      )

      expect(awaitApproval).toHaveBeenCalledTimes(1)
      expect(result.item).toMatchObject({ isError: false })
      await expect(readFile(target, 'utf8')).resolves.toBe('approved')
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(external, { recursive: true, force: true })
      ])
    }
  })

  it('rejects an approved external path when it is replaced by a symlink before execution', async (ctx) => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-workspace-'))
    const external = await mkdtemp(join(tmpdir(), 'kun-external-'))
    const approvedDirectory = join(external, 'approved')
    const protectedDirectory = join(external, 'protected')
    const target = join(approvedDirectory, 'target.txt')
    const protectedTarget = join(protectedDirectory, 'target.txt')
    let symlinkError: unknown
    try {
      await Promise.all([mkdir(approvedDirectory), mkdir(protectedDirectory)])
      await Promise.all([
        writeFile(target, 'original'),
        writeFile(protectedTarget, 'must survive')
      ])
      const host = new LocalToolHost({ tools: [createWriteLocalTool()] })
      const result = await host.execute(
        { callId: 'call_write_swapped_link', toolName: 'write', arguments: { path: target, content: 'overwrite' } },
        {
          threadId: 'thread_1',
          turnId: 'turn_1',
          workspace,
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          abortSignal: new AbortController().signal,
          awaitApproval: async () => {
            await rm(approvedDirectory, { recursive: true, force: true })
            try {
              await symlink(protectedDirectory, approvedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
            } catch (error) {
              symlinkError = error
              return 'deny'
            }
            return 'allow'
          }
        } satisfies ToolHostContext
      )

      if (symlinkError) {
        ctx.skip()
        return
      }
      expect(result.item).toMatchObject({
        isError: true,
        output: { error: expect.stringContaining('path escapes the workspace root') }
      })
      await expect(readFile(protectedTarget, 'utf8')).resolves.toBe('must survive')
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(external, { recursive: true, force: true })
      ])
    }
  })

  it('keeps user input tools advertised without a GUI gate but rejects execution', async () => {
    const host = new LocalToolHost({ tools: [echoTool, userInputTool] })
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/tmp/workspace',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn(async () => 'allow' as const)
    } satisfies ToolHostContext

    await expect(host.listTools(context)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'user_input' })])
    )
    const result = await host.execute(
      {
        callId: 'call_input',
        toolName: 'user_input',
        arguments: { question: 'Continue?' }
      },
      context
    )

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      toolName: 'user_input',
      isError: true,
      output: { error: 'GUI user input is not available in this runtime context' }
    })
  })

  it('normalizes structured multi-select user input questions', async () => {
    const host = new LocalToolHost({ tools: [userInputTool] })
    const captured: Parameters<NonNullable<ToolHostContext['awaitUserInput']>>[0][] = []
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/tmp/workspace',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn(async () => 'allow' as const),
      awaitUserInput: vi.fn(async (input) => {
        captured.push(input)
        return { status: 'submitted' as const, answers: [] }
      })
    } satisfies ToolHostContext

    await host.execute(
      {
        callId: 'call_input_multi',
        toolName: 'user_input',
        arguments: {
          questions: [
            {
              id: 'requirements',
              question: 'Pick requirements',
              options: ['Keep ratio', 'App icon', 'Redesign outline'],
              selectionMode: 'multiple',
              minSelections: 4,
              maxSelections: 2
            }
          ]
        }
      },
      context
    )

    expect(captured[0]?.questions).toEqual([
      {
        header: 'Question 1',
        id: 'requirements',
        question: 'Pick requirements',
        options: [
          { label: 'Keep ratio', description: '' },
          { label: 'App icon', description: '' },
          { label: 'Redesign outline', description: '' }
        ],
        selectionMode: 'multiple',
        minSelections: 2,
        maxSelections: 2
      }
    ])
  })
})
