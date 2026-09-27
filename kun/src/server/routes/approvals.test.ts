import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { decideApproval, listPendingApprovals } from './approvals.js'

function decisionRequest(approvalId: string, decision: 'allow' | 'deny'): Request {
  return new Request(`http://127.0.0.1/v1/approvals/${approvalId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision })
  })
}

describe('pending approvals list route', () => {
  it('lists pending approvals with the mobile projection fields', () => {
    const gate = new InMemoryApprovalGate()
    void gate.request(createApprovalRequest({
      id: 'approval_1', threadId: 'thread_1', turnId: 'turn_1',
      toolName: 'write', summary: 'Write the file'
    }))
    void gate.request(createApprovalRequest({
      id: 'approval_2', threadId: 'thread_2', turnId: 'turn_2',
      toolName: 'bash', summary: 'Run the command'
    }))

    const response = listPendingApprovals(gate)
    expect(response.status).toBe(200)
    const { approvals } = JSON.parse(response.body)
    expect(approvals).toHaveLength(2)
    expect(approvals.map((a: { approvalId: string }) => a.approvalId).sort())
      .toEqual(['approval_1', 'approval_2'])
    expect(approvals[0]).toMatchObject({
      threadId: expect.any(String), turnId: expect.any(String),
      toolName: expect.any(String), summary: expect.any(String),
      createdAt: expect.any(String)
    })
  })

  it('scopes to one thread and drops resolved requests', () => {
    const gate = new InMemoryApprovalGate()
    void gate.request(createApprovalRequest({
      id: 'approval_keep', threadId: 'thread_1', turnId: 'turn_1',
      toolName: 'write', summary: 'Keep me'
    }))
    void gate.request(createApprovalRequest({
      id: 'approval_other', threadId: 'thread_2', turnId: 'turn_2',
      toolName: 'bash', summary: 'Other thread'
    }))
    void gate.request(createApprovalRequest({
      id: 'approval_resolved', threadId: 'thread_1', turnId: 'turn_1',
      toolName: 'read', summary: 'Already decided'
    }))
    expect(gate.decide('approval_resolved', 'allow')).toBe(true)

    const scoped = JSON.parse(listPendingApprovals(gate, 'thread_1').body)
    expect(scoped.approvals.map((a: { approvalId: string }) => a.approvalId))
      .toEqual(['approval_keep'])
  })
})

describe('approval decision route', () => {
  it.each([
    'review_automatic_1',
    'approval_automatic_1'
  ])('cannot resolve unregistered automatic identifier %s', async (identifier) => {
    const gate = new InMemoryApprovalGate()
    const events = { record: vi.fn(async () => undefined) }

    const response = await decideApproval({
      approvalId: identifier,
      request: decisionRequest(identifier, 'allow'),
      gate,
      events: events as never
    })
    if (response instanceof Response) throw new Error('expected JSON response')

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'not_found',
      message: expect.stringContaining(identifier)
    })
    expect(gate.get(identifier)).toBeUndefined()
    expect(gate.pending()).toEqual([])
    expect(events.record).not.toHaveBeenCalled()
  })

  it('serializes concurrent manual clients and persists one resolution before release', async () => {
    const gate = new InMemoryApprovalGate()
    const pending = gate.request(createApprovalRequest({
      id: 'approval_manual_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'write',
      summary: 'Write the requested file'
    }))
    const events = {
      record: vi.fn(async () => undefined)
    }

    const [first, second] = await Promise.all([
      decideApproval({
        approvalId: 'approval_manual_1',
        request: decisionRequest('approval_manual_1', 'allow'),
        gate,
        events: events as never
      }),
      decideApproval({
        approvalId: 'approval_manual_1',
        request: decisionRequest('approval_manual_1', 'allow'),
        gate,
        events: events as never
      })
    ])
    if (first instanceof Response || second instanceof Response) {
      throw new Error('expected JSON responses')
    }

    await expect(pending).resolves.toBe('allow')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect([
      JSON.parse(first.body).alreadyResolved,
      JSON.parse(second.body).alreadyResolved
    ].filter(Boolean)).toHaveLength(1)
    expect(events.record).toHaveBeenCalledOnce()
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval_resolved',
      approvalId: 'approval_manual_1',
      approvalReviewer: 'user',
      status: 'allowed'
    }))
  })

  it('allows only one winner when concurrent manual clients submit opposite decisions', async () => {
    const gate = new InMemoryApprovalGate()
    const pending = gate.request(createApprovalRequest({
      id: 'approval_manual_race',
      threadId: 'thread_1',
      turnId: 'turn_1',
      toolName: 'bash',
      summary: 'Run a command'
    }))
    const events = {
      record: vi.fn(async () => undefined)
    }

    const responses = await Promise.all([
      decideApproval({
        approvalId: 'approval_manual_race',
        request: decisionRequest('approval_manual_race', 'allow'),
        gate,
        events: events as never
      }),
      decideApproval({
        approvalId: 'approval_manual_race',
        request: decisionRequest('approval_manual_race', 'deny'),
        gate,
        events: events as never
      })
    ])
    if (responses.some((response) => response instanceof Response)) {
      throw new Error('expected JSON responses')
    }
    const jsonResponses = responses as Array<{
      status: number
      body: string
    }>
    const winner = await pending

    expect(jsonResponses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(events.record).toHaveBeenCalledOnce()
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval_resolved',
      approvalId: 'approval_manual_race',
      approvalReviewer: 'user',
      status: winner === 'allow' ? 'allowed' : 'denied'
    }))
    expect(gate.get('approval_manual_race')).toMatchObject({
      status: winner === 'allow' ? 'allowed' : 'denied'
    })
  })
})
