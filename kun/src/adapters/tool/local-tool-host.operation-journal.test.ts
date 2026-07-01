import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileOperationJournal } from '../../reliability/operation-journal.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'

describe('LocalToolHost operation journal', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-tool-journal-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('reuses the completed result for the same call id without repeating side effects', async () => {
    const journal = new FileOperationJournal(rootDir)
    let executions = 0
    const host = new LocalToolHost({
      operationJournal: journal,
      tools: [LocalToolHost.defineTool({
        name: 'deploy',
        description: 'deploy once',
        inputSchema: { type: 'object' },
        policy: 'auto',
        execute: async () => ({ output: { deployment: ++executions } })
      })]
    })
    const call = { callId: 'call_1', toolName: 'deploy', arguments: { target: 'production' } }

    const first = await host.execute(call, context('auto'))
    const replay = await host.execute(call, context('auto'))

    expect(executions).toBe(1)
    expect(first.item).toMatchObject({ kind: 'tool_result', output: { deployment: 1 } })
    expect(replay.item).toMatchObject({ kind: 'tool_result', output: { deployment: 1 } })
  })

  it('blocks an uncertain non-idempotent replay until explicit approval', async () => {
    const journal = new FileOperationJournal(rootDir)
    const identity = {
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      toolName: 'deploy',
      arguments: { target: 'production' },
      replaySafe: false
    }
    await journal.start(identity)
    let executions = 0
    const host = new LocalToolHost({
      operationJournal: journal,
      tools: [LocalToolHost.defineTool({
        name: 'deploy',
        description: 'deploy once',
        inputSchema: { type: 'object' },
        policy: 'auto',
        execute: async () => ({ output: { deployment: ++executions } })
      })]
    })
    const call = { callId: 'call_1', toolName: 'deploy', arguments: { target: 'production' } }

    const blocked = await host.execute(call, context('auto'))
    expect(blocked.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'operation_outcome_unknown' }
    })
    expect(executions).toBe(0)

    const awaitApproval = vi.fn(async () => 'allow' as const)
    const approved = await host.execute(call, context('on-request', awaitApproval))
    expect(awaitApproval).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining('previous execution outcome is unknown')
    }))
    expect(approved.item).toMatchObject({ kind: 'tool_result', output: { deployment: 1 } })
    expect(executions).toBe(1)
  })
})

function context(
  approvalPolicy: ToolHostContext['approvalPolicy'],
  awaitApproval = vi.fn(async () => 'allow' as const)
): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy,
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval
  }
}
