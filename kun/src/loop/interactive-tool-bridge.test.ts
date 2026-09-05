import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest
} from '../domain/approval.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { SessionStore } from '../ports/session-store.js'
import { InteractiveToolBridge } from './interactive-tool-bridge.js'

describe('InteractiveToolBridge', () => {
  const automaticApproval = () => {
    const action = createApprovalActionEnvelope({
      toolName: 'bash',
      toolKind: 'command_execution',
      effects: {
        network: false,
        externalWrite: false,
        processExecution: true,
        guiAutomation: false
      },
      arguments: { command: 'npm test' },
      workspace: '/workspace',
      reason: 'command requires approval'
    })
    return createApprovalRequest({
      id: 'approval_agent',
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'bash',
      summary: 'Review bash',
      action
    })
  }

  it('arms an approval before its requested event is observed', async () => {
    const approvalGate = new InMemoryApprovalGate()
    let immediatelyAllowed = false
    const bridge = new InteractiveToolBridge({
      approvalGate,
      userInputGate: new InMemoryUserInputGate(),
      events: {
        record: async (event: { kind: string; approvalId?: string }) => {
          if (event.kind === 'approval_requested' && event.approvalId) {
            immediatelyAllowed = approvalGate.decide(event.approvalId, 'allow')
          }
        }
      } as never,
      turns: {} as TurnService,
      sessionStore: {} as SessionStore,
      nowIso: () => '2026-07-10T00:00:00.000Z'
    })

    await expect(bridge.awaitApproval({
      approval: createApprovalRequest({
        id: 'approval_1', threadId: 'thread_1', turnId: 'turn_1', toolName: 'write', summary: 'Write file'
      }),
      approvalPolicy: 'always',
      sandboxMode: 'workspace-write',
      signal: new AbortController().signal
    })).resolves.toEqual({ decision: 'allow', reviewer: 'user' })
    expect(immediatelyAllowed).toBe(true)
  })

  it.each([
    {
      decision: 'allow' as const,
      reviewStatus: 'approved' as const,
      expected: 'allow'
    },
    {
      decision: 'deny' as const,
      reviewStatus: 'denied' as const,
      expected: 'deny'
    }
  ])('routes agent $decision without registering a manual approval', async ({
    decision,
    reviewStatus,
    expected
  }) => {
    const approvalGate = new InMemoryApprovalGate()
    const gateRequest = vi.spyOn(approvalGate, 'request')
    const events = {
      record: vi.fn(async () => undefined)
    } as unknown as RuntimeEventRecorder
    const review = vi.fn(async () => ({
      decision,
      reviewer: 'agent' as const,
      reviewId: 'review_1',
      reviewStatus,
      riskLevel: decision === 'allow' ? 'low' as const : 'high' as const,
      reason: decision === 'allow' ? 'Action matches intent.' : 'Action is too broad.'
    }))
    const bridge = new InteractiveToolBridge({
      approvalGate,
      approvalReview: { review },
      userInputGate: new InMemoryUserInputGate(),
      events,
      turns: {} as TurnService,
      sessionStore: {} as SessionStore,
      nowIso: () => '2026-07-29T00:00:00.000Z'
    })

    await expect(bridge.awaitApproval({
      approval: automaticApproval(),
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent',
      actingModelRoute: {
        model: 'composer-model',
        providerId: 'composer-provider',
        accountId: 'composer-account'
      },
      intent: 'Run the tests',
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      decision: expected,
      reviewer: 'agent',
      reviewId: 'review_1'
    })

    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      approval: expect.objectContaining({ id: 'approval_agent' }),
      route: {
        model: 'composer-model',
        providerId: 'composer-provider',
        accountId: 'composer-account'
      },
      intent: 'Run the tests'
    }))
    expect(gateRequest).not.toHaveBeenCalled()
    expect(approvalGate.pending()).toEqual([])
    expect(events.record).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval_requested'
    }))
  })

  it('fails closed when agent review is unavailable without falling back to the user gate', async () => {
    const approvalGate = new InMemoryApprovalGate()
    const gateRequest = vi.spyOn(approvalGate, 'request')
    const bridge = new InteractiveToolBridge({
      approvalGate,
      userInputGate: new InMemoryUserInputGate(),
      events: { record: vi.fn(async () => undefined) } as never,
      turns: {} as TurnService,
      sessionStore: {} as SessionStore,
      nowIso: () => '2026-07-29T00:00:00.000Z'
    })

    await expect(bridge.awaitApproval({
      approval: automaticApproval(),
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'agent',
      actingModelRoute: { model: 'composer-model' },
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      decision: 'deny',
      reviewer: 'agent',
      reason: expect.stringContaining('unavailable')
    })
    expect(gateRequest).not.toHaveBeenCalled()
    expect(approvalGate.pending()).toEqual([])
  })

  it('bypasses Kun approval entirely for Full access', async () => {
    const approvalGate = new InMemoryApprovalGate()
    const gateRequest = vi.spyOn(approvalGate, 'request')
    const review = vi.fn()
    const record = vi.fn()
    const bridge = new InteractiveToolBridge({
      approvalGate,
      approvalReview: { review } as never,
      userInputGate: new InMemoryUserInputGate(),
      events: { record } as never,
      turns: {} as TurnService,
      sessionStore: {} as SessionStore,
      nowIso: () => '2026-07-29T00:00:00.000Z'
    })

    await expect(bridge.awaitApproval({
      approval: automaticApproval(),
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      approvalReviewer: 'agent',
      actingModelRoute: { model: 'composer-model' },
      signal: new AbortController().signal
    })).resolves.toEqual({ decision: 'allow', reviewer: 'user' })
    expect(review).not.toHaveBeenCalled()
    expect(gateRequest).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('persists the user-input item before its request event and settles once', async () => {
    const userInputGate = new InMemoryUserInputGate()
    const order: string[] = []
    const turns = {
      applyItem: vi.fn(async () => { order.push('item_created') }),
      updateItem: vi.fn(async () => { order.push('item_updated') })
    } as unknown as TurnService
    const events = {
      record: vi.fn(async (event: { kind: string; inputId?: string }) => {
        order.push(event.kind)
        if (event.kind === 'user_input_requested' && event.inputId) {
          expect(userInputGate.resolve(event.inputId, { status: 'submitted', answers: [] })).toBe('settled')
        }
      })
    } as unknown as RuntimeEventRecorder
    const bridge = new InteractiveToolBridge({
      approvalGate: new InMemoryApprovalGate(),
      userInputGate,
      events,
      turns,
      sessionStore: { loadEventsSince: async () => [] } as unknown as SessionStore,
      nowIso: () => '2026-07-10T00:00:00.000Z'
    })

    await expect(bridge.awaitUserInput({
      threadId: 'thread_1',
      turnId: 'turn_1',
      input: {
        id: 'input_1',
        itemId: 'item_input_1',
        prompt: 'Continue?',
        questions: [{
          header: 'Decision',
          id: 'decision',
          question: 'Continue?',
          options: [{ label: 'Yes', description: 'Proceed', recommended: true }]
        }]
      },
      signal: new AbortController().signal
    })).resolves.toEqual({ status: 'submitted', answers: [] })

    expect(turns.applyItem).toHaveBeenCalledWith(
      'thread_1',
      expect.objectContaining({
        questions: [expect.objectContaining({
          options: [{ label: 'Yes', description: 'Proceed', recommended: true }]
        })]
      })
    )
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'user_input_requested',
      questions: [expect.objectContaining({
        options: [{ label: 'Yes', description: 'Proceed', recommended: true }]
      })]
    }))
    expect(order).toEqual([
      'item_created',
      'user_input_requested',
      'item_updated',
      'user_input_resolved'
    ])
  })

  it('auto-resolves with status timeout when timeoutSeconds elapses', async () => {
    vi.useFakeTimers()
    try {
      const userInputGate = new InMemoryUserInputGate()
      const turns = {
        applyItem: vi.fn(async () => undefined),
        updateItem: vi.fn(async () => undefined)
      } as unknown as TurnService
      const recorded: Array<Record<string, unknown>> = []
      const events = {
        record: vi.fn(async (event: Record<string, unknown>) => {
          recorded.push(event)
        })
      } as unknown as RuntimeEventRecorder
      const bridge = new InteractiveToolBridge({
        approvalGate: new InMemoryApprovalGate(),
        userInputGate,
        events,
        turns,
        sessionStore: { loadEventsSince: async () => [] } as unknown as SessionStore,
        nowIso: () => '2026-07-10T00:00:00.000Z'
      })

      const pending = bridge.awaitUserInput({
        threadId: 'thread_1',
        turnId: 'turn_1',
        input: {
          id: 'input_timeout',
          itemId: 'item_input_timeout',
          prompt: 'Continue?',
          questions: [],
          timeoutSeconds: 30
        },
        signal: new AbortController().signal
      })
      await vi.advanceTimersByTimeAsync(29_999)
      expect(userInputGate.get('input_timeout')).toBeDefined()
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual({ status: 'timeout' })

      const requested = recorded.find((event) => event.kind === 'user_input_requested')
      expect(requested).toMatchObject({ timeoutSeconds: 30 })
      const resolved = recorded.find((event) => event.kind === 'user_input_resolved')
      expect(resolved).toMatchObject({ status: 'timeout' })
      expect(turns.updateItem).toHaveBeenCalledWith(
        'thread_1',
        'item_input_timeout',
        expect.objectContaining({ status: 'timeout' })
      )

      // A late user submission cannot revive the settled gate.
      expect(userInputGate.resolve('input_timeout', { status: 'submitted', answers: [] })).toBe('missing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('disarms the timeout when the user answers first', async () => {
    vi.useFakeTimers()
    try {
      const userInputGate = new InMemoryUserInputGate()
      const turns = {
        applyItem: vi.fn(async () => undefined),
        updateItem: vi.fn(async () => undefined)
      } as unknown as TurnService
      const events = {
        record: vi.fn(async () => undefined)
      } as unknown as RuntimeEventRecorder
      const bridge = new InteractiveToolBridge({
        approvalGate: new InMemoryApprovalGate(),
        userInputGate,
        events,
        turns,
        sessionStore: { loadEventsSince: async () => [] } as unknown as SessionStore,
        nowIso: () => '2026-07-10T00:00:00.000Z'
      })

      const pending = bridge.awaitUserInput({
        threadId: 'thread_1',
        turnId: 'turn_1',
        input: {
          id: 'input_answered',
          itemId: 'item_input_answered',
          prompt: 'Continue?',
          questions: [],
          timeoutSeconds: 10
        },
        signal: new AbortController().signal
      })
      userInputGate.resolve('input_answered', { status: 'submitted', answers: [] })
      await expect(pending).resolves.toEqual({ status: 'submitted', answers: [] })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(userInputGate.get('input_answered')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
