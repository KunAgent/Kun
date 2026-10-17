import { it, expect, vi } from 'vitest'
import { RemoteApprovals } from './service.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
it('approval challenge binds device and action snapshot then consumes once', async () => {
  let approval = {
    id: 'a',
    status: 'pending',
    threadId: 't',
    turnId: 'turn',
    summary: 'write one file',
    action: { path: '/project/a' }
  }
  const runtime = {
    runtimeToken: 'secret',
    approvalGate: { get: () => approval },
    threadService: { get: async () => ({ workspaceMode: 'code' }) }
  } as unknown as ServerRuntime
  const call = vi.fn(async () => ({ status: 'allowed' })),
    gate = new RemoteApprovals(runtime, call),
    scope = {
      accountId: 'user',
      deviceId: 'phone',
      authorizationId: 'connection'
    }
  const first = await gate.prepare(scope, 'a')
  await expect(
    gate.resolve(
      { ...scope, deviceId: 'other' },
      { approvalId: 'a', challenge: first.challenge, decision: 'allow' }
    )
  ).rejects.toThrow('APPROVAL_EXPIRED')
  approval = { ...approval, action: { path: '/project/b' } }
  await expect(
    gate.resolve(scope, {
      approvalId: 'a',
      challenge: first.challenge,
      decision: 'allow'
    })
  ).rejects.toThrow('APPROVAL_EXPIRED')
  const next = await gate.prepare(scope, 'a')
  await gate.resolve(scope, {
    approvalId: 'a',
    challenge: next.challenge,
    decision: 'deny'
  })
  expect(call).toHaveBeenCalledWith(
    '/v1/approvals/a',
    'POST',
    { decision: 'deny' },
    expect.objectContaining({ 'x-kun-approval-consent': expect.any(String) })
  )
  await expect(
    gate.resolve(scope, {
      approvalId: 'a',
      challenge: next.challenge,
      decision: 'deny'
    })
  ).rejects.toThrow('APPROVAL_EXPIRED')
  expect(call).toHaveBeenCalledTimes(1)
})
