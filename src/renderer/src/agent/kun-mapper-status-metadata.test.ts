import { describe, expect, it, vi } from 'vitest'
import {
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  dispatchKunRuntimeEvents,
  mergeChatBlocks,
  runtimeProjectionActionsFromEvent,
  threadFromCore
} from './kun-mapper'
import type { CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type { ThreadErrorOptions, ThreadEventSink } from './types'
import {
  PRESENTATION_STUDIO_EXTENSION_ID,
  presentationStudioCanonicalToolId,
  presentationStudioModelAlias
} from '@shared/presentation-artifact'

function makeSink(): ThreadEventSink {
  return {
    onSeq: () => undefined,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTodos: () => undefined,
    onTurnComplete: () => undefined,
    onError: () => undefined
  }
}

describe('streaming runtime status events', () => {
  it('surfaces tool-call ready events as running tool cards', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_call_ready',
        seq: 20,
        itemId: 'item_tool_turn_1_call_read',
        callId: 'call_read',
        toolName: 'read',
        readyCount: 2
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      itemId: 'tool_call_read',
      summary: 'read',
      status: 'running',
      toolKind: 'tool_call',
      meta: {
        sourceItemId: 'item_tool_turn_1_call_read',
        callId: 'call_read',
        toolName: 'read',
        readyCount: 2,
        runtimeStatus: 'tool_call_ready'
      }
    })
  })

  it('surfaces tool-result upload waits as runtime status events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_result_upload_wait',
        seq: 21,
        timestamp: '2026-06-03T10:00:00.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        status: 'waiting',
        toolResultCount: 3
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      kind: 'tool_result_upload_wait',
      itemId: 'runtime_status_turn_1_tool_upload_wait',
      turnId: 'turn_1',
      createdAt: '2026-06-03T10:00:00.000Z',
      toolResultCount: 3
    })
  })

	  it('keeps tool catalog drift out of the conversation projection', async () => {
	    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'tool_catalog_changed',
        seq: 22,
        timestamp: '2026-06-03T10:00:01.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        fingerprint: 'fp_next',
        toolCount: 12,
        message: 'Tool catalog changed'
      },
      sink,
      async () => undefined
    )

	    expect(captured).toBeNull()
	  })

	  it('surfaces storm suppression as a runtime status event', async () => {
	    let captured: unknown = null
	    const sink: ThreadEventSink = {
	      ...makeSink(),
	      onRuntimeStatus: (event) => {
	        captured = event
	      }
	    }

	    await dispatchKunRuntimeEvent(
	      {
	        kind: 'tool_storm_suppressed',
	        seq: 23,
	        timestamp: '2026-06-03T10:00:02.000Z',
	        threadId: 'thr_1',
	        turnId: 'turn_1',
	        itemId: 'item_call_read_storm',
	        callId: 'call_read',
	        toolName: 'read',
	        message: 'read repeated the same arguments'
	      },
	      sink,
	      async () => undefined
	    )

	    expect(captured).toMatchObject({
	      kind: 'tool_storm_suppressed',
	      itemId: 'item_call_read_storm',
	      turnId: 'turn_1',
	      createdAt: '2026-06-03T10:00:02.000Z',
	      callId: 'call_read',
	      toolName: 'read',
	      message: 'read repeated the same arguments'
	    })
	  })

  it('surfaces model request retries as runtime status events', async () => {
    let captured: unknown = null
    const runtimeError = vi.fn()
    const sink: ThreadEventSink = {
      ...makeSink(),
      onRuntimeStatus: (event) => {
        captured = event
      },
      onRuntimeError: runtimeError
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'model_request_retry',
        seq: 24,
        timestamp: '2026-06-03T10:00:03.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        status: 429,
        attempt: 1,
        maxAttempts: 3,
        delayMs: 3000,
        failureSummary: 'Rate limit reached for this provider account.'
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      kind: 'model_request_retry',
      itemId: 'runtime_status_turn_1_model_retry',
      turnId: 'turn_1',
      createdAt: '2026-06-03T10:00:03.000Z',
      status: 429,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 3000,
      failureSummary: 'Rate limit reached for this provider account.'
    })

    captured = null
    await dispatchKunRuntimeEvent(
      {
        kind: 'model_request_retry',
        seq: 25,
        timestamp: '2026-06-03T10:00:04.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        attempt: 2,
        maxAttempts: 5,
        delayMs: 6000,
        reason: 'network'
      },
      sink,
      async () => undefined
    )

    expect(captured).toMatchObject({
      kind: 'model_request_retry',
      attempt: 2,
      maxAttempts: 5,
      delayMs: 6000,
      retryReason: 'network'
    })
    expect(captured).not.toHaveProperty('status')
    expect(runtimeError).not.toHaveBeenCalled()
  })
	})

describe('Kun extension metadata mapping', () => {
  it('maps turn disclosure metadata onto user messages', () => {
    const block = chatBlockFromItem({
      id: 'item_user_meta',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'look at this',
      displayText: 'Inspect attached image',
      guiDesignCanvas: true,
      guiDesignMode: false,
      attachmentIds: ['att_1'],
      fileReferences: [{
        path: '/workspace/deepseek-gui/src/App.tsx',
        relativePath: 'src/App.tsx',
        name: 'App.tsx',
        kind: 'file'
      }],
      activeSkillIds: ['skill_review'],
      injectedMemoryIds: ['mem_1'],
      skillInjectionBytes: 128
    })
    expect(block).toMatchObject({
      kind: 'user',
      meta: {
        displayText: 'Inspect attached image',
        guiDesignCanvas: true,
        attachmentIds: ['att_1'],
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }],
        activeSkillIds: ['skill_review'],
        injectedMemoryIds: ['mem_1'],
        skillInjectionBytes: 128
      }
    })
  })

  it('surfaces web citations and child metadata through tool events', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTool: (event) => {
        captured = event
      }
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'item_completed',
        seq: 12,
        child: {
          parentThreadId: 'thr_1',
          parentTurnId: 'turn_1',
          childId: 'child_research',
          childLabel: 'research',
          childStatus: 'completed',
          childSeq: 2
        },
        item: {
          id: 'item_web',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'tool',
          status: 'completed',
          createdAt: '2024-01-01T00:00:00.000Z',
          kind: 'tool_result',
          toolName: 'web_search',
          callId: 'call_web',
          output: {
            query: 'kun mcp',
            sources: [
              {
                sourceId: 'src_1',
                title: 'Docs',
                url: 'https://example.com/docs',
                retrievedAt: '2024-01-01T00:00:00.000Z'
              }
            ]
          }
        }
      },
      sink,
      async () => undefined
    )
    expect(captured).toMatchObject({
      meta: {
        child: { childId: 'child_research', childLabel: 'research' },
        sources: [{ title: 'Docs', url: 'https://example.com/docs' }]
      }
    })
  })

  it('forwards safe child activity to the dedicated runtime sink', async () => {
    const childEvents: unknown[] = []
    const sink: ThreadEventSink = {
      ...makeSink(),
      onChildRuntimeEvent: (event) => childEvents.push(event)
    }
    await dispatchKunRuntimeEvent(
      {
        kind: 'item_updated',
        seq: 17,
        timestamp: '2026-07-28T00:00:17.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        child: {
          parentThreadId: 'thr_1',
          parentTurnId: 'turn_1',
          childId: 'child_geo',
          childLabel: 'Inspect Geo',
          childStatus: 'running',
          childSeq: 1,
          childProviderId: 'deepseek',
          activity: {
            phase: 'tool',
            label: 'Scanning the repository',
            toolName: 'repo_map',
            startedAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-28T00:00:17.000Z'
          }
        }
      },
      sink,
      async () => undefined
    )

    expect(childEvents).toEqual([{
      seq: 17,
      timestamp: '2026-07-28T00:00:17.000Z',
      child: expect.objectContaining({
        childId: 'child_geo',
        childProviderId: 'deepseek',
        activity: {
          phase: 'tool',
          label: 'Scanning the repository',
          toolName: 'repo_map',
          startedAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:17.000Z'
        }
      })
    }])
  })

  it('keeps a child terminal lifecycle event out of the parent terminal sink', async () => {
    const childEvents: unknown[] = []
    const onTurnComplete = vi.fn()
    const onTool = vi.fn()
    const sink: ThreadEventSink = {
      ...makeSink(),
      onChildRuntimeEvent: (event) => childEvents.push(event),
      onTurnComplete,
      onTool
    }

    await dispatchKunRuntimeEvent(
      {
        kind: 'turn_completed',
        seq: 64,
        timestamp: '2026-08-22T07:21:51.367Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        child: {
          parentThreadId: 'thr_1',
          parentTurnId: 'turn_1',
          childId: 'child_1',
          childLabel: 'Fast Context retrieval',
          childStatus: 'completed',
          childSeq: 8,
          childProviderId: 'deepseek'
        }
      },
      sink,
      async () => undefined
    )

    expect(childEvents).toHaveLength(1)
    expect(childEvents[0]).toMatchObject({
      seq: 64,
      child: { childId: 'child_1', childStatus: 'completed' }
    })
    expect(onTool).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'child_lifecycle_child_1',
      updateOnly: true,
      status: 'success'
    }))
    expect(onTurnComplete).not.toHaveBeenCalled()
  })

  it('preserves background subagent message source on user messages', () => {
    const block = chatBlockFromItem({
      id: 'item_subagent_notice',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: '<background_subagent_completed><child_id>child-1</child_id><label>后台休眠</label><status>completed</status><summary>done</summary></background_subagent_completed>',
      displayText: 'Background subagent 后台休眠 completed',
      messageSource: 'background_subagent'
    })

    expect(block).toMatchObject({
      kind: 'user',
      meta: {
        displayText: 'Background subagent 后台休眠 completed',
        messageSource: 'background_subagent'
      }
    })
  })

  it('preserves internal Graph supervision source for timeline filtering', () => {
    const block = chatBlockFromItem({
      id: 'item_graph_supervision',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'Graph Lead supervision for durable run run_1.',
      messageSource: 'graph_runtime'
    })

    expect(block).toMatchObject({
      kind: 'user',
      meta: { messageSource: 'graph_runtime' }
    })
  })

  it('preserves Design continuation source for hidden progress turns', () => {
    const block = chatBlockFromItem({
      id: 'item_design_continuation',
      turnId: 'turn_logo',
      threadId: 'thr_design',
      role: 'user',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'Internal logo prompt',
      messageSource: 'design_continuation'
    })

    expect(block).toMatchObject({
      kind: 'user',
      meta: { messageSource: 'design_continuation' }
    })
  })
})
