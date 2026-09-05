import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) =>
    cleared || !goal ? 'Goal cleared' : `Goal ${goal.status}: ${goal.objective}`,
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: `Summary: ${event.message}`,
    message: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => {
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    if (index < 0) return [...blocks, block]
    const next = [...blocks]
    next[index] = block
    return next
  },
  formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [{
      id: 'thread_1', title: 'Thread', updatedAt: '2026-07-10T00:00:00.000Z', model: 'model', mode: 'agent'
    }],
    usageRefreshKey: 0,
    error: 'recovering'
  } as unknown as ChatState
}

function project(
  initial: ChatState,
  actions: RuntimeProjectionAction[],
  reducerContext = context
): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, reducerContext) }),
    initial
  )
}

describe('chat projection reducer', () => {
  it('updates one stable non-actionable block across an automatic review lifecycle', () => {
    const projected = project(state(), [
      {
        type: 'approval_review_updated',
        payload: {
          reviewId: 'review_1',
          approvalId: 'approval_1',
          turnId: 'turn_1',
          createdAt: '2026-07-29T00:00:00.000Z',
          summary: 'Run tests',
          toolName: 'exec_command',
          status: 'in-progress'
        }
      },
      {
        type: 'approval_review_updated',
        payload: {
          reviewId: 'review_1',
          approvalId: 'approval_1',
          turnId: 'turn_1',
          createdAt: '2026-07-29T00:00:01.000Z',
          summary: 'Run tests',
          toolName: 'exec_command',
          status: 'approved',
          decision: 'allow',
          riskLevel: 'low',
          rationale: 'The command only runs workspace tests.'
        }
      }
    ])

    expect(projected.blocks).toEqual([{
      kind: 'approval_review',
      id: 'approval-review-review_1',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      turnId: 'turn_1',
      createdAt: '2026-07-29T00:00:00.000Z',
      summary: 'Run tests',
      toolName: 'exec_command',
      status: 'approved',
      decision: 'allow',
      riskLevel: 'low',
      rationale: 'The command only runs workspace tests.'
    }])
  })

  it('renders a failed required-tool gate as an expandable runtime status, not an assistant block', () => {
    const projected = project(state(), [{
      type: 'runtime_status_received',
      payload: {
        kind: 'required_tool_gate',
        itemId: 'graph_gate_1',
        turnId: 'turn_graph',
        toolName: 'graph_create_run',
        phase: 'failed',
        attempt: 3,
        maxAttempts: 3,
        failureSummary: 'plan.nodes.0: Required'
      }
    }])

    expect(projected.blocks).toEqual([expect.objectContaining({
      kind: 'system',
      id: 'graph_gate_1',
      turnId: 'turn_graph',
      text: 'Runtime status',
      detail: 'plan.nodes.0: Required',
      severity: 'error'
    })])
    expect(projected.blocks.some((block) => block.kind === 'assistant')).toBe(false)
  })

  it.each(['success', 'error'] as const)(
    'does not regress a %s tool to running when historical lifecycle is replayed',
    (terminalStatus) => {
      const projected = project({
        ...state(),
        blocks: [{
          kind: 'tool',
          id: 'tool_1',
          summary: 'Terminal result',
          status: terminalStatus
        }]
      }, [{
        type: 'tool_updated',
        seq: 199,
        payload: {
          itemId: 'tool_1',
          summary: 'Historical start',
          status: 'running'
        }
      }])

      expect(projected.blocks[0]).toMatchObject({
        kind: 'tool',
        id: 'tool_1',
        status: terminalStatus
      })
    }
  )

  it.each(['success', 'error'] as const)(
    'keeps terminal detail and child status when a %s tool is replayed as running',
    (terminalStatus) => {
      const expectedChildStatus = terminalStatus === 'success' ? 'completed' : 'failed'
      const projected = project({
        ...state(),
        blocks: [{
          kind: 'tool',
          id: 'tool_1',
          summary: 'delegate_task',
          status: terminalStatus,
          detail: JSON.stringify({
            childId: 'child_1',
            status: expectedChildStatus,
            summary: 'Full conclusion text',
            toolInvocations: 5
          }),
          meta: {
            toolName: 'delegate_task',
            child: {
              parentThreadId: 'thr_1',
              parentTurnId: 'turn_1',
              childId: 'child_1',
              childStatus: expectedChildStatus,
              childSeq: 1
            }
          }
        }]
      }, [{
        type: 'tool_updated',
        seq: 199,
        payload: {
          itemId: 'child_lifecycle_child_1',
          summary: 'delegate_task',
          status: 'running',
          updateOnly: true,
          createdAt: '2026-07-11T00:00:00.000Z',
          toolKind: 'tool_call',
          detail: JSON.stringify({ childId: 'child_1', status: 'running' }),
          meta: {
            child: {
              parentThreadId: 'thr_1',
              parentTurnId: 'turn_1',
              childId: 'child_1',
              childStatus: 'running',
              childSeq: 1
            }
          }
        }
      }])

      expect(projected.blocks[0]).toMatchObject({
        kind: 'tool',
        id: 'tool_1',
        status: terminalStatus,
        detail: expect.stringContaining('Full conclusion text'),
        meta: {
          child: {
            childId: 'child_1',
            childStatus: expectedChildStatus
          }
        }
      })
      const tool = projected.blocks[0]
      if (tool?.kind === 'tool') {
        expect(JSON.stringify(tool.detail)).not.toContain('"status":"running"')
      }
    }
  )

  it('clears current-turn orchestration when a Graph turn completes', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_graph',
      currentTurnOrchestration: 'graph',
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{ type: 'turn_completed', payload: { status: 'completed', turnId: 'turn_graph' } }])

    expect(projected.busy).toBe(false)
    expect(projected.currentTurnId).toBeNull()
    expect(projected.currentTurnOrchestration).toBeNull()
    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnStatus: 'completed'
    })
  })

  it('settles an interrupted turn as aborted and closes running tools', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      threads: [{ ...state().threads[0]!, status: 'running' }],
      blocks: [{
        kind: 'tool',
        id: 'tool_1',
        turnId: 'turn_1',
        summary: 'Run command',
        status: 'running'
      }]
    }, [{ type: 'turn_aborted', payload: { status: 'aborted', turnId: 'turn_1' } }], {
      ...context,
      settlePendingRuntimeWork: (blocks) => blocks.map((block) =>
        block.kind === 'tool' && block.status === 'running'
          ? { ...block, status: 'error' as const }
          : block
      )
    })

    expect(projected.busy).toBe(false)
    expect(projected.currentTurnId).toBeNull()
    expect(projected.threads[0]).toMatchObject({
      status: 'idle',
      latestTurnStatus: 'aborted'
    })
    expect(projected.blocks[0]).toMatchObject({ kind: 'tool', status: 'error' })
  })

  it('clears current-turn orchestration when a Graph turn fails terminally', () => {
    const projected = project({
      ...state(),
      busy: true,
      currentTurnId: 'turn_graph',
      currentTurnOrchestration: 'graph',
      composerOrchestration: 'graph'
    }, [{
      type: 'turn_failed',
      payload: { turnId: 'turn_graph', error: new Error('stopped'), options: { terminal: true } }
    }])

    expect(projected.busy).toBe(false)
    expect(projected.currentTurnId).toBeNull()
    expect(projected.currentTurnOrchestration).toBeNull()
    expect(projected.composerOrchestration).toBe('graph')
  })

  it('keeps a stale running sidebar status unchanged when an unidentified terminal event is replayed', () => {
    const projected = project({
      ...state(),
      busy: false,
      currentTurnId: null,
      activeThreadGoal: {
        threadId: 'thread_1',
        objective: 'Finish the goal',
        status: 'complete',
        tokensUsed: 10,
        timeUsedSeconds: 30,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:30.000Z'
      },
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{ type: 'turn_completed', payload: { status: 'completed', turnId: 'turn_unknown' } }])

    expect(projected.threads[0]).toMatchObject({
      status: 'running'
    })
  })

  it('applies status-only thread metadata updates', () => {
    const projected = project({
      ...state(),
      threads: [{ ...state().threads[0]!, status: 'running' }]
    }, [{
      type: 'thread_metadata_changed',
      payload: { threadId: 'thread_1', status: 'idle' }
    }])

    expect(projected.threads[0]?.status).toBe('idle')
  })

  it('produces identical state for live and replayed normalized actions', () => {
    const actions: RuntimeProjectionAction[] = [
      {
        type: 'approval_received',
        payload: { approvalId: 'approval_1', summary: 'Run tests', toolName: 'exec_command' }
      },
      {
        type: 'user_input_requested',
        payload: {
          itemId: 'input_item_1',
          requestId: 'input_1',
          questions: [{ header: 'Mode', id: 'mode', question: 'Choose', options: [] }]
        }
      },
      {
        type: 'goal_changed',
        payload: {
          threadId: 'thread_1',
          goal: {
            threadId: 'thread_1', objective: 'Finish reducer', status: 'active',
            tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0,
            createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z'
          },
          createdAt: '2026-07-11T00:00:00.000Z'
        }
      }
    ]

    const live = project(state(), actions)
    const replay = project(state(), structuredClone(actions))

    expect(replay).toEqual(live)
    expect(live.blocks.map((block) => block.kind)).toEqual(['approval', 'user_input', 'system'])
    expect(live.activeThreadGoal?.objective).toBe('Finish reducer')
    expect(live.error).toBeNull()
  })

  it('stores context snapshots only for the active thread', () => {
    const activeSnapshot: RuntimeProjectionAction = {
      type: 'context_snapshot_received',
      payload: {
        threadId: 'thread_1',
        model: 'model',
        stepIndex: 0,
        contextWindowTokens: 100_000,
        softThresholdTokens: 75_000,
        hardThresholdTokens: 85_000,
        estimatedInputTokens: 15,
        breakdown: { tools: 1, system: 2, skills: 3, messages: 4, other: 5 },
        toolCount: 1,
        activeSkillIds: []
      }
    }
    const otherSnapshot: RuntimeProjectionAction = {
      ...activeSnapshot,
      payload: { ...activeSnapshot.payload, threadId: 'thread_2' }
    }

    const active = project(state(), [activeSnapshot])
    const ignored = project(state(), [otherSnapshot])

    expect(active.lastContextSnapshot).toEqual(activeSnapshot.payload)
    expect(ignored.lastContextSnapshot).toBeUndefined()
  })

  it('stores delegated capabilities only for the active thread', () => {
    const action: RuntimeProjectionAction = {
      type: 'delegated_runtime_received',
      payload: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        providerKind: 'antigravity-cli',
        providerId: 'google-subscription',
        phase: 'portable',
        capabilities: {
          nativeResume: false,
          structuredStreaming: false,
          kunTools: false,
          externalApproval: false,
          liveSteering: false,
          nativeContextTelemetry: false,
          fork: false
        }
      }
    }
    expect(project(state(), [action]).lastDelegatedRuntimeState).toEqual(action.payload)
    expect(project({ ...state(), activeThreadId: 'thread_2' }, [action]).lastDelegatedRuntimeState)
      .toBeUndefined()
  })

  it('deduplicates approval and user-input replay by stable runtime identity', () => {
    const approval: RuntimeProjectionAction = {
      type: 'approval_received',
      payload: { approvalId: 'approval_1', summary: 'Run tests' }
    }
    const input: RuntimeProjectionAction = {
      type: 'user_input_requested',
      payload: {
        itemId: 'input_item_1',
        requestId: 'input_1',
        questions: [{ header: 'Input', id: 'input_1', question: 'Continue?', options: [] }]
      }
    }
    const projected = project(state(), [approval, input, approval, input])
    expect(projected.blocks).toHaveLength(2)
  })

  it('ignores user-input requests that have no question text', () => {
    const projected = project(state(), [{
      type: 'user_input_requested',
      payload: { itemId: 'input_item_empty', requestId: 'input_empty', questions: [] }
    }])
    expect(projected.blocks).toHaveLength(0)
  })

  it('projects the sanitized runtime message as a durable conversation error', () => {
    const projected = project(state(), [{
      type: 'runtime_error_received',
      payload: {
        itemId: 'error_1',
        message: 'provider returned HTTP 429',
        code: 'http_429',
        severity: 'error'
      }
    }])

    expect(projected.blocks).toContainEqual(expect.objectContaining({
      kind: 'system',
      id: 'error_1',
      text: 'provider returned HTTP 429',
      code: 'http_429',
      severity: 'error',
      runtimeError: true
    }))
    expect(projected.blocks[0]).not.toMatchObject({ text: 'Summary: provider returned HTTP 429' })
  })

  it('reconciles a delayed stable user event with its optimistic bubble', () => {
    const createdAt = '2026-07-11T00:00:00.000Z'
    const initial = {
      ...state(),
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      blocks: [
        {
          kind: 'user' as const,
          id: 'u-optimistic',
          createdAt,
          text: '检查一下脚本并优化执行进度'
        },
        {
          kind: 'compaction' as const,
          id: 'compaction_1',
          status: 'success' as const,
          summary: 'Existing summary'
        }
      ]
    }

    const projected = project(initial, [{
      type: 'user_message_received',
      payload: {
        itemId: 'item_turn_1_user',
        turnId: 'turn_1',
        createdAt,
        text: '分析脚本是否存在问题，并优化执行过程和进度。',
        meta: { displayText: '检查一下脚本并优化执行进度' }
      }
    }])

    expect(projected.blocks).toHaveLength(2)
    expect(projected.blocks[0]).toMatchObject({
      kind: 'user',
      id: 'item_turn_1_user',
      meta: { displayText: '检查一下脚本并优化执行进度' }
    })
    expect(projected.blocks[1]).toMatchObject({ kind: 'compaction', id: 'compaction_1' })
  })

  it('reconciles guided optimistic input without replacing the active turn owner', () => {
    const createdAt = '2026-07-11T00:00:00.000Z'
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_1',
      currentTurnUserId: 'item_original_user',
      turnStartedAtByUserId: { item_original_user: NOW - 1_000 },
      blocks: [
        {
          kind: 'user' as const,
          id: 'item_original_user',
          turnId: 'turn_1',
          createdAt: '2026-07-10T23:59:00.000Z',
          text: 'Build the page'
        },
        {
          kind: 'user' as const,
          id: 'q-guided',
          turnId: 'turn_1',
          createdAt,
          text: 'Use the compact logo instead',
          meta: { displayText: 'Use the compact logo instead' }
        }
      ]
    }

    const projected = project(initial, [{
      type: 'user_message_received',
      payload: {
        itemId: 'item_guided_user',
        turnId: 'turn_1',
        createdAt,
        text: 'use the compact logo instead',
        meta: { displayText: 'Use the compact logo instead' }
      }
    }])

    expect(projected.blocks).toHaveLength(2)
    expect(projected.blocks[1]).toMatchObject({
      kind: 'user',
      id: 'item_guided_user',
      turnId: 'turn_1',
      meta: { displayText: 'Use the compact logo instead' }
    })
    expect(projected.currentTurnUserId).toBe('item_original_user')
  })

  it('reconciles Graph guidance when the stable user event arrives after the HTTP response', () => {
    const createdAt = '2026-07-11T00:00:00.000Z'
    const initial = {
      ...state(),
      busy: true,
      currentTurnId: 'turn_graph',
      currentTurnUserId: 'item_original_user',
      turnStartedAtByUserId: { item_original_user: NOW - 1_000 },
      blocks: [
        {
          kind: 'user' as const,
          id: 'item_original_user',
          turnId: 'turn_graph',
          createdAt: '2026-07-10T23:59:00.000Z',
          text: 'Build this as a Graph'
        },
        {
          kind: 'user' as const,
          id: 'graph-steering-1783728000000',
          turnId: 'turn_graph',
          createdAt,
          text: 'Continue building the Graph.'
        }
      ]
    }

    const projected = project(initial, [{
      type: 'user_message_received',
      payload: {
        itemId: 'item_steered',
        turnId: 'turn_graph',
        createdAt,
        text: 'Continue building the Graph.'
      }
    }])

    expect(projected.blocks).toHaveLength(2)
    expect(projected.blocks[1]).toMatchObject({
      kind: 'user',
      id: 'item_steered',
      turnId: 'turn_graph',
      text: 'Continue building the Graph.'
    })
    expect(projected.currentTurnUserId).toBe('item_original_user')
  })

  it('consumes only the queued row matching the arriving turn user message', () => {
    const queuedStarted = {
      id: 'q-started',
      text: 'run the queued task',
      deliveryState: 'in_flight' as const,
      deliveryTurnId: 'turn_queued',
      deliveryUserMessageItemId: 'item_queued'
    }
    const queuedLater = {
      id: 'q-later',
      text: 'second queued task',
      deliveryState: 'in_flight' as const,
      deliveryTurnId: 'turn_later',
      deliveryUserMessageItemId: 'item_later'
    }
    const queuedPending = {
      id: 'q-pending',
      text: 'still waiting',
      deliveryState: 'pending' as const
    }
    const initial = {
      ...state(),
      turnStartedAtByUserId: {},
      queuedMessages: [queuedStarted, queuedLater, queuedPending]
    }

    const projected = project(initial, [{
      type: 'user_message_received',
      payload: {
        itemId: 'item_queued',
        turnId: 'turn_queued',
        createdAt: '2026-07-11T00:00:00.000Z',
        text: 'run the queued task'
      }
    }])

    expect(projected.queuedMessages).toEqual([queuedLater, queuedPending])
  })

})
