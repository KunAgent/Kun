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

describe('runtime projection action normalization', () => {
  it('preserves the durable product surface from thread summaries', () => {
    const thread = threadFromCore({
      id: 'thread_design',
      title: 'Landing page',
      agentSurface: 'design',
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'doc_1', boardArtifactId: 'board_1' },
        outputMedium: 'html',
        target: 'web',
        preset: 'ios',
        context: { tone: ['calm'] },
        lockedAtTurnId: 'turn_1'
      },
      model: 'model_1',
      mode: 'agent',
      status: 'idle',
      latestSeq: 42,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z'
    })

    expect(thread.agentSurface).toBe('design')
    expect(thread.latestSeq).toBe(42)
    expect(thread.designProfile).toMatchObject({
      documentTarget: { documentId: 'doc_1', boardArtifactId: 'board_1' },
      lockedAtTurnId: 'turn_1'
    })
  })

  it('projects the locked task mode before thread detail hydration', () => {
    const thread = threadFromCore({
      id: 'thread_locked_code',
      title: 'Existing Code task',
      agentSurface: 'code',
      lockedTaskSurface: 'code',
      model: 'model_1',
      mode: 'agent',
      status: 'idle',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    })

    expect(thread.lockedTaskSurface).toBe('code')
  })

  it('preserves read-only knowledge-base mounts from thread summaries', () => {
    const thread = threadFromCore({
      id: 'thread_kb',
      title: 'Knowledge task',
      model: 'model_1',
      mode: 'agent',
      status: 'idle',
      knowledgeBases: [{
        id: 'kb_docs', root: '/Users/demo/docs', name: 'Docs',
        source: 'write-workspace', access: 'read-only'
      }],
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z'
    })

    expect(thread.knowledgeBases).toEqual([expect.objectContaining({
      id: 'kb_docs', access: 'read-only'
    })])
  })

  it('projects an accepted Design profile lock from turn_started metadata', async () => {
    const onThreadUpdated = vi.fn()
    const designProfile = {
      version: 1 as const,
      documentTarget: { documentId: 'doc_live', boardArtifactId: 'board_live' },
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'geist' as const,
      context: { tone: [] },
      lockedAtTurnId: 'turn_live'
    }
    await dispatchKunRuntimeEvent({
      kind: 'turn_started',
      seq: 4,
      threadId: 'thread_live',
      turnId: 'turn_live',
      agentSurface: 'design',
      threadAgentSurface: 'code',
      designProfile
    }, { ...makeSink(), onThreadUpdated }, async () => undefined)

    expect(onThreadUpdated).toHaveBeenCalledWith({
      threadId: 'thread_live',
      agentSurface: 'code',
      designProfile
    })
  })

  it('does not project a Design turn intent as durable thread ownership', async () => {
    const onThreadUpdated = vi.fn()
    await dispatchKunRuntimeEvent({
      kind: 'turn_started',
      seq: 5,
      threadId: 'thread_live',
      turnId: 'turn_live',
      agentSurface: 'design'
    }, { ...makeSink(), onThreadUpdated }, async () => undefined)

    expect(onThreadUpdated).not.toHaveBeenCalled()
  })

  it('defaults a legacy thread without reviewer metadata to manual user review', () => {
    const thread = threadFromCore({
      id: 'thread_1',
      title: 'Legacy thread',
      model: 'model_1',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z'
    })

    expect(thread.approvalReviewer).toBe('user')
  })

  it('normalizes automatic approval review lifecycle events into visible transcript updates', () => {
    const started = runtimeProjectionActionsFromEvent({
      kind: 'approval_review_started',
      seq: 12,
      timestamp: '2026-07-29T00:00:00.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      reviewer: 'agent',
      status: 'in-progress',
      toolName: 'exec_command',
      summary: 'Run the project tests'
    })
    const completed = runtimeProjectionActionsFromEvent({
      kind: 'approval_review_completed',
      seq: 13,
      timestamp: '2026-07-29T00:00:01.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      reviewer: 'agent',
      status: 'denied',
      decision: 'deny',
      riskLevel: 'high',
      toolName: 'exec_command',
      summary: 'Run the project tests',
      rationale: 'The command writes outside the workspace.'
    })

    expect(started).toEqual([{
      type: 'approval_review_updated',
      seq: 12,
      payload: {
        reviewId: 'review_1',
        approvalId: 'approval_1',
        turnId: 'turn_1',
        createdAt: '2026-07-29T00:00:00.000Z',
        summary: 'Run the project tests',
        toolName: 'exec_command',
        status: 'in-progress'
      }
    }])
    expect(completed).toEqual([{
      type: 'approval_review_updated',
      seq: 13,
      payload: {
        reviewId: 'review_1',
        approvalId: 'approval_1',
        turnId: 'turn_1',
        createdAt: '2026-07-29T00:00:01.000Z',
        summary: 'Run the project tests',
        toolName: 'exec_command',
        status: 'denied',
        decision: 'deny',
        riskLevel: 'high',
        rationale: 'The command writes outside the workspace.'
      }
    }])
  })

  it('does not project malformed or non-agent review events', () => {
    expect(runtimeProjectionActionsFromEvent({
      kind: 'approval_review_started',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      reviewer: 'user',
      status: 'in-progress'
    })).toEqual([])
  })

  it('keeps agent approval resolutions out of the manual approval projection', async () => {
    const event: CoreRuntimeEventJson = {
      kind: 'approval_resolved',
      seq: 14,
      timestamp: '2026-07-29T00:00:02.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      approvalId: 'approval_1',
      toolName: 'exec_command',
      status: 'denied',
      approvalReviewer: 'agent',
      decisionSource: 'agent',
      summary: 'Run the project tests',
      reason: 'The automatic reviewer denied the action.'
    }
    expect(runtimeProjectionActionsFromEvent(event)).toEqual([])

    const onApprovalStatus = vi.fn()
    await dispatchKunRuntimeEvent(
      event,
      { ...makeSink(), onApprovalStatus },
      async () => undefined
    )
    expect(onApprovalStatus).not.toHaveBeenCalled()
    expect(chatBlockFromItem({
      id: 'item_agent_resolution',
      turnId: 'turn_1',
      threadId: 'thread_1',
      role: 'tool',
      status: 'denied',
      createdAt: '2026-07-29T00:00:02.000Z',
      kind: 'approval',
      approvalId: 'approval_1',
      toolName: 'exec_command',
      summary: 'Run the project tests',
      approvalReviewer: 'agent',
      decisionSource: 'agent'
    })).toBeNull()
  })

  it('normalizes a required-tool gate as a stable runtime status, not assistant text', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'required_tool_gate',
      seq: 42,
      timestamp: '2026-07-27T00:00:00.000Z',
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'graph_create_run',
      phase: 'retrying',
      attempt: 2,
      maxAttempts: 3,
      failureSummary: 'plan.nodes.0: Required'
    })

    expect(actions).toEqual([{
      type: 'runtime_status_received',
      seq: 42,
      payload: {
        kind: 'required_tool_gate',
        itemId: 'runtime_status_turn_1_required_tool_graph_create_run',
        turnId: 'turn_1',
        createdAt: '2026-07-27T00:00:00.000Z',
        toolName: 'graph_create_run',
        phase: 'retrying',
        attempt: 2,
        maxAttempts: 3,
        failureSummary: 'plan.nodes.0: Required'
      }
    }])
  })

  it('keeps turn interruption distinct from successful completion', () => {
    expect(runtimeProjectionActionsFromEvent({
      kind: 'turn_completed',
      threadId: 'thread_1',
      turnId: 'turn_1'
    })).toEqual([{
      type: 'turn_completed',
      payload: { status: 'completed', threadId: 'thread_1', turnId: 'turn_1' }
    }])
    expect(runtimeProjectionActionsFromEvent({
      kind: 'turn_aborted',
      threadId: 'thread_1',
      turnId: 'turn_1'
    })).toEqual([{
      type: 'turn_aborted',
      payload: { status: 'aborted', threadId: 'thread_1', turnId: 'turn_1' }
    }])
  })

  it('normalizes the same goal event to a stable action transcript', () => {
    const event: CoreRuntimeEventJson = {
      kind: 'goal_updated',
      seq: 9,
      timestamp: '2026-07-11T00:00:00.000Z',
      threadId: 'thread_1',
      goal: {
        threadId: 'thread_1',
        objective: 'Finish projection extraction',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z'
      }
    }

    const first = runtimeProjectionActionsFromEvent(event)
    const replay = runtimeProjectionActionsFromEvent(structuredClone(event))

    expect(replay).toEqual(first)
    expect(first).toEqual([{
      type: 'goal_changed',
      seq: 9,
      payload: {
        threadId: 'thread_1',
        goal: {
          threadId: 'thread_1',
          objective: 'Finish projection extraction',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        },
        createdAt: '2026-07-11T00:00:00.000Z'
      }
    }])
  })

  it('retains one persisted seq on every action produced by a terminal event', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'turn_failed',
      seq: 77,
      threadId: 'thread_1',
      turnId: 'turn_1',
      message: 'provider failed'
    })

    expect(actions.map((action) => action.seq)).toEqual([77, 77])
    expect(actions.map((action) => action.type)).toEqual([
      'runtime_error_received',
      'turn_failed'
    ])
  })

  it('keeps terminal identity on the turn_failed action payload', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'turn_failed',
      seq: 77,
      threadId: 'thread_1',
      turnId: 'turn_1',
      message: 'provider failed'
    })
    const terminal = actions.find((action) => action.type === 'turn_failed')

    expect(terminal).toMatchObject({
      type: 'turn_failed',
      seq: 77,
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        seq: 77,
        options: { terminal: true, scope: 'conversation' }
      }
    })
    expect((terminal?.payload as { error: Error }).error).toBeInstanceOf(Error)
  })

  it('dispatches turn_failed identity through sink error options', async () => {
    const observed: Array<{ message: string; options?: ThreadErrorOptions }> = []
    const sink = makeSink()
    sink.onError = (error, options) => {
      observed.push({ message: error.message, options })
    }

    await dispatchKunRuntimeEvent({
      kind: 'turn_failed',
      seq: 78,
      threadId: 'thread_1',
      turnId: 'turn_1',
      message: 'provider failed'
    }, sink, async () => undefined)

    expect(observed).toHaveLength(1)
    expect(observed[0]!.message).toContain('provider failed')
    expect(observed[0]!.options).toEqual({
      terminal: true,
      scope: 'conversation',
      threadId: 'thread_1',
      turnId: 'turn_1',
      seq: 78
    })
  })

  it('uses a deterministic fallback identity for legacy user-input events', () => {
    const actions = runtimeProjectionActionsFromEvent({
      kind: 'user_input_resolved',
      status: 'cancelled'
    })
    expect(actions).toEqual([{
      type: 'user_input_status_changed',
      payload: { itemId: 'input_unknown', status: 'cancelled' }
    }])
  })
})

describe('assistant stream mapping', () => {
  it('preserves item-relative offsets while coalescing a delta batch', async () => {
    const onDeltas = vi.fn()
    const sink: ThreadEventSink = { ...makeSink(), onDeltas }

    await dispatchKunRuntimeEvents([
      {
        kind: 'assistant_reasoning_delta',
        seq: 10,
        deltaOffset: 0,
        item: {
          id: 'item_reasoning',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'assistant',
          status: 'running',
          createdAt: '2024-01-01T00:00:00.000Z',
          kind: 'assistant_reasoning',
          text: 'think'
        }
      },
      {
        kind: 'assistant_text_delta',
        seq: 11,
        deltaOffset: 5,
        item: {
          id: 'item_answer',
          turnId: 'turn_1',
          threadId: 'thr_1',
          role: 'assistant',
          status: 'running',
          createdAt: '2024-01-01T00:00:01.000Z',
          kind: 'assistant_text',
          text: 'answer'
        }
      }
    ], sink, async () => undefined)

    expect(onDeltas).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'agent_reasoning',
        itemId: 'item_reasoning',
        seq: 10,
        deltaOffset: 0,
        text: 'think'
      }),
      expect.objectContaining({
        kind: 'agent_message',
        itemId: 'item_answer',
        seq: 11,
        deltaOffset: 5,
        text: 'answer'
      })
    ])
  })

  it('keeps delta identity and emits the completed assistant snapshot as an authoritative upsert', async () => {
    const deltas: unknown[] = []
    const assistantItems: unknown[] = []
    const sink: ThreadEventSink = {
      ...makeSink(),
      onDeltas: (events) => {
        deltas.push(...events)
      },
      onAssistantItem: (item) => assistantItems.push(item)
    }

    await dispatchKunRuntimeEvent({
      kind: 'assistant_text_delta',
      seq: 1,
      deltaOffset: 0,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'running',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'he'
      }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'assistant_text_delta',
      seq: 2,
      deltaOffset: 2,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'running',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'llo'
      }
    }, sink, async () => undefined)
    await dispatchKunRuntimeEvent({
      kind: 'item_created',
      seq: 3,
      item: {
        id: 'item_answer',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'assistant',
        status: 'completed',
        createdAt: '2024-01-01T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'hello'
      }
    }, sink, async () => undefined)

    expect(deltas).toEqual([
      {
        text: 'he',
        kind: 'agent_message',
        seq: 1,
        deltaOffset: 0,
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_answer',
        createdAt: '2024-01-01T00:00:00.000Z'
      },
      {
        text: 'llo',
        kind: 'agent_message',
        seq: 2,
        deltaOffset: 2,
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_answer',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ])
    expect(assistantItems).toEqual([{
      itemId: 'item_answer',
      threadId: 'thr_1',
      turnId: 'turn_1',
      kind: 'agent_message',
      status: 'completed',
      createdAt: '2024-01-01T00:00:00.000Z',
      text: 'hello'
    }])
  })
})

describe('todo event mapping', () => {
  it('surfaces thread todo updates through the event sink', async () => {
    const events: unknown[] = []
    const sink: ThreadEventSink = {
      ...makeSink(),
      onTodos: (event) => {
        events.push(event)
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'todos_updated',
      seq: 4,
      timestamp: '2026-06-04T00:00:00.000Z',
      threadId: 'thr_1',
      todos: {
        threadId: 'thr_1',
        updatedAt: '2026-06-04T00:00:00.000Z',
        items: [{
          id: 'todo_1',
          content: 'Wire todo panel',
          status: 'completed',
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T00:00:00.000Z'
        }]
      }
    }, sink, async () => undefined)

    expect(events).toEqual([{
      threadId: 'thr_1',
      createdAt: '2026-06-04T00:00:00.000Z',
      todos: {
        threadId: 'thr_1',
        updatedAt: '2026-06-04T00:00:00.000Z',
        items: [expect.objectContaining({ content: 'Wire todo panel', status: 'completed' })]
      }
    }])
  })
})

describe('review mapping', () => {
  const reviewItem: CoreTurnItemJson = {
    id: 'item_review_1',
    turnId: 'turn_1',
    threadId: 'thr_1',
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-06-04T00:00:00.000Z',
    kind: 'review',
    title: 'Review current changes',
    target: { kind: 'uncommittedChanges' },
    reviewText: 'No review findings.',
    output: {
      findings: [],
      overallCorrectness: 'patch is correct',
      overallExplanation: 'No blocking issues found.',
      overallConfidenceScore: 0.75
    }
  }

  it('maps persisted review items to review blocks', () => {
    const block = chatBlockFromItem(reviewItem)
    expect(block).toMatchObject({
      kind: 'review',
      id: 'item_review_1',
      title: 'Review current changes',
      status: 'success',
      output: {
        overallCorrectness: 'patch is correct'
      }
    })
  })

  it('surfaces review item updates through the event sink', async () => {
    let captured: unknown = null
    const sink: ThreadEventSink = {
      ...makeSink(),
      onReview: (event) => {
        captured = event
      }
    }

    await dispatchKunRuntimeEvent({
      kind: 'item_updated',
      seq: 7,
      item: reviewItem
    }, sink, async () => undefined)

    expect(captured).toMatchObject({
      itemId: 'item_review_1',
      status: 'success',
      reviewText: 'No review findings.'
    })
  })
})
