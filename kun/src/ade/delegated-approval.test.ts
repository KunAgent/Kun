import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { makeDelegatedAwaitApproval } from './delegated-approval.js'
import { createApprovalRequest } from '../domain/approval.js'
import { buildGoogleWorkspaceApprovalAction } from '../google-workspace/approval.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'

describe('Delegated mandatory human approval', () => {
  it('keeps full-access agent-review turns in the human gate and identifies the actual human decision', async () => {
    const gate = new InMemoryApprovalGate()
    const action = buildGoogleWorkspaceApprovalAction({ toolName: 'google_workspace_call', callId: 'call', arguments: {
      method: 'gmail.users.messages.send', body: { to: ['a@example.com'], subject: 'Subject', text: 'Body' }
    } }, { workspace: '/tmp' } as ToolHostContext)
    const request = createApprovalRequest({ id: 'appr', threadId: 'thread', turnId: 'turn', toolName: 'google_workspace_call', summary: 'Complete summary', action })
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
})
