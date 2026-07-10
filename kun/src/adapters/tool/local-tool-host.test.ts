import { describe, expect, it, vi } from 'vitest'
import { LocalToolHost, echoTool, userInputTool } from './local-tool-host.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'

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
    const captured: { value: Parameters<NonNullable<ToolHostContext['awaitUserInput']>>[0] | null } = { value: null }
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: '/tmp/workspace',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: vi.fn(async () => 'allow' as const),
      awaitUserInput: vi.fn(async (input) => {
        captured.value = input
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

    expect(captured.value?.questions).toEqual([
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
