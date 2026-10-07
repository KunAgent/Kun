import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { makeDelegatedAwaitApproval } from './delegated-approval.js'
import { createApprovalActionEnvelope, createApprovalRequest } from '../domain/approval.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'

describe('Delegated mandatory human approval', () => {
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
    await expect(result).resolves.toEqual({ decision: 'allow', reviewer: 'user' })
  })
})
