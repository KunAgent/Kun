import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { makeDelegatedAwaitApproval } from './delegated-approval.js'
import { createApprovalActionEnvelope, createApprovalRequest } from '../domain/approval.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'

describe('Delegated mandatory human approval', () => {
  it('preserves a provider option selected by the human gate', async () => {
    const gate = new InMemoryApprovalGate({ resolvedCapacity: 1 })
    const action = { ...createApprovalActionEnvelope({ toolName: 'acp:execute', arguments: { command: 'ls' }, workspace: '/tmp', reason: 'Run command' }),
      permissionOptions: [{ optionId: 'provider-always', name: 'Remember', kind: 'allow_always' as const }] }
    const request = createApprovalRequest({ id: 'choice', threadId: 'thread', turnId: 'turn', toolName: 'acp:execute', summary: 'Run command', action })
    const awaitApproval = makeDelegatedAwaitApproval({ approvalGate: gate, events: { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder }, {
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user', actingModelRoute: {} as ActingTurnModelRoute, intent: 'List files', signal: new AbortController().signal
    })
    const result = awaitApproval(request)
    void gate.request(createApprovalRequest({ id: 'later', threadId: 'thread', turnId: 'turn', toolName: 'tool', summary: 'Another request' }))
    gate.decide('choice', 'allow', undefined, { optionId: 'provider-always' })
    gate.decide('later', 'deny')
    expect(gate.get('choice')).toBeUndefined()
    await expect(result).resolves.toEqual({ decision: 'allow', reviewer: 'user', choice: { optionId: 'provider-always' } })
  })
  it.each(['absent', 'throws'])('resolves a human decision without reading optional gate metadata when get %s', async (metadata) => {
    const get = vi.fn(() => { throw new Error('Metadata lookup must not run') })
    const gate = {
      request: vi.fn(async () => 'allow' as const),
      ...(metadata === 'throws' ? { get } : {})
    } as unknown as ApprovalGate
    const events = { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder
    const awaitApproval = makeDelegatedAwaitApproval({ approvalGate: gate, events }, {
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user',
      actingModelRoute: {} as ActingTurnModelRoute, intent: 'Review the action', signal: new AbortController().signal
    })
    const action = createApprovalActionEnvelope({
      toolName: 'send_message', arguments: { to: ['a@example.com'], text: 'Body' },
      workspace: '/tmp', reason: 'Confirm the message', requiresUserDecision: true,
      effects: { network: true, externalWrite: true, processExecution: false, guiAutomation: false }
    })
    const request = createApprovalRequest({ id: 'appr', threadId: 'thread', turnId: 'turn', toolName: 'send_message', summary: 'Review action', action })
    await expect(awaitApproval(request)).resolves.toEqual({ decision: 'allow', reviewer: 'user' })
    expect(gate.request).toHaveBeenCalledWith(request)
    expect(get).not.toHaveBeenCalled()
  })

  it('keeps full-access agent-review turns in the human gate and identifies the actual human decision', async () => {
    const gate = new InMemoryApprovalGate()
    const action = createApprovalActionEnvelope({
      toolName: 'send_message', arguments: { to: ['a@example.com'], text: 'Body' },
      workspace: '/tmp', reason: 'Confirm the message', requiresUserDecision: true,
      effects: { network: true, externalWrite: true, processExecution: false, guiAutomation: false }
    })
    const request = createApprovalRequest({ id: 'appr', threadId: 'thread', turnId: 'turn', toolName: 'send_message', summary: 'Complete summary', action })
    const review = vi.fn()
    const events = { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder
    const awaitApproval = makeDelegatedAwaitApproval({ approvalGate: gate, approvalReview: { review }, events }, {
      approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'agent', actingModelRoute: {} as ActingTurnModelRoute, intent: 'Send mail', signal: new AbortController().signal
    })
    let settled = false
    const result = awaitApproval(request).then((value) => { settled = true; return value })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(review).not.toHaveBeenCalled()
    expect(gate.get('appr')?.status).toBe('pending')
    gate.decide('appr', 'allow', 'Human approved exact message')
    await expect(result).resolves.toEqual({ decision: 'allow', reviewer: 'user', reason: 'Human approved exact message' })
  })

  it('passes harness provenance to the reviewer and never implies default-provider inheritance', async () => {
    const review = vi.fn(async () => ({
      decision: 'deny' as const,
      reviewer: 'agent' as const,
      reviewId: 'review_1',
      reviewStatus: 'denied' as const,
      reason: 'Denied'
    }))
    const events = { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder
    const signal = new AbortController().signal
    const approval = createApprovalRequest({
      id: 'appr_source', threadId: 'thread', turnId: 'turn', toolName: 'acp:execute', summary: 'Run command',
      action: createApprovalActionEnvelope({ toolName: 'acp:execute', arguments: { command: 'ls' }, workspace: '/tmp', reason: 'Run command' })
    })
    const base = {
      approvalPolicy: 'on-request' as const, sandboxMode: 'workspace-write' as const,
      approvalReviewer: 'agent' as const, actingModelRoute: { model: 'swe-2-high', providerId: 'codex' },
      intent: 'List files', signal
    }
    await makeDelegatedAwaitApproval({ approvalReview: { review }, events }, {
      ...base, reviewSource: { harnessId: 'devin', credentialMode: 'native-login' }
    })(approval)
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      route: expect.objectContaining({
        model: 'swe-2-high',
        providerId: 'codex',
        source: { harnessId: 'devin', credentialMode: 'native-login' }
      })
    }))
    // A caller that cannot prove provenance must not look like a Kun turn.
    await makeDelegatedAwaitApproval({ approvalReview: { review }, events }, base)(approval)
    expect(review).toHaveBeenLastCalledWith(expect.objectContaining({
      route: expect.objectContaining({ source: { harnessId: 'unknown' } })
    }))
  })

  it('denies an already-cancelled turn before any review or human gate', async () => {
    const review = vi.fn()
    const gate = new InMemoryApprovalGate()
    const events = { record: vi.fn(async () => undefined) } as unknown as RuntimeEventRecorder
    const controller = new AbortController()
    controller.abort()
    const awaitApproval = makeDelegatedAwaitApproval({ approvalGate: gate, approvalReview: { review }, events }, {
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'agent',
      actingModelRoute: { model: 'm', providerId: 'p' }, intent: 'Act', signal: controller.signal
    })
    const request = createApprovalRequest({ id: 'aborted', threadId: 'thread', turnId: 'turn', toolName: 'acp:execute', summary: 'Run' })
    await expect(awaitApproval(request)).resolves.toBe('deny')
    expect(review).not.toHaveBeenCalled()
    expect(gate.get('aborted')).toBeUndefined()
  })
})
