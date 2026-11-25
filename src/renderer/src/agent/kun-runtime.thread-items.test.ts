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

  it('keeps turn attachments off steered user messages while preserving per-item and legacy opening attachments', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_steered_att',
          title: 'Demo',
          workspace: '/tmp',
          model: 'gemini-4-carbon',
          mode: 'agent',
          status: 'running',
          createdAt: 't0',
          updatedAt: 't3',
          latestSeq: 15,
          turns: [
            {
              id: 'turn_1',
              threadId: 'thr_steered_att',
              status: 'completed',
              prompt: 'open with image',
              createdAt: 't0',
              finishedAt: 't2',
              attachmentIds: ['att_opening'],
              items: [
                {
                  id: 'item_turn_1_user',
                  turnId: 'turn_1',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't0',
                  kind: 'user_message',
                  text: 'open with image',
                  attachmentIds: ['att_opening']
                },
                {
                  id: 'item_call_1',
                  turnId: 'turn_1',
                  threadId: 'thr_steered_att',
                  role: 'tool',
                  status: 'completed',
                  createdAt: 't1',
                  kind: 'tool_call',
                  toolName: 'read_file',
                  callId: 'call_1',
                  arguments: { path: 'a.ts' }
                },
                {
                  id: 'item_steered_followup',
                  turnId: 'turn_1',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't2',
                  kind: 'user_message',
                  text: 'steered text without image'
                }
              ]
            },
            {
              id: 'turn_2',
              threadId: 'thr_steered_att',
              status: 'completed',
              prompt: 'open without image',
              createdAt: 't2',
              finishedAt: 't3',
              attachmentIds: ['att_steered_only'],
              items: [
                {
                  id: 'item_turn_2_user',
                  turnId: 'turn_2',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't2',
                  kind: 'user_message',
                  text: 'open without image'
                },
                {
                  id: 'item_steered_with_image',
                  turnId: 'turn_2',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't3',
                  kind: 'user_message',
                  text: 'steered with image',
                  attachmentIds: ['att_steered_only']
                }
              ]
            },
            {
              id: 'turn_legacy',
              threadId: 'thr_steered_att',
              status: 'completed',
              prompt: 'legacy opening image',
              createdAt: 't3',
              finishedAt: 't4',
              attachmentIds: ['att_legacy'],
              items: [
                {
                  id: 'item_legacy_user',
                  turnId: 'turn_legacy',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't3',
                  kind: 'user_message',
                  text: 'legacy opening image'
                },
                {
                  id: 'item_steered_legacy_followup',
                  turnId: 'turn_legacy',
                  threadId: 'thr_steered_att',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't4',
                  kind: 'user_message',
                  text: 'legacy steered text'
                }
              ]
            }
          ]
        })
      }))
    })

    const detail = await new KunRuntimeProvider().getThreadDetail('thr_steered_att')
    const byId = new Map(detail.blocks.map((block) => [block.id, block]))

    expect(byId.get('item_turn_1_user')).toMatchObject({
      kind: 'user',
      meta: { attachmentIds: ['att_opening'] }
    })
    expect((byId.get('item_steered_followup') as { meta?: Record<string, unknown> } | undefined)?.meta?.attachmentIds)
      .toBeUndefined()
    expect((byId.get('tool_call_1') as { meta?: Record<string, unknown> } | undefined)?.meta?.attachmentIds)
      .toBeUndefined()

    expect((byId.get('item_turn_2_user') as { meta?: Record<string, unknown> } | undefined)?.meta?.attachmentIds)
      .toBeUndefined()
    expect(byId.get('item_steered_with_image')).toMatchObject({
      kind: 'user',
      meta: { attachmentIds: ['att_steered_only'] }
    })

    expect(byId.get('item_legacy_user')).toMatchObject({
      kind: 'user',
      meta: { attachmentIds: ['att_legacy'] }
    })
    expect((byId.get('item_steered_legacy_followup') as { meta?: Record<string, unknown> } | undefined)?.meta?.attachmentIds)
      .toBeUndefined()
  })
})
