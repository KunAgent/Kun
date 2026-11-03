import { describe, expect, it, vi } from 'vitest'
import { makeToolResultItem } from '../domain/item.js'
import type { ToolCallLike, ToolHost, ToolHostContext } from '../ports/tool-host.js'
import { createFastContextToolHost } from './fast-context-tool-host.js'

const context = {
  threadId: 'child', turnId: 'turn', workspace: '/workspace', fastContext: true,
  fastContextTaskCount: 2, approvalPolicy: 'auto', abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow' as const
} as ToolHostContext

const readCall = (arguments_: Record<string, unknown>): ToolCallLike => ({
  callId: 'read_call', toolName: 'read', arguments: arguments_
})

function sourceHost(execute = vi.fn()): ToolHost {
  return {
    id: 'source-host',
    listTools: async () => [
      { name: 'glob', description: 'glob', inputSchema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
      { name: 'grep', description: 'grep', inputSchema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
      { name: 'read', description: 'read', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      { name: 'bash', description: 'bash', inputSchema: { type: 'object', properties: {} } }
    ],
    execute: async (call) => {
      execute(call)
      return {
        item: makeToolResultItem({
          id: `item_${call.callId}`, threadId: 'child', turnId: 'turn', callId: call.callId,
          toolName: call.toolName, output: { ok: true }
        }),
        approved: true
      }
    }
  }
}

describe('createFastContextToolHost', () => {
  it('requires task_indexes provenance for every Fast Context source schema', async () => {
    const host = createFastContextToolHost(sourceHost(), 2)
    const tools = await host.listTools(context)
    const read = tools.find((tool) => tool.name === 'read')!
    expect(read.inputSchema).toMatchObject({
      properties: { task_indexes: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 2 } } },
      required: ['path', 'task_indexes']
    })
    expect(tools.map((tool) => tool.name)).toEqual(['glob', 'grep', 'read'])
    expect(tools.find((tool) => tool.name === 'glob')?.description).toContain('candidate-file discovery')
    expect(tools.find((tool) => tool.name === 'grep')?.description).toContain('at most 30 matches')
    expect(read.description).toContain('capped at 200 lines')
    expect(tools.map((tool) => tool.description).join('\n')).toContain('task_indexes')
  })

  it('rejects missing/invalid attribution and strips valid task_indexes before source execution', async () => {
    const executed = vi.fn()
    const host = createFastContextToolHost(sourceHost(executed), 2)
    const missing = await host.execute(readCall({ path: 'src/a.ts' }), context)
    expect(missing.item).toMatchObject({
      kind: 'tool_result', isError: true,
      output: { code: 'fast_context_task_indexes_required' }
    })
    const invalid = await host.execute(readCall({
      path: 'src/a.ts',
      task_indexes: Array.from({ length: 1_000 }, () => ({ nested: ['untrusted'] }))
    }), context)
    expect(invalid.item).toMatchObject({
      output: { code: 'fast_context_task_indexes_required', task_indexes_provided: true }
    })
    const invalidOutput = invalid.item.kind === 'tool_result' ? invalid.item.output : undefined
    expect(invalidOutput).not.toHaveProperty('task_indexes')
    expect(JSON.stringify(invalidOutput)).not.toContain('untrusted')
    await host.execute(readCall({ path: 'src/a.ts', task_indexes: [2] }), context)
    expect(executed).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { path: 'src/a.ts' }
    }))
    expect(executed.mock.calls[0]?.[0].arguments).not.toHaveProperty('task_indexes')
  })

  it('rejects a non-source call without delegating it to the underlying host', async () => {
    const executed = vi.fn()
    const host = createFastContextToolHost(sourceHost(executed), 2)

    const result = await host.execute({ callId: 'bash_call', toolName: 'bash', arguments: {} }, context)

    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'fast_context_tool_not_allowed' }
    })
    expect(executed).not.toHaveBeenCalled()
  })

  it('keeps source provenance uniform for a single-task child', async () => {
    const executed = vi.fn()
    const host = createFastContextToolHost(sourceHost(executed), 1)
    const singleContext = { ...context, fastContextTaskCount: 1 }
    const missing = await host.execute(readCall({ path: 'src/a.ts' }), singleContext)
    expect(missing.item).toMatchObject({ output: { code: 'fast_context_task_indexes_required' } })
    await host.execute(readCall({ path: 'src/a.ts', task_indexes: [1] }), singleContext)
    expect(executed).toHaveBeenCalledWith(expect.objectContaining({ arguments: { path: 'src/a.ts' } }))
  })

  it('attaches one run scope with hint paths and task terms to every source call', async () => {
    const contexts: ToolHostContext[] = []
    const inner = sourceHost()
    const host = createFastContextToolHost({
      ...inner,
      execute: async (call, callContext, onUpdate) => {
        contexts.push(callContext)
        return inner.execute(call, callContext, onUpdate)
      }
    }, 2, {
      hintPaths: ['src/shared'],
      tasks: [{ title: 'Endpoint URL', query: 'How is the provider endpoint URL built?' }]
    })
    await host.execute(readCall({ path: 'src/a.ts', task_indexes: [1] }), context)
    await host.execute({ callId: 'grep_call', toolName: 'grep', arguments: { pattern: 'x', task_indexes: [2] } }, context)
    expect(contexts[0]?.fastContextRun).toMatchObject({ hintPaths: ['src/shared'], timedOutCommands: 0 })
    expect(contexts[0]?.fastContextRun?.queryTerms).toEqual(expect.arrayContaining(['endpoint', 'url', 'provider', 'built']))
    expect(contexts[1]?.fastContextRun).toBe(contexts[0]?.fastContextRun)
  })

  it('reuses an identical successful source call within one run under the new call id', async () => {
    const executed = vi.fn()
    const host = createFastContextToolHost(sourceHost(executed), 2)
    const first = await host.execute(readCall({ path: 'src/a.ts', offset: 1, task_indexes: [1] }), context)
    const [concurrentA, concurrentB] = await Promise.all([
      host.execute({ callId: 'read_again', toolName: 'read', arguments: { offset: 1, path: 'src/a.ts', task_indexes: [2] } }, context),
      host.execute({ callId: 'read_third', toolName: 'read', arguments: { path: 'src/a.ts', offset: 1, task_indexes: [1, 2] } }, context)
    ])
    expect(executed).toHaveBeenCalledTimes(1)
    expect(first.item).toMatchObject({ callId: 'read_call', output: { ok: true } })
    expect(concurrentA.item).toMatchObject({ id: 'item_read_again', callId: 'read_again', output: { ok: true, reused_result: true } })
    expect(concurrentB.item).toMatchObject({ callId: 'read_third', output: { reused_result: true } })
    await host.execute(readCall({ path: 'src/a.ts', offset: 2, task_indexes: [1] }), context)
    expect(executed).toHaveBeenCalledTimes(2)
    // A fresh child run starts with an empty memo.
    const freshExecuted = vi.fn()
    await createFastContextToolHost(sourceHost(freshExecuted), 2).execute(readCall({ path: 'src/a.ts', offset: 1, task_indexes: [1] }), context)
    expect(freshExecuted).toHaveBeenCalledTimes(1)
  })

  it('does not memoize failed source calls', async () => {
    let attempts = 0
    const failing: ToolHost = {
      ...sourceHost(),
      execute: async (call) => {
        attempts += 1
        return {
          item: makeToolResultItem({
            id: `item_${call.callId}`, threadId: 'child', turnId: 'turn', callId: call.callId,
            toolName: call.toolName, output: { error: 'transient' }, isError: attempts === 1
          }),
          approved: true
        }
      }
    }
    const host = createFastContextToolHost(failing, 1)
    const first = await host.execute(readCall({ path: 'src/a.ts', task_indexes: [1] }), { ...context, fastContextTaskCount: 1 })
    const second = await host.execute(readCall({ path: 'src/a.ts', task_indexes: [1] }), { ...context, fastContextTaskCount: 1 })
    expect(first.item).toMatchObject({ isError: true })
    expect(second.item).toMatchObject({ isError: false })
    expect(attempts).toBe(2)
  })
})
