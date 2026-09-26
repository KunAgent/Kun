import { describe, expect, it } from 'vitest'
import { ThreadSchema } from '../contracts/threads.js'
import type { RuntimeEvent } from '../contracts/events.js'
import {
  applyRuntimeEvent,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  setProjectionRunningTurn
} from './state.js'
import { lastAssistantText, renderThreadMarkdown } from './operations.js'
import type { ThreadDetail } from './client.js'

function detail(): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_1',
      title: 'Shared thread',
      workspace: '/tmp/project',
      model: 'model-a',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: []
  }
}

function event(value: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'kind' | 'seq'>): RuntimeEvent {
  return {
    timestamp: '2026-07-22T00:00:00.000Z',
    threadId: 'thr_1',
    ...value
  } as RuntimeEvent
}

describe('thread projection', () => {
  it('uses an approval liveness list when the server provides one', () => {
    const approval = {
      id: 'item_approval',
      turnId: 'turn_approval',
      threadId: 'thr_1',
      role: 'tool' as const,
      status: 'pending' as const,
      createdAt: '2026-07-22T00:00:00.000Z',
      kind: 'approval' as const,
      approvalId: 'approval_1',
      toolName: 'bash',
      summary: 'Run tests'
    }
    const snapshot = {
      ...detail(),
      pendingApprovalIds: [],
      turns: [{ id: 'turn_approval', status: 'running', items: [approval] }]
    } as unknown as ThreadDetail

    expect(projectThreadSnapshot(snapshot).pendingApproval).toBeUndefined()
    expect(projectThreadSnapshot({ ...snapshot, pendingApprovalIds: ['approval_1'] }))
      .toMatchObject({ pendingApproval: { approvalId: 'approval_1' } })
    // Older servers omit the field, which must preserve their legacy behavior.
    expect(projectThreadSnapshot({ ...snapshot, pendingApprovalIds: undefined }))
      .toMatchObject({ pendingApproval: { approvalId: 'approval_1' } })
  })

  it('appends delta fragments once by sequence and accepts an authoritative completion snapshot', () => {
    const initial = projectThreadSnapshot(detail())
    const assistantItem = {
      id: 'item_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'assistant' as const,
      status: 'running' as const,
      createdAt: '2026-07-22T00:00:00.000Z',
      kind: 'assistant_text' as const,
      text: 'hello'
    }
    const delta = event({
      kind: 'assistant_text_delta',
      seq: 1,
      turnId: 'turn_1',
      itemId: 'item_1',
      item: assistantItem
    })
    const once = applyRuntimeEvent(initial, delta)
    const duplicate = applyRuntimeEvent(once, delta)
    const outOfOrder = applyRuntimeEvent(duplicate, {
      ...delta,
      seq: 0,
      item: { ...assistantItem, text: ' ignored' }
    } as RuntimeEvent)
    const updated = applyRuntimeEvent(outOfOrder, {
      ...delta,
      seq: 2,
      item: { ...assistantItem, text: ' world' }
    } as RuntimeEvent)
    const completed = applyRuntimeEvent(updated, event({
      kind: 'item_completed',
      seq: 3,
      turnId: 'turn_1',
      itemId: 'item_1',
      item: { ...assistantItem, status: 'completed', text: 'hello world!' }
    }))

    expect(once.items).toHaveLength(1)
    expect(duplicate).toBe(once)
    expect(outOfOrder).toBe(once)
    expect(updated.items).toHaveLength(1)
    expect(updated.items[0]).toMatchObject({ text: 'hello world' })
    expect(updated.thread.turns).toHaveLength(1)
    expect(updated.thread.turns[0]).toMatchObject({ id: 'turn_1', items: [{ text: 'hello world' }] })
    expect(lastAssistantText(updated.thread)).toBe('hello world')
    expect(renderThreadMarkdown(updated.thread)).toContain('hello world')
    expect(completed.items[0]).toMatchObject({ status: 'completed', text: 'hello world!' })
  })

  it('accumulates hidden reasoning independently from assistant text', () => {
    let state = projectThreadSnapshot(detail())
    const base = {
      turnId: 'turn_1', threadId: 'thr_1', role: 'assistant' as const,
      status: 'running' as const, createdAt: '2026-07-22T00:00:00.000Z'
    }
    state = applyRuntimeEvent(state, event({
      kind: 'assistant_reasoning_delta', seq: 1, turnId: 'turn_1', itemId: 'reasoning_1',
      item: { ...base, id: 'reasoning_1', kind: 'assistant_reasoning', text: 'think' }
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'assistant_reasoning_delta', seq: 2, turnId: 'turn_1', itemId: 'reasoning_1',
      item: { ...base, id: 'reasoning_1', kind: 'assistant_reasoning', text: ' more' }
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'assistant_text_delta', seq: 3, turnId: 'turn_1', itemId: 'text_1',
      item: { ...base, id: 'text_1', kind: 'assistant_text', text: 'answer' }
    }))
    expect(state.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reasoning_1', text: 'think more' }),
      expect.objectContaining({ id: 'text_1', text: 'answer' })
    ]))
  })

  it('projects request-local context snapshots independently from cumulative usage', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'usage',
      seq: 1,
      model: 'model-a',
      usage: {
        promptTokens: 557_000,
        completionTokens: 1_000,
        totalTokens: 558_000,
        cachedTokens: 0,
        cacheHitRate: null,
        turns: 2
      }
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'context_snapshot',
      seq: 2,
      turnId: 'turn_1',
      model: 'model-a',
      providerId: 'provider-a',
      stepIndex: 0,
      contextWindowTokens: 372_000,
      softThresholdTokens: 279_000,
      hardThresholdTokens: 316_200,
      estimatedInputTokens: 120_000,
      breakdown: {
        tools: 10_000,
        system: 20_000,
        skills: 10_000,
        messages: 75_000,
        other: 5_000
      },
      toolCount: 5,
      activeSkillIds: [],
      contextManagement: 'kun-managed',
      nativeHistory: 'none'
    }))

    expect(state.usage?.totalTokens).toBe(558_000)
    expect(state.contextSnapshot).toMatchObject({
      estimatedInputTokens: 120_000,
      contextWindowTokens: 372_000
    })
    expect(matchingRequestContextSnapshot(state, {
      model: 'model-a',
      providerId: 'provider-a'
    })).toBe(state.contextSnapshot)
    expect(matchingRequestContextSnapshot(state, {
      model: 'model-b',
      providerId: 'provider-a'
    })).toBeUndefined()
    expect(matchingRequestContextSnapshot(state, {
      model: 'model-a',
      providerId: 'provider-b'
    })).toBeUndefined()
  })

  it('reflects externally-started turns and cross-client gate resolution', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started', seq: 1, turnId: 'turn_gui', status: 'running',
      model: 'model-b', providerId: 'provider-b', accountId: 'account-b',
      reasoningEffort: 'high', mode: 'plan',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'approval_requested',
      seq: 2,
      turnId: 'turn_gui',
      approvalId: 'appr_1',
      toolName: 'bash',
      status: 'pending',
      summary: 'Run tests'
    }))
    expect(state).toMatchObject({ runningTurnId: 'turn_gui', pendingApproval: { approvalId: 'appr_1' } })
    expect(state.thread.turns[0]).toMatchObject({
      id: 'turn_gui', status: 'running', model: 'model-b', providerId: 'provider-b',
      accountId: 'account-b', reasoningEffort: 'high', mode: 'plan',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      approvalReviewer: 'agent'
    })

    state = applyRuntimeEvent(state, event({
      kind: 'approval_resolved',
      seq: 3,
      turnId: 'turn_gui',
      approvalId: 'appr_1',
      toolName: 'bash',
      status: 'allowed'
    }))
    expect(state.pendingApproval).toBeUndefined()

    state = applyRuntimeEvent(state, event({ kind: 'turn_completed', seq: 4, turnId: 'turn_gui', status: 'completed' }))
    expect(state.runningTurnId).toBeUndefined()
    expect(state.thread).toMatchObject({ status: 'idle', latestSeq: 4, turns: [{ id: 'turn_gui', status: 'completed' }] })
  })

  it('projects automatic review as non-actionable progress and durable terminal audit state', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started',
      seq: 1,
      turnId: 'turn_agent_review',
      status: 'running'
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'approval_review_started',
      seq: 2,
      turnId: 'turn_agent_review',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      toolName: 'bash',
      reviewer: 'agent',
      status: 'in-progress',
      summary: 'Run tests',
      action: {
        version: 1,
        kind: 'command',
        toolName: 'bash',
        toolKind: 'command_execution',
        effects: {
          network: false,
          externalWrite: false,
          processExecution: true,
          guiAutomation: false
        },
        arguments: { command: 'npm test' },
        workspace: '/tmp/project',
        targets: [{ kind: 'command', value: 'npm test' }],
        reason: 'Host command requires review'
      }
    }))

    expect(state.pendingApproval).toBeUndefined()
    expect(state.activity?.label).toBe('Agent reviewing bash')
    expect(state.approvalReviews).toEqual([
      expect.objectContaining({
        reviewId: 'review_1',
        status: 'in-progress',
        summary: 'Run tests'
      })
    ])

    state = applyRuntimeEvent(state, event({
      kind: 'approval_review_completed',
      seq: 3,
      turnId: 'turn_agent_review',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      toolName: 'bash',
      reviewer: 'agent',
      status: 'denied',
      summary: 'Run tests',
      decision: 'deny',
      riskLevel: 'high',
      rationale: 'The command is outside the requested scope.'
    }))

    expect(state.pendingApproval).toBeUndefined()
    expect(state.approvalReviews).toEqual([
      expect.objectContaining({
        reviewId: 'review_1',
        status: 'denied',
        decision: 'deny',
        riskLevel: 'high',
        rationale: 'The command is outside the requested scope.',
        completedAt: '2026-07-22T00:00:00.000Z'
      })
    ])

    state = applyRuntimeEvent(state, event({
      kind: 'approval_resolved',
      seq: 4,
      turnId: 'turn_agent_review',
      approvalId: 'approval_1',
      toolName: 'bash',
      status: 'denied',
      approvalReviewer: 'agent',
      decisionSource: 'agent',
      summary: 'Run tests',
      reason: 'The command is outside the requested scope.'
    }))

    expect(state.pendingApproval).toBeUndefined()
    expect(state.approvalReviews).toHaveLength(1)
  })

  it('keeps the Graph orchestration contract on an optimistic TUI turn', () => {
    const state = setProjectionRunningTurn(
      projectThreadSnapshot(detail()),
      'turn_graph',
      'Implement with Graph.',
      '2026-07-22T00:00:01.000Z',
      {
        mode: 'agent',
        orchestration: 'graph'
      }
    )

    expect(state.thread.turns).toContainEqual(expect.objectContaining({
      id: 'turn_graph',
      mode: 'agent',
      orchestration: 'graph',
      prompt: 'Implement with Graph.'
    }))
  })

  it('keeps runtime failures visible when no assistant item was emitted', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started', seq: 1, turnId: 'turn_auth', status: 'running'
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'error', seq: 2, turnId: 'turn_auth', code: 'http_401', severity: 'error',
      message: 'model request failed with status 401: invalid or expired credentials'
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'turn_failed', seq: 3, turnId: 'turn_auth', status: 'failed', code: 'http_401',
      message: 'model request failed with status 401: invalid or expired credentials'
    }))

    expect(state.runningTurnId).toBeUndefined()
    expect(state.items.filter((item) => item.kind === 'error')).toEqual([
      expect.objectContaining({
        id: 'item_turn_auth_error', turnId: 'turn_auth', code: 'http_401', status: 'failed'
      })
    ])
    expect(state.thread.turns[0]?.items).toContainEqual(expect.objectContaining({ kind: 'error', code: 'http_401' }))
  })

  it('tracks delegated children independently without completing the parent turn', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started', seq: 1, turnId: 'turn_parent', status: 'running'
    }))
    const child = {
      parentThreadId: 'thr_1', parentTurnId: 'turn_parent', childId: 'child_1',
      childLabel: 'Inspect streaming', childStatus: 'running' as const, childSeq: 1,
      childProfile: 'researcher',
      activity: {
        phase: 'tool' as const,
        label: 'Searching the workspace',
        toolName: 'search',
        startedAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z'
      }
    }
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started', seq: 2, turnId: 'turn_parent', status: 'running', child
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'turn_completed', seq: 3, turnId: 'turn_parent', status: 'completed', text: 'Found the cause',
      child: {
        ...child,
        childStatus: 'completed',
        childSeq: 2,
        childProfileName: 'Researcher',
        childProviderId: 'deepseek',
        childToolPolicy: 'readOnly',
        durationMs: 1250,
        queuedMs: 250,
        toolInvocations: 3,
        totalTokens: 4096,
        cacheHitRate: 0.75,
        costUsd: 0.01
      }
    }))

    expect(state.runningTurnId).toBe('turn_parent')
    expect(state.thread.turns[0]?.status).toBe('running')
    expect(state.childRuns).toEqual([
      expect.objectContaining({
        childId: 'child_1', label: 'Inspect streaming', profile: 'researcher',
        profileName: 'Researcher', providerId: 'deepseek', toolPolicy: 'readOnly',
        status: 'completed', text: 'Found the cause', durationMs: 1250, queuedMs: 250,
        toolInvocations: 3, totalTokens: 4096, cacheHitRate: 0.75, costUsd: 0.01,
        activity: expect.objectContaining({ phase: 'tool', label: 'Searching the workspace' })
      })
    ])
  })

  it('projects model retries and live response phases into the activity state', () => {
    let state = projectThreadSnapshot(detail())
    state = applyRuntimeEvent(state, event({
      kind: 'turn_started', seq: 1, turnId: 'turn_live',
      timestamp: '2026-07-22T00:00:00.000Z'
    }))
    state = applyRuntimeEvent(state, event({
      kind: 'model_request_retry', seq: 2, turnId: 'turn_live', status: 429,
      attempt: 2, maxAttempts: 4, delayMs: 250,
      timestamp: '2026-07-22T00:00:02.000Z'
    }))
    expect(state.activity).toMatchObject({
      phase: 'retrying', attempt: 2, maxAttempts: 4,
      startedAt: '2026-07-22T00:00:02.000Z',
      turnStartedAt: '2026-07-22T00:00:00.000Z'
    })
    state = applyRuntimeEvent(state, event({
      kind: 'assistant_text_delta', seq: 3, turnId: 'turn_live', itemId: 'answer',
      timestamp: '2026-07-22T00:00:04.000Z',
      item: {
        id: 'answer', turnId: 'turn_live', threadId: 'thr_1', role: 'assistant', status: 'running',
        createdAt: '2026-07-22T00:00:04.000Z', kind: 'assistant_text', text: 'Hello'
      }
    }))
    expect(state.activity).toMatchObject({
      phase: 'responding', label: 'Responding',
      startedAt: '2026-07-22T00:00:04.000Z',
      turnStartedAt: '2026-07-22T00:00:00.000Z'
    })
    state = applyRuntimeEvent(state, event({
      kind: 'assistant_text_delta', seq: 4, turnId: 'turn_live', itemId: 'answer',
      timestamp: '2026-07-22T00:00:05.000Z',
      item: {
        id: 'answer', turnId: 'turn_live', threadId: 'thr_1', role: 'assistant', status: 'running',
        createdAt: '2026-07-22T00:00:04.000Z', kind: 'assistant_text', text: ' again'
      }
    }))
    expect(state.activity).toMatchObject({
      phase: 'responding',
      startedAt: '2026-07-22T00:00:04.000Z',
      turnStartedAt: '2026-07-22T00:00:00.000Z'
    })
  })

  it('projects only live pending structured inputs from snapshots', () => {
    const source = detail()
    source.turns = [{
      id: 'turn_1',
      threadId: 'thr_1',
      status: 'running',
      orchestration: 'direct',
      prompt: 'question',
      steering: [],
      createdAt: source.createdAt,
      items: [{
        id: 'item_input',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        createdAt: source.createdAt,
        kind: 'user_input',
        inputId: 'input_1',
        prompt: 'Choose',
        questions: [],
        status: 'pending'
      }],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedDirectiveIds: [],
      injectedDirectiveSummaries: [],
      injectedInstructionSources: []
    }]
    expect(projectThreadSnapshot(source).pendingUserInput).toBeUndefined()
    source.pendingUserInputIds = ['input_1']
    expect(projectThreadSnapshot(source).pendingUserInput).toMatchObject({ inputId: 'input_1' })
  })

  it('projects queued guidance, goal, todos, and thread policy changes from other clients', () => {
    const source = detail()
    source.turns = [{
      id: 'turn_1', threadId: 'thr_1', status: 'running', orchestration: 'direct', prompt: 'work', steering: [],
      createdAt: source.createdAt, items: [], attachmentIds: [], activeSkillIds: [],
      injectedMemoryIds: [], injectedMemorySummaries: [], injectedDirectiveIds: [], injectedDirectiveSummaries: [], injectedInstructionSources: []
    }]
    let state = projectThreadSnapshot(source)
    state = applyRuntimeEvent(state, event({ kind: 'turn_steered', seq: 1, turnId: 'turn_1', text: 'focus tests' }))
    expect(state.thread.turns[0]?.steering).toEqual(['focus tests'])
    state = applyRuntimeEvent(state, event({
      kind: 'turn_steering_updated',
      seq: 2,
      turnId: 'turn_1',
      entries: [{ text: 'ship first' }, { text: 'then document' }]
    }))
    expect(state.thread.turns[0]?.steering).toEqual(['ship first', 'then document'])

    state = applyRuntimeEvent(state, event({
      kind: 'goal_updated', seq: 3, goal: {
        threadId: 'thr_1', objective: 'ship', status: 'active', tokensUsed: 0,
        timeUsedSeconds: 0, createdAt: source.createdAt, updatedAt: source.updatedAt
      }
    }))
    expect(state.thread.goal?.objective).toBe('ship')
    state = applyRuntimeEvent(state, event({ kind: 'goal_cleared', seq: 4, goal: null, cleared: true }))
    expect(state.thread.goal).toBeUndefined()

    state = applyRuntimeEvent(state, event({
      kind: 'todos_updated', seq: 5, todos: {
        threadId: 'thr_1', updatedAt: source.updatedAt,
        items: [{ id: 'todo_1', content: 'test', status: 'pending', createdAt: source.createdAt, updatedAt: source.updatedAt }]
      }
    }))
    expect(state.thread.todos?.items[0]?.content).toBe('test')
    state = applyRuntimeEvent(state, event({
      kind: 'thread_updated', seq: 6, mode: 'plan', additionalWorkspaces: ['/tmp/extra'],
      approvalPolicy: 'never', sandboxMode: 'read-only', approvalReviewer: 'agent'
    }))
    expect(state.thread).toMatchObject({
      mode: 'plan',
      additionalWorkspaces: ['/tmp/extra'],
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      approvalReviewer: 'agent'
    })
  })
})
