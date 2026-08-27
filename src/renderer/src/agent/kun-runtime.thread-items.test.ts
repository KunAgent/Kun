import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider thread item recovery', () => {
  it('expires a recovered approval when the runtime approval gate no longer awaits it', async () => {
    const threadBody = (pendingApprovalIds: string[]): string =>
      JSON.stringify({
        id: 'thr_approval',
        title: 'Demo',
        workspace: '/tmp',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'running',
        createdAt: 't0',
        updatedAt: 't1',
        latestSeq: 12,
        pendingApprovalIds,
        turns: [{
          id: 'turn_approval',
          threadId: 'thr_approval',
          status: 'running',
          prompt: 'run command',
          createdAt: 't0',
          items: [{
            id: 'item_approval',
            turnId: 'turn_approval',
            threadId: 'thr_approval',
            role: 'tool',
            status: 'pending',
            createdAt: 't1',
            kind: 'approval',
            approvalId: 'approval_live',
            toolName: 'bash',
            summary: 'Run tests'
          }]
        }]
      })

    installDsGui({
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: threadBody(['approval_live']) }))
    })
    const liveDetail = await new KunRuntimeProvider().getThreadDetail('thr_approval')
    expect(liveDetail.blocks.find((block) => block.kind === 'approval'))
      .toMatchObject({ status: 'pending' })

    resetProviderCacheForTests()
    installDsGui({
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: threadBody([]) }))
    })
    const staleDetail = await new KunRuntimeProvider().getThreadDetail('thr_approval')
    expect(staleDetail.blocks.find((block) => block.kind === 'approval'))
      .toMatchObject({ status: 'expired' })
  })

  it('coalesces tool_call and tool_result pairs into one tool block on thread load', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_1',
          title: 'Demo',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 9,
          turns: [
            {
              id: 'turn_1',
              threadId: 'thr_1',
              status: 'completed',
              prompt: 'run echo',
              createdAt: 't0',
              items: [
                {
                  id: 'item_call',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'pending',
                  createdAt: 't0',
                  kind: 'tool_call',
                  toolName: 'echo',
                  callId: 'call_1',
                  arguments: { text: 'hi' }
                },
                {
                  id: 'item_result',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'completed',
                  createdAt: 't1',
                  kind: 'tool_result',
                  toolName: 'echo',
                  callId: 'call_1',
                  output: { echoed: 'hi' }
                }
              ]
            }
          ]
        })
      }))
    })
    const provider = new KunRuntimeProvider()
    const detail = await provider.getThreadDetail('thr_1')
    expect(detail.blocks).toHaveLength(1)
    expect(detail.blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_call_1',
      status: 'success'
    })
  })
})
