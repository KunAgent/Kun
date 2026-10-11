import { describe, expect, it, vi } from 'vitest'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { approvalRequestFromAcp, pickPermissionOutcome } from '../../runtime/acp/acp-permission.js'
import { decideApproval } from './approvals.js'
import type { ApprovalChoice } from '../../contracts/approval-choice.js'
import { createApprovalRequest } from '../../domain/approval.js'

function setup(gate = new InMemoryApprovalGate()) {
  const options = [
    { optionId: 'provider-once', name: 'This time only', kind: 'allow_once' as const },
    { optionId: 'provider-always', name: 'Remember my decision', kind: 'allow_always' as const },
    { optionId: 'provider-reject', name: 'Do not run', kind: 'reject_once' as const },
    { optionId: 'provider-never', name: 'Never run', kind: 'reject_always' as const }
  ]
  const approval = approvalRequestFromAcp({ approvalId: 'appr', threadId: 'thread', turnId: 'turn', workspace: '/workspace',
    params: { sessionId: 'session', toolCall: { toolCallId: 'tool', kind: 'execute', title: 'Command', rawInput: { command: 'echo ok' } }, options } })
  const resolution = gate.requestResolution(approval)
  const pending = resolution.then((outcome) => outcome.decision)
  const events = { record: vi.fn(async () => undefined) }
  const submit = (decision: 'allow' | 'deny', choice: ApprovalChoice) => decideApproval({
    approvalId: approval.id, gate, events: events as never,
    request: new Request('http://localhost/v1/approvals/appr', { method: 'POST', body: JSON.stringify({ decision, choice }) })
  })
  return { approval, options, gate, pending, resolution, events, submit }
}

describe('provider approval choices', () => {
  it('retains an old pending request completed after a newer request with capacity one', async () => {
    const h = setup(new InMemoryApprovalGate({ resolvedCapacity: 1 }))
    void h.gate.request(createApprovalRequest({ id: 'newer', threadId: 'thread', turnId: 'turn', toolName: 'tool', summary: 'Newer request' }))
    h.gate.decide('newer', 'allow')
    expect((await h.submit('allow', { optionId: 'provider-always' })).status).toBe(200)
    expect(h.gate.get('newer')).toBeUndefined()
    expect(h.gate.get('appr')?.choice).toEqual({ optionId: 'provider-always' })
    await expect(h.resolution).resolves.toMatchObject({ choice: { optionId: 'provider-always' } })
  })

  it('delivers the exact choice and HTTP success even if another completion immediately evicts its lookup record', async () => {
    class EvictingGate extends InMemoryApprovalGate {
      override commitDecision(id: string): boolean {
        const committed = super.commitDecision(id)
        if (id === 'appr' && committed) this.decide('later', 'deny')
        return committed
      }
    }
    const h = setup(new EvictingGate({ resolvedCapacity: 1 }))
    void h.gate.request(createApprovalRequest({ id: 'later', threadId: 'thread', turnId: 'turn', toolName: 'tool', summary: 'Later request' }))
    expect((await h.submit('allow', { optionId: 'provider-always' })).status).toBe(200)
    expect(h.gate.get('appr')).toBeUndefined()
    const resolution = await h.resolution
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.choice)).toBe(true)
    expect(pickPermissionOutcome(h.options, resolution)).toEqual({ outcome: { outcome: 'selected', optionId: 'provider-always' } })
  })
  it.each(['provider-once', 'provider-always', 'provider-reject', 'provider-never'])('preserves exact option %s through durable manual resolution', async (optionId) => {
    const h = setup()
    const decision = optionId === 'provider-once' || optionId === 'provider-always' ? 'allow' : 'deny'
    const response = await h.submit(decision, { optionId })
    expect(response.status).toBe(200)
    await expect(h.pending).resolves.toBe(decision)
    expect(h.events.record).toHaveBeenCalledWith(expect.objectContaining({ choice: { optionId } }))
    expect(pickPermissionOutcome(h.options, { decision, reviewer: 'user', choice: h.gate.get('appr')?.choice }))
      .toEqual({ outcome: { outcome: 'selected', optionId } })
  })

  it('rejects forged options, opposite behavior, and ambiguous IDs without resolving the gate', async () => {
    const h = setup()
    expect((await h.submit('allow', { optionId: 'forged' })).status).toBe(400)
    expect((await h.submit('allow', { optionId: 'provider-reject' })).status).toBe(400)
    expect((await h.submit('allow', { cancelled: true })).status).toBe(400)
    expect(h.events.record).not.toHaveBeenCalled()
    expect(h.gate.get('appr')?.status).toBe('pending')
  })

  it('cancels a request without choosing a rejection option or widening any permission', async () => {
    const h = setup()
    expect((await h.submit('deny', { cancelled: true })).status).toBe(200)
    await expect(h.pending).resolves.toBe('deny')
    expect(pickPermissionOutcome(h.options, { decision: 'deny', reviewer: 'user', choice: h.gate.get('appr')?.choice }))
      .toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('treats a repeat with different scope as conflict, even for the same allow decision', async () => {
    const h = setup()
    expect((await h.submit('allow', { optionId: 'provider-once' })).status).toBe(200)
    expect((await h.submit('allow', { optionId: 'provider-always' })).status).toBe(409)
    expect(h.events.record).toHaveBeenCalledOnce()
  })

  it('never selects a standing option from an automatic or unqualified allow', () => {
    const h = setup()
    const always = h.options.filter((option) => option.kind.endsWith('always'))
    expect(pickPermissionOutcome(always, 'allow')).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(pickPermissionOutcome(h.options, { decision: 'allow', reviewer: 'agent', choice: { optionId: 'provider-always' } }))
      .toEqual({ outcome: { outcome: 'cancelled' } })
  })
})
